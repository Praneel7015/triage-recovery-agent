import { classifyWithConfidence, needsInterpretation, type Classification } from "./taxonomy";
import { selectStep, selectAction } from "./policy";
import { checkStops } from "./stops";
import type { FailureCause, RecoveryAction, StopCode } from "@/db/schema";

export interface CaseInput {
  id: string;
  customerId: string;
  customerName: string;
  customerPhone?: string | null;
  customerEmail?: string | null;
  amountPaise: number;
  currency: string;
  paymentMethod: string;
  subscriptionId?: string | null;
  subscriptionState?: string | null;
  errorCode?: string | null;
  errorReason?: string | null;
  errorSource?: string | null;
  errorStep?: string | null;
  errorDescription?: string | null;
  retryCount: number;
  touchCount: number;
  isDnd: boolean;
  hasConsented: boolean;
  alreadyPaid?: boolean;
  bankOutageActive?: boolean;
  promiseToPay?: string | null;
  salaryWindowHint?: string | null;
  /** B2B receivables lane. */
  invoiceId?: string | null;
  invoiceDueDate?: string | null;
  agingDays?: number | null;
  segment?: "subscription" | "checkout" | "b2b_invoice";
}

export interface AuditEntry {
  actor: "agent" | "policy" | "stop_rule" | "executor" | "llm" | "customer" | "webhook" | "naive";
  event: string;
  detail: string;
  llmUsed?: boolean;
  llmFallback?: boolean;
  policyOverride?: boolean;
  day?: number;
}

export interface Diagnosis {
  cause: FailureCause;
  narrative: string;
  confidence: number;
  taxonomyCause: FailureCause;
  taxonomyConfidence: number;
  llmProposedCause?: FailureCause;
  llmUsed: boolean;
  llmFallback: boolean;
  policyOverride: boolean;
  /** Why the model was not used, when it wasn't. Surfaced in the eval so a
   *  silently degraded model does not masquerade as a working one. */
  llmFallbackReason?: string;
  /** LLM-drafted WhatsApp/SMS outreach copy, if the model was called and succeeded. */
  outreachCopy?: string;
  signals: string[];
  auditTrail: AuditEntry[];
}

/**
 * The LLM must be substantially more confident than the deterministic classifier
 * before it is allowed to overturn a concrete taxonomy verdict. Below this bar,
 * the taxonomy result stands and the disagreement is recorded as an override.
 */
const LLM_OVERTURN_THRESHOLD = 0.75;

async function callLLM(c: CaseInput, taxonomyCause: FailureCause) {
  try {
    const { refineCause } = await import("@/adapters/llm");
    return await refineCause(c, taxonomyCause);
  } catch {
    return null;
  }
}

/**
 * Establishes the root cause of a failure.
 *
 * Unambiguous error fields are resolved deterministically and for free. Only cases
 * with conflicting or missing signals reach the LLM, and even then the model's
 * answer is advisory: it proposes a cause, never an action, and a confident
 * taxonomy verdict beats a hesitant model.
 */
