import type { CaseInput } from "./agent";
import { classifyCause } from "./taxonomy";
import { costOfAction, channelForAction, type Channel } from "./economics";
import { isHoldout, simulateNaturalRecovery } from "./holdout";
import { simulate } from "@/adapters/simulator";
import { simulateInboundReply } from "@/adapters/conversation";
import { MAX_CAMPAIGN_DAYS } from "./stops";
import type { RecoveryAction } from "@/db/schema";

/**
 * The baseline every merchant already runs: retry immediately, then dun everyone
 * on a fixed cadence until they pay or the window closes.
 *
 * It has no diagnosis, no stop rules, and no ability to hear a reply. It is given
 * exactly the same 30 days, the same cases, and the same simulator as Triage, so
 * the comparison isolates decision quality rather than effort.
 */

export interface NaiveStep {
  day: number;
  action: RecoveryAction;
  channel: Channel;
  costPaise: number;
  recovered: boolean;
  illegalRetry: boolean;
  dndViolation: boolean;
  ignoredOptOut: boolean;
  outageContact: boolean;
}

export interface NaiveResult {
  caseId: string;
  isHoldout: boolean;
  steps: NaiveStep[];
  recovered: boolean;
  recoveredOnDay: number | null;
  recoveredAmountPaise: number;
  amountPaise: number;
  totalCostPaise: number;
  touchCount: number;
  illegalRetries: number;
  dndViolations: number;
  ignoredOptOuts: number;
  outageContacts: number;
  /**
   * Money recovered by a step that broke a rule. A regulator does not let a
   * merchant keep the proceeds of a DND breach, and in practice these convert
   * into complaints and chargebacks — so this is not bankable revenue.
   */
  illegalRecoveryPaise: number;
  /** Gross recovery minus the illegal portion. The only fair comparison figure. */
  compliantRecoveryPaise: number;
  /** True if any step in the campaign violated a rule, recovered or not. */
  tainted: boolean;
}

/** Fixed dunning cadence, applied to every case regardless of why it failed. */
const CADENCE: Array<{ day: number; action: RecoveryAction }> = [
  { day: 0,  action: "silent_retry_at_window" },
  { day: 3,  action: "send_one_time_payment_link" },
  { day: 6,  action: "send_one_time_payment_link" },
  { day: 9,  action: "send_one_time_payment_link" },
  { day: 14, action: "hinglish_voice_script" },
  { day: 21, action: "send_one_time_payment_link" },
];

export function runNaiveCampaign(c: CaseInput, opts: { holdoutFraction?: number } = {}): NaiveResult {
  const cause = classifyCause({
    errorCode: c.errorCode,
    errorReason: c.errorReason,
    errorSource: c.errorSource,
    errorStep: c.errorStep,
    errorDescription: c.errorDescription,
    bankOutageActive: c.bankOutageActive ?? false,
    subscriptionState: c.subscriptionState,
    paymentMethod: c.paymentMethod,
  });

  const empty: NaiveResult = {
    caseId: c.id,
    isHoldout: false,
    steps: [],
    recovered: false,
    recoveredOnDay: null,
    recoveredAmountPaise: 0,
    amountPaise: c.amountPaise,
    totalCostPaise: 0,
    touchCount: 0,
    illegalRetries: 0,
    dndViolations: 0,
    ignoredOptOuts: 0,
    outageContacts: 0,
    illegalRecoveryPaise: 0,
    compliantRecoveryPaise: 0,
    tainted: false,
  };

  // Same holdout split, so both arms are measured against the same control.
  if (isHoldout(c.id, opts.holdoutFraction)) {
    const rec = simulateNaturalRecovery(c.id, cause);
    return {
      ...empty,
      isHoldout: true,
      recovered: rec,
      recoveredOnDay: rec ? MAX_CAMPAIGN_DAYS : null,
      recoveredAmountPaise: rec ? c.amountPaise : 0,
      compliantRecoveryPaise: rec ? c.amountPaise : 0,
    };
  }

  const mandateDead = cause === "mandate_revoked" || c.subscriptionState === "cancelled";
  const steps: NaiveStep[] = [];

  let spent = 0;
  let touches = 0;
  let retries = c.retryCount;
  let recovered = false;
  let recoveredOnDay: number | null = null;
  let illegalRetries = 0;
  let dndViolations = 0;
  let ignoredOptOuts = 0;
  let outageContacts = 0;
  let illegalRecovery = 0;
  let tainted = false;
  // Naive has no opt-out list, so a customer who says STOP keeps getting messages.
  let customerAskedToStop = false;

  for (const rung of CADENCE) {
    if (recovered || rung.day > MAX_CAMPAIGN_DAYS) break;

    const channel = channelForAction(rung.action);
    const cost    = costOfAction(rung.action);
    const isContact = channel !== "retry" && channel !== "none";

    const illegalRetry  = rung.action === "silent_retry_at_window" && mandateDead;
    const dndViolation  = isContact && c.isDnd;
    const ignoredOptOut = isContact && customerAskedToStop;
    const outageContact = isContact && (c.bankOutageActive ?? false) && rung.day <= 3;

    if (illegalRetry)  illegalRetries++;
    if (dndViolation)  dndViolations++;
    if (ignoredOptOut) ignoredOptOuts++;
    if (outageContact) outageContacts++;

    spent += cost;
    if (isContact) touches++;
    if (rung.action === "silent_retry_at_window") retries++;

    const outcome = simulate({
      caseId: c.id,
      cause,
      action: rung.action,
      blocked: false,
      retryCount: retries,
      salaryWindowHint: c.salaryWindowHint,
      bankOutageActive: (c.bankOutageActive ?? false) && rung.day <= 3,
      amountPaise: c.amountPaise,
      stepIndex: steps.length,
    });

    const stepViolated = illegalRetry || dndViolation || ignoredOptOut || outageContact;
    if (stepViolated) tainted = true;

    if (outcome.recovered) {
      recovered = true;
      recoveredOnDay = rung.day;
      // Attribute the recovery to the step that produced it.
      if (stepViolated) illegalRecovery = c.amountPaise;
    }

    steps.push({
      day: rung.day,
      action: rung.action,
      channel,
      costPaise: cost,
      recovered: outcome.recovered,
      illegalRetry, dndViolation, ignoredOptOut, outageContact,
    });

    // A reply arrives, and naive has nowhere to put it.
    const reply = simulateInboundReply(c.id, cause, channel, rung.day);
    if (reply && (reply.groundTruth === "opt_out" || reply.groundTruth === "dispute")) {
      customerAskedToStop = true;
    }
  }

  return {
    ...empty,
    steps,
    recovered,
    recoveredOnDay,
    recoveredAmountPaise: recovered ? c.amountPaise : 0,
    totalCostPaise: spent,
    touchCount: touches,
    illegalRetries,
    dndViolations,
    ignoredOptOuts,
    outageContacts,
    illegalRecoveryPaise: illegalRecovery,
    compliantRecoveryPaise: (recovered ? c.amountPaise : 0) - illegalRecovery,
    tainted,
  };
}

/** Backward-compatible single-step shim. */
export function runNaive(c: CaseInput) {
  const r = runNaiveCampaign(c);
  return {
    action: "silent_retry_at_window" as RecoveryAction,
    illegalRetry: r.illegalRetries > 0,
    dndViolation: r.dndViolations > 0,
    touchSent: r.touchCount > 0,
    recovered: r.recovered,
  };
}
