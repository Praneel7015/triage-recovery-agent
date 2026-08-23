import { diagnose, type CaseInput, type AuditEntry } from "./agent";
import { selectStep } from "./policy";
import { checkStops, MAX_CAMPAIGN_DAYS } from "./stops";
import { costOfAction, channelForAction, type Channel } from "./economics";
import { isHoldout, simulateNaturalRecovery } from "./holdout";
import { simulate } from "@/adapters/simulator";
import { simulateInboundReply, extractIntent, type InboundReply, type ExtractedIntent } from "@/adapters/conversation";
import type { CaseStatus, FailureCause, RecoveryAction, StopCode } from "@/db/schema";

export const MAX_STEPS = 5;

export interface CampaignStep {
  day: number;
  stepIndex: number;
  action: RecoveryAction;
  channel: Channel;
  costPaise: number;
  rationale: string;
  blocked: boolean;
  stopCode?: StopCode;
  stopReason?: string;
  outcome: "recovered" | "no_response" | "blocked" | "waiting";
  outcomeReason: string;
  reply?: InboundReply;
  intent?: ExtractedIntent;
  /** Populated for voice steps so the UI can speak it aloud. */
  voiceScript?: string;
  /** LLM-drafted WhatsApp/SMS copy for this step, when the model was called during diagnosis. */
  outreachCopy?: string;
}

export interface CampaignResult {
  caseId: string;
  cause: FailureCause;
  diagnosisNarrative: string;
  confidence: number;
  isHoldout: boolean;
  steps: CampaignStep[];
  recovered: boolean;
  recoveredOnDay: number | null;
  recoveredAmountPaise: number;
  amountPaise: number;
  totalCostPaise: number;
  touchCount: number;
  finalStatus: CaseStatus;
  finalStopCode?: StopCode;
  optedOut: boolean;
  disputed: boolean;
  promiseToPay: string | null;
  llmCalls: number;
  llmFallbacks: number;
  policyOverrides: number;
  intentExtractions: number;
  intentCorrect: number;
  /** Reasons the model was unavailable, aggregated in the eval report. */
  llmFallbackReasons: string[];
  auditTrail: AuditEntry[];
}

/**
 * Runs one bounded recovery campaign.
 *
 * A campaign walks the escalation ladder for the diagnosed cause across at most
 * 30 simulated days and 5 steps. Every step is gated by the stop rules, priced by
 * the channel it uses, and may be interrupted by an inbound customer reply that
 * changes the plan — a promise to pay defers contact, an opt-out ends it outright.
 *
 * Holdout cases are never touched. They exist to measure what would have happened
 * anyway, so that reported recovery is incremental rather than coincidental.
 */