export async function diagnose(c: CaseInput): Promise<Diagnosis> {
  const audit: AuditEntry[] = [];

  const cls: Classification = classifyWithConfidence({
    errorCode: c.errorCode,
    errorReason: c.errorReason,
    errorSource: c.errorSource,
    errorStep: c.errorStep,
    errorDescription: c.errorDescription,
    bankOutageActive: c.bankOutageActive ?? false,
    subscriptionState: c.subscriptionState,
    paymentMethod: c.paymentMethod,
  });

  audit.push({
    actor: "agent",
    event: "taxonomy_classified",
    detail:
      `Taxonomy: ${cls.cause} at ${(cls.confidence * 100).toFixed(0)}% confidence` +
      (cls.signals.length ? ` — ${cls.signals.join(" ")}` : ""),
  });

  let cause          = cls.cause;
  let narrative      = `Classified as "${cls.cause}" from the Razorpay error fields.`;
  let confidence     = cls.confidence;
  let llmUsed        = false;
  let llmFallback    = false;
  let policyOverride = false;
  let llmProposed: FailureCause | undefined;
  let llmFallbackReason: string | undefined;
  let outreachCopy: string | undefined;

  if (!needsInterpretation(cls)) {
    return {
      cause, narrative, confidence,
      taxonomyCause: cls.cause, taxonomyConfidence: cls.confidence,
      llmUsed, llmFallback, policyOverride,
      signals: cls.signals, auditTrail: audit,
    };
  }

  audit.push({
    actor: "agent",
    event: "escalated_to_llm",
    detail: cls.conflicting
      ? "Signals conflict, so the payload needs interpretation rather than a lookup."
      : "Error fields are too sparse for a deterministic verdict.",
  });

  const llm = await callLLM(c, cls.cause);

  if (!llm) {
    llmFallback = true;
    llmFallbackReason = "LLM adapter could not be loaded.";
    audit.push({
      actor: "agent", event: "llm_fallback", llmFallback: true,
      detail: "LLM adapter unavailable. Proceeding on the taxonomy result alone.",
    });
  } else if (llm.fallback) {
    llmUsed = true;
    llmFallback = true;
    llmFallbackReason = llm.fallbackReason ?? "unknown";
    confidence = Math.min(confidence, 0.6);
    audit.push({
      actor: "llm", event: "llm_fallback", llmUsed: true, llmFallback: true,
      detail: `Model unavailable (${llm.fallbackReason ?? "unknown reason"}). ` +
              `Holding the taxonomy verdict "${cls.cause}" and lowering confidence.`,
    });
  } else {
    llmUsed = true;
    llmProposed = llm.cause;
    narrative = llm.narrative || narrative;
    outreachCopy = llm.outreachCopy || undefined;

    if (llm.cause === cls.cause) {
      confidence = Math.max(confidence, llm.confidence);
      audit.push({
        actor: "llm", event: "llm_confirmed", llmUsed: true,
        detail: `LLM agrees with the taxonomy (${llm.cause}) at ${(llm.confidence * 100).toFixed(0)}% confidence.`,
      });
    } else if (cls.cause !== "unknown" && llm.confidence < LLM_OVERTURN_THRESHOLD) {
      // Model disagrees but is not confident enough to overturn a concrete verdict.
      policyOverride = true;
      audit.push({
        actor: "policy", event: "policy_override", llmUsed: true, policyOverride: true,
        detail:
          `LLM proposed "${llm.cause}" at ${(llm.confidence * 100).toFixed(0)}% but taxonomy holds ` +
          `"${cls.cause}". Below the ${LLM_OVERTURN_THRESHOLD * 100}% overturn bar, so the ` +
          `deterministic verdict stands.`,
      });
    } else {
      cause = llm.cause;
      confidence = llm.confidence;
      audit.push({
        actor: "llm", event: "llm_reclassified", llmUsed: true,
        detail:
          `LLM reclassified ${cls.cause} → ${llm.cause} at ` +
          `${(llm.confidence * 100).toFixed(0)}% confidence, clearing the overturn bar.`,
      });
    }
  }

  return {
    cause, narrative, confidence,
    taxonomyCause: cls.cause, taxonomyConfidence: cls.confidence,
    llmProposedCause: llmProposed,
    llmUsed, llmFallback, policyOverride, llmFallbackReason,
    outreachCopy,
    signals: cls.signals, auditTrail: audit,
  };
}

// ─── Single-shot decision, retained for callers that do not run a campaign ────

export interface AgentResult {
  cause: FailureCause;
  diagnosisNarrative: string;
  action: RecoveryAction;
  blocked: boolean;
  stopCode?: StopCode;
  stopReason?: string;
  confidenceScore: number;
  llmUsed: boolean;
  llmFallback: boolean;
  policyOverride: boolean;
  auditTrail: AuditEntry[];
}

export async function runAgent(c: CaseInput): Promise<AgentResult> {
  const d = await diagnose(c);
  const audit = [...d.auditTrail];

  const action = selectAction({
    cause: d.cause,
    subscriptionState: c.subscriptionState,
    retryCount: c.retryCount,
    amountPaise: c.amountPaise,
    paymentMethod: c.paymentMethod,
    stepIndex: 0,
    salaryWindowHint: c.salaryWindowHint,
  });

  audit.push({ actor: "policy", event: "action_selected", detail: `Policy selected: ${action}` });

  const stop = checkStops({
    action,
    cause: d.cause,
    retryCount: c.retryCount,
    touchCount: c.touchCount,
    isDnd: c.isDnd,
    hasConsented: c.hasConsented,
    alreadyPaid: c.alreadyPaid ?? false,
    bankOutageActive: c.bankOutageActive ?? false,
    mandateRevoked: d.cause === "mandate_revoked",
    promiseToPay: c.promiseToPay,
    amountPaise: c.amountPaise,
    confidenceScore: d.confidence,
  });

  audit.push(stop.blocked
    ? { actor: "stop_rule", event: "action_blocked", detail: `${stop.stopCode}: ${stop.reason}` }
    : { actor: "executor", event: "action_allowed", detail: `${action} cleared all stop rules.` });

  return {
    cause: d.cause,
    diagnosisNarrative: d.narrative,
    action,
    blocked: stop.blocked,
    stopCode: stop.stopCode,
    stopReason: stop.reason,
    confidenceScore: d.confidence,
    llmUsed: d.llmUsed,
    llmFallback: d.llmFallback,
    policyOverride: d.policyOverride,
    auditTrail: audit,
  };
}
