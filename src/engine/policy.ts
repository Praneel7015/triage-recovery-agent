import type { FailureCause, RecoveryAction } from "@/db/schema";

export interface PolicyInput {
  cause: FailureCause;
  subscriptionState?: string | null;
  retryCount: number;
  amountPaise: number;
  paymentMethod: string;
}

/**
 * The only place in the codebase that selects a RecoveryAction.
 * If the LLM suggests something different, policy wins.
 * Logic is deterministic — no LLM, no randomness.
 */
export function selectAction(input: PolicyInput): RecoveryAction {
  const { cause, subscriptionState, retryCount, amountPaise, paymentMethod } = input;

  // ── Infrastructure problems: silence is the right answer ──────────────────
  if (cause === "bank_outage" || cause === "psp_down") {
    return "do_nothing";
  }

  // ── Customer genuinely cancelled: do not chase ────────────────────────────
  if (cause === "customer_cancelled") {
    // High-value last chance: offer a pause instead of dunning
    if (amountPaise >= 100_000) return "offer_pause"; // ₹1000+
    return "do_nothing";
  }

  // ── Mandate revoked: NEVER retry Autopay ─────────────────────────────────
  if (cause === "mandate_revoked") {
    // Send a one-time payment link instead
    return "send_one_time_payment_link";
  }

  // ── Instrument expired: need new payment method ───────────────────────────
  if (cause === "instrument_expired") {
    return "send_method_update_link";
  }

  // ── Insufficient funds: salary-window retry is the right play ────────────
  if (cause === "insufficient_funds") {
    if (retryCount === 0) return "silent_retry_at_window";
    if (retryCount === 1) return "send_one_time_payment_link"; // gentle nudge after 1 miss
    // retryCount >= 2: high-value consented → voice; else human
    if (amountPaise >= 50_000) return "hinglish_voice_script"; // ₹500+
    return "escalate_human";
  }

  // ── UPI hang: instrument is fine, rails failed ────────────────────────────
  if (cause === "upi_hang") {
    if (retryCount === 0) return "send_one_time_payment_link";
    return "send_method_update_link"; // try alternate method
  }

  // ── Auth failure: customer needs to re-authenticate ───────────────────────
  if (cause === "auth_failed") {
    return "send_one_time_payment_link";
  }

  // ── Subscription is halted (all Razorpay retries exhausted) ───────────────
  if (subscriptionState === "halted") {
    if (amountPaise >= 50_000) return "hinglish_voice_script";
    return "send_method_update_link";
  }

  // ── Unknown cause: let LLM clarify, then escalate ─────────────────────────
  if (cause === "unknown") {
    return "escalate_human";
  }

  return "do_nothing";
}

/** Human-readable action labels for UI */
export const ACTION_LABELS: Record<RecoveryAction, string> = {
  silent_retry_at_window:       "Silent Retry at Salary Window",
  send_method_update_link:      "Send Method Update Link",
  send_one_time_payment_link:   "Send One-Time Payment Link",
  offer_pause:                  "Offer Subscription Pause",
  hinglish_voice_script:        "Hinglish Voice Outreach",
  escalate_human:               "Escalate to Human Agent",
  do_nothing:                   "Do Nothing",
};