export async function runCampaign(c: CaseInput, opts: { holdoutFraction?: number } = {}): Promise<CampaignResult> {
  const diag = await diagnose(c);
  const audit: AuditEntry[] = [...diag.auditTrail];

  const base: CampaignResult = {
    caseId: c.id,
    cause: diag.cause,
    diagnosisNarrative: diag.narrative,
    confidence: diag.confidence,
    isHoldout: false,
    steps: [],
    recovered: false,
    recoveredOnDay: null,
    recoveredAmountPaise: 0,
    amountPaise: c.amountPaise,
    totalCostPaise: 0,
    touchCount: 0,
    finalStatus: "open",
    optedOut: false,
    disputed: false,
    promiseToPay: c.promiseToPay ?? null,
    llmCalls: diag.llmUsed ? 1 : 0,
    llmFallbacks: diag.llmFallback ? 1 : 0,
    policyOverrides: diag.policyOverride ? 1 : 0,
    intentExtractions: 0,
    intentCorrect: 0,
    llmFallbackReasons: diag.llmFallbackReason ? [diag.llmFallbackReason] : [],
    auditTrail: audit,
  };

  // ── Holdout: observe only, never touch ────────────────────────────────────
  if (isHoldout(c.id, opts.holdoutFraction)) {
    const recovered = simulateNaturalRecovery(c.id, diag.cause);
    audit.push({
      actor: "agent", event: "holdout_assigned", day: 0,
      detail: "Case assigned to the no-contact control group. Outcome observed, not influenced.",
    });
    audit.push({
      actor: "executor", event: recovered ? "natural_recovery" : "no_natural_recovery", day: MAX_CAMPAIGN_DAYS,
      detail: recovered
        ? "Recovered with no intervention at all."
        : "Never recovered on its own within the campaign window.",
    });
    return {
      ...base,
      isHoldout: true,
      recovered,
      recoveredOnDay: recovered ? MAX_CAMPAIGN_DAYS : null,
      recoveredAmountPaise: recovered ? c.amountPaise : 0,
      finalStatus: recovered ? "recovered" : "unrecoverable",
    };
  }

  // ── Treated: walk the ladder ──────────────────────────────────────────────
  const steps: CampaignStep[] = [];
  let day        = 0;
  let stepIndex  = 0;
  let spent      = 0;
  let touches    = c.touchCount;
  let retries    = c.retryCount;
  let promise    = c.promiseToPay ?? null;
  let dnd        = c.isDnd;
  let optedOut   = false;
  let disputed   = false;
  let alreadyPaid = c.alreadyPaid ?? false;
  let outageActive = c.bankOutageActive ?? false;
  let recovered  = false;
  let recoveredOnDay: number | null = null;
  let finalStopCode: StopCode | undefined;
  let llmCalls = base.llmCalls;
  let llmFallbacks = base.llmFallbacks;
  let intentExtractions = 0;
  let intentCorrect = 0;

  const campaignStart = new Date();
  const dayToDate = (d: number) => new Date(campaignStart.getTime() + d * 86400_000);

  while (stepIndex < MAX_STEPS && day <= MAX_CAMPAIGN_DAYS && !recovered) {
    const decision = selectStep({
      cause: diag.cause,
      subscriptionState: c.subscriptionState,
      retryCount: retries,
      amountPaise: c.amountPaise,
      paymentMethod: c.paymentMethod,
      stepIndex,
      salaryWindowHint: c.salaryWindowHint,
    });

    day += decision.delayDays;
    if (day > MAX_CAMPAIGN_DAYS) {
      audit.push({ actor: "stop_rule", event: "campaign_expired", day,
        detail: `Next step would fall on day ${day}, past the ${MAX_CAMPAIGN_DAYS}-day bound. Campaign closes.` });
      finalStopCode = "campaign_expired";
      break;
    }

    // An outage is assumed to clear after the first wait.
    if (outageActive && stepIndex > 0) outageActive = false;

    const stop = checkStops({
      action: decision.action,
      cause: diag.cause,
      retryCount: retries,
      touchCount: touches,
      isDnd: dnd,
      hasConsented: c.hasConsented,
      alreadyPaid,
      bankOutageActive: outageActive,
      mandateRevoked: diag.cause === "mandate_revoked",
      promiseToPay: promise,
      amountPaise: c.amountPaise,
      confidenceScore: diag.confidence,
      day,
      spentPaise: spent,
      disputed,
      ladderExhausted: decision.exhausted,
      now: dayToDate(day),
    });

    if (stop.blocked) {
      steps.push({
        day, stepIndex,
        action: decision.action,
        channel: channelForAction(decision.action),
        costPaise: 0,
        rationale: decision.rationale,
        blocked: true,
        stopCode: stop.stopCode,
        stopReason: stop.reason,
        outcome: stop.permanent ? "blocked" : "waiting",
        outcomeReason: stop.reason ?? "Blocked by a stop rule.",
      });
      audit.push({
        actor: "stop_rule", event: stop.permanent ? "action_blocked_permanent" : "action_deferred", day,
        detail: `${stop.stopCode}: ${stop.reason}`,
      });

      finalStopCode = stop.stopCode;
      if (stop.permanent) break;

      // Transient block: wait a few days, try the next rung.
      day += 3;
      stepIndex++;
      continue;
    }

    // ── Execute ─────────────────────────────────────────────────────────────
    const channel = channelForAction(decision.action);
    const cost    = costOfAction(decision.action);
    spent += cost;
    if (cost > 0 && channel !== "retry") touches++;
    if (decision.action === "silent_retry_at_window") retries++;

    // A voice step needs an actual script, generated in the customer's register.
    let voiceScript: string | undefined;
    if (decision.action === "hinglish_voice_script") {
      const { generateHinglishScript } = await import("@/adapters/llm");
      const gen = await generateHinglishScript(c, diag.cause);
      voiceScript = gen.script;
      llmCalls += gen.fallback ? 0 : 1;
      llmFallbacks += gen.fallback ? 1 : 0;
      audit.push({
        actor: gen.fallback ? "agent" : "llm",
        event: "voice_script_generated", day,
        llmUsed: !gen.fallback,
        llmFallback: gen.fallback,
        detail: gen.fallback
          ? `Model unavailable, using the templated script: "${voiceScript}"`
          : `Generated Hinglish script: "${voiceScript}"`,
      });
    }

    // Doing nothing means the natural outcome, not a free win.
    const outcome = decision.action === "do_nothing"
      ? { recovered: simulateNaturalRecovery(c.id, diag.cause),
          simulatedReason: "No intervention. Outcome is whatever would have happened anyway." }
      : simulate({
          caseId: c.id,
          cause: diag.cause,
          action: decision.action,
          blocked: false,
          retryCount: retries,
          salaryWindowHint: c.salaryWindowHint,
          bankOutageActive: outageActive,
          amountPaise: c.amountPaise,
          stepIndex,
        });

    const step: CampaignStep = {
      day, stepIndex,
      action: decision.action,
      channel,
      costPaise: cost,
      rationale: decision.rationale,
      blocked: false,
      outcome: outcome.recovered ? "recovered" : "no_response",
      outcomeReason: outcome.simulatedReason,
      voiceScript,
      // Attach the LLM's outreach copy to the first step only.
      outreachCopy: stepIndex === 0 ? (diag.outreachCopy ?? undefined) : undefined,
    };

    audit.push({
      actor: "executor", event: "step_executed", day,
      detail:
        `Step ${stepIndex}: ${decision.action} via ${channel} ` +
        `(cost ${cost === 0 ? "free" : "₹" + (cost / 100).toFixed(2)}). ${decision.rationale}`,
    });

    if (outcome.recovered) {
      recovered = true;
      recoveredOnDay = day;
      step.outcome = "recovered";
      steps.push(step);
      audit.push({ actor: "executor", event: "recovered", day, detail: outcome.simulatedReason });
      break;
    }

    // ── Inbound reply may change the plan ───────────────────────────────────
    const reply = simulateInboundReply(c.id, diag.cause, channel, day);
    if (reply) {
      const intent = await extractIntent(reply.text, dayToDate(day));
      intentExtractions++;
      llmCalls += intent.method === "llm" ? 1 : 0;
      llmFallbacks += intent.fallback ? 1 : 0;
      if (intent.intent === reply.groundTruth) intentCorrect++;

      step.reply  = reply;
      step.intent = intent;

      audit.push({
        actor: "customer", event: "reply_received", day,
        detail: `"${reply.text}"`,
      });
      audit.push({
        actor: intent.method === "llm" ? "llm" : "agent",
        event: "intent_extracted", day,
        llmUsed: intent.method === "llm",
        llmFallback: intent.fallback,
        detail:
          `Intent: ${intent.intent}` +
          (intent.promiseDate ? ` (pay by ${intent.promiseDate})` : "") +
          ` at ${(intent.confidence * 100).toFixed(0)}% confidence` +
          (intent.fallback ? " via keyword fallback." : " via LLM."),
      });

      switch (intent.intent) {
        case "opt_out":
          dnd = true; optedOut = true;
          finalStopCode = "dnd_opted_out";
          audit.push({ actor: "agent", event: "opt_out_honoured", day,
            detail: "Customer asked to stop. DND set permanently and campaign ended." });
          steps.push(step);
          stepIndex = MAX_STEPS;
          continue;

        case "already_paid":
          alreadyPaid = true;
          finalStopCode = "already_paid";
          audit.push({ actor: "agent", event: "reconciliation_needed", day,
            detail: "Customer claims payment is already made. Campaign halts pending reconciliation." });
          steps.push(step);
          stepIndex = MAX_STEPS;
          continue;

        case "dispute":
          disputed = true;
          finalStopCode = "customer_disputed";
          audit.push({ actor: "agent", event: "dispute_registered", day,
            detail: "Customer disputes the charge. Collection stops and a human takes over." });
          steps.push(step);
          stepIndex = MAX_STEPS;
          continue;

        case "promise_to_pay":
          promise = intent.promiseDate;
          audit.push({ actor: "agent", event: "promise_recorded", day,
            detail: `Promise-to-pay recorded for ${intent.promiseDate}. No contact until then.` });
          break;

        default:
          break;
      }
    }

    steps.push(step);
    stepIndex++;
    if (decision.exhausted) {
      finalStopCode = finalStopCode ?? "ladder_exhausted";
      break;
    }
  }

  const finalStatus: CaseStatus =
    recovered   ? "recovered"
    : disputed  ? "escalated"
    : optedOut  ? "stopped"
    : alreadyPaid ? "recovered"
    : finalStopCode ? "stopped"
    : "unrecoverable";

  return {
    ...base,
    steps,
    recovered: recovered || alreadyPaid,
    recoveredOnDay,
    recoveredAmountPaise: recovered ? c.amountPaise : 0,
    totalCostPaise: spent,
    touchCount: touches - c.touchCount,
    finalStatus,
    finalStopCode,
    optedOut,
    disputed,
    promiseToPay: promise,
    llmCalls,
    llmFallbacks,
    policyOverrides: base.policyOverrides,
    intentExtractions,
    intentCorrect,
    llmFallbackReasons: base.llmFallbackReasons,
    auditTrail: audit,
  };
}
