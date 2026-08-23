import type { FailureCause, RecoveryAction } from "@/db/schema";

export interface PolicyInput {
  cause: FailureCause;
  subscriptionState?: string | null;
  retryCount: number;
  amountPaise: number;
  paymentMethod: string;
  /** Which rung of the escalation ladder we are on (0-based). */
  stepIndex?: number;
  /** Salary-cycle hint used to time the first silent retry. */
  salaryWindowHint?: string | null;
}

export interface PolicyDecision {
  action: RecoveryAction;
  /** Days to wait from the previous step before executing this one. */
  delayDays: number;
  /** Why the ladder chose this rung. */
  rationale: string;
  /** True when the ladder has no further rungs for this cause. */
  exhausted: boolean;
}

const HIGH_VALUE_PAISE = 50_000;   // ₹500
const VERY_HIGH_PAISE  = 100_000;  // ₹1000

/** Days to wait for the first silent retry, by salary-cycle hint. */
function salaryWindowDelay(hint?: string | null): number {
  switch (hint) {
    case "1st":          return 3;  // wait for month-start credit
    case "7th":          return 5;
    case "last_working": return 4;
    default:             return 2;  // no hint: short generic wait
  }
}

/**
 * The escalation ladder.
 *
 * Given a cause and how far we already are into the campaign, returns the next
 * bounded action and how long to wait first. This is the only place an action is
 * selected — the LLM never picks a rung, and stop rules can still veto whatever
 * comes out of here.
 */
export function selectStep(input: PolicyInput): PolicyDecision {
  const { cause, subscriptionState, amountPaise, salaryWindowHint } = input;
  const step = input.stepIndex ?? 0;
  const highValue = amountPaise >= HIGH_VALUE_PAISE;
  const veryHigh  = amountPaise >= VERY_HIGH_PAISE;

  const done = (): PolicyDecision => ({
    action: "do_nothing",
    delayDays: 0,
    rationale: "Escalation ladder exhausted for this cause. Campaign closes.",
    exhausted: true,
  });

  switch (cause) {
    // ── Empty account: time the retry to the salary cycle, then nudge ────────
    case "insufficient_funds":
      if (step === 0) return {
        action: "silent_retry_at_window",
        delayDays: salaryWindowDelay(salaryWindowHint),
        rationale: `Retry silently after the ${salaryWindowHint ?? "next"} replenishment window. No contact, no cost.`,
        exhausted: false,
      };
      if (step === 1) return {
        action: "send_one_time_payment_link",
        delayDays: 3,
        rationale: "Silent retry missed. First customer contact with a direct payment link.",
        exhausted: false,
      };
      if (step === 2) return highValue
        ? { action: "hinglish_voice_script", delayDays: 4, rationale: "High-value and still unpaid after a link. Voice converts materially better.", exhausted: false }
        : { action: "send_one_time_payment_link", delayDays: 5, rationale: "Second and final link. Voice is not economic at this ticket size.", exhausted: false };
      if (step === 3 && veryHigh) return {
        action: "escalate_human",
        delayDays: 5,
        rationale: "Very high value and automation is exhausted. A human agent takes it from here.",
        exhausted: false,
      };
      return done();

    // ── Infrastructure down: silence is the correct action ───────────────────
    case "bank_outage":
    case "psp_down":
      if (step === 0) return {
        action: "do_nothing",
        delayDays: 2,
        rationale: "Bank/PSP outage is live. Contacting now blames the customer for our rails. Wait it out.",
        exhausted: false,
      };
      if (step === 1) return {
        action: "silent_retry_at_window",
        delayDays: 1,
        rationale: "Outage window has passed. Retry silently before spending anything on contact.",
        exhausted: false,
      };
      if (step === 2) return {
        action: "send_one_time_payment_link",
        delayDays: 3,
        rationale: "Still unpaid after the outage cleared, so this is no longer an infrastructure problem.",
        exhausted: false,
      };
      return done();

    // ── Mandate is dead: never retry it, re-collect instead ──────────────────
    case "mandate_revoked":
      if (step === 0) return {
        action: "send_one_time_payment_link",
        delayDays: 0,
        rationale: "Mandate is revoked, so auto-debit is impossible. Collect this cycle with a one-time link.",
        exhausted: false,
      };
      if (step === 1) return {
        action: "send_method_update_link",
        delayDays: 4,
        rationale: "Ask for a fresh mandate so future cycles stop failing too.",
        exhausted: false,
      };
      if (step === 2 && veryHigh) return {
        action: "escalate_human",
        delayDays: 6,
        rationale: "High-value cancellation worth a human retention conversation.",
        exhausted: false,
      };
      return done();

    // ── Card expired: needs new credentials, not a retry ─────────────────────
    case "instrument_expired":
      if (step === 0) return {
        action: "send_method_update_link",
        delayDays: 1,
        rationale: "Instrument has expired. Only new credentials can fix this.",
        exhausted: false,
      };
      if (step === 1) return {
        action: "send_one_time_payment_link",
        delayDays: 4,
        rationale: "Card not updated. Offer a one-time payment so this cycle is not lost.",
        exhausted: false,
      };
      if (step === 2 && highValue) return {
        action: "hinglish_voice_script",
        delayDays: 5,
        rationale: "High-value and two links ignored. A call explains the expiry directly.",
        exhausted: false,
      };
      if (step === 3 && veryHigh) return {
        action: "escalate_human",
        delayDays: 5,
        rationale: "Very high value still open after voice. Hand to an agent.",
        exhausted: false,
      };
      return done();

    // ── They meant it: do not chase, at most offer to stay ───────────────────
    case "customer_cancelled":
      if (step === 0) return veryHigh
        ? { action: "offer_pause", delayDays: 1, rationale: "Deliberate cancellation, but high value. Offer a pause instead of dunning.", exhausted: false }
        : { action: "do_nothing", delayDays: 0, rationale: "Customer cancelled deliberately. Chasing voluntary churn burns goodwill.", exhausted: true };
      return done();

    // ── Rails hung: looks abandoned, is actually recoverable ─────────────────
    case "upi_hang":
      if (step === 0) return {
        action: "send_one_time_payment_link",
        delayDays: 0,
        rationale: "UPI/PSP timed out rather than the customer refusing. A fresh link usually completes.",
        exhausted: false,
      };
      if (step === 1) return {
        action: "silent_retry_at_window",
        delayDays: 2,
        rationale: "Retry silently in case the original mandate is still good.",
        exhausted: false,
      };
      if (step === 2) return {
        action: "send_method_update_link",
        delayDays: 3,
        rationale: "Repeated UPI failures. Offer an alternative instrument.",
        exhausted: false,
      };
      return done();

    // ── Auth failed: customer must re-authenticate ───────────────────────────
    case "auth_failed":
      if (step === 0) return {
        action: "send_one_time_payment_link",
        delayDays: 0,
        rationale: "Authentication failed. A fresh link lets them retry with a correct OTP/PIN.",
        exhausted: false,
      };
      if (step === 1) return {
        action: "send_method_update_link",
        delayDays: 3,
        rationale: "Auth failing repeatedly on this instrument. Offer another.",
        exhausted: false,
      };
      return done();

    // ── Unclear: a human decides, we do not guess with money ─────────────────
    case "unknown":
      if (step === 0) return {
        action: "escalate_human",
        delayDays: 1,
        rationale: "Root cause could not be established. Escalate rather than act on a guess.",
        exhausted: false,
      };
      return done();

    default:
      return done();
  }
}

/**
 * Single-step decision, kept for callers that do not run a full campaign.
 * Also applies the halted-subscription special case.
 */
export function selectAction(input: PolicyInput): RecoveryAction {
  if (input.subscriptionState === "halted" && (input.stepIndex ?? 0) === 0) {
    if (input.cause === "insufficient_funds" && input.amountPaise >= HIGH_VALUE_PAISE) {
      return "hinglish_voice_script";
    }
  }
  return selectStep(input).action;
}

export const ACTION_LABELS: Record<RecoveryAction, string> = {
  silent_retry_at_window:     "Silent Retry at Salary Window",
  send_method_update_link:    "Send Method Update Link",
  send_one_time_payment_link: "Send One-Time Payment Link",
  offer_pause:                "Offer Subscription Pause",
  hinglish_voice_script:      "Hinglish Voice Outreach",
  escalate_human:             "Escalate to Human Agent",
  do_nothing:                 "Do Nothing",
};
