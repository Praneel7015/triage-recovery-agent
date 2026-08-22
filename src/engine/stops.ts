import type { RecoveryAction, StopCode } from "@/db/schema";

export interface StopInput {
  action: RecoveryAction;
  cause: string;
  retryCount: number;
  touchCount: number;
  isDnd: boolean;
  hasConsented: boolean;
  alreadyPaid: boolean;
  bankOutageActive: boolean;
  mandateRevoked: boolean;
  promiseToPay?: string | null; // ISO date — if in the future, we wait
  amountPaise: number;
  confidenceScore: number; // 0–1 from LLM or 1.0 for deterministic
}

export interface StopResult {
  blocked: boolean;
  stopCode?: StopCode;
  reason?: string;
}

const NPCI_MAX_RETRIES = 3;   // 1 original + 3 retries
const MAX_TOUCHES      = 3;
const AMOUNT_FLOOR     = 10_00; // ₹10 in paise — below this, not worth the outreach cost
const LOW_CONF         = 0.4;

/**
 * Ordered stop-rule checks. First match wins.
 * Policy wins if LLM disagrees — this function is the gate.
 */
export function checkStops(input: StopInput): StopResult {
  const { action, retryCount, touchCount, isDnd, hasConsented,
          alreadyPaid, bankOutageActive, mandateRevoked,
          promiseToPay, amountPaise, confidenceScore } = input;

  // 1. Already paid — no action needed
  if (alreadyPaid) {
    return { blocked: true, stopCode: "already_paid", reason: "Payment already received; case should be closed." };
  }

  // 2. NPCI retry cap — silent Autopay retries are capped at 1+3
  if (action === "silent_retry_at_window" && retryCount >= NPCI_MAX_RETRIES) {
    return { blocked: true, stopCode: "npci_retry_cap",
      reason: `NPCI allows 1 original + 3 retries. ${retryCount} retries already used.` };
  }

  // 3. Mandate has been revoked — Autopay retry is illegal
  if (mandateRevoked && action === "silent_retry_at_window") {
    return { blocked: true, stopCode: "mandate_revoked_block",
      reason: "Mandate is revoked; auto-debit would fail and violate regulations." };
  }

  // 4. Bank outage active — sending any contact is misleading
  if (bankOutageActive && action !== "do_nothing") {
    return { blocked: true, stopCode: "bank_outage_active",
      reason: "Bank/PSP outage is live. Contacting the customer now is a bug." };
  }

  // 5. DND opted-out — no outreach actions
  const outreachActions: RecoveryAction[] = [
    "send_method_update_link",
    "send_one_time_payment_link",
    "offer_pause",
    "hinglish_voice_script",
  ];
  if (isDnd && outreachActions.includes(action as RecoveryAction)) {
    return { blocked: true, stopCode: "dnd_opted_out",
      reason: "Customer is on DND. No outreach allowed." };
  }

  // 6. Consent required for voice
  if (!hasConsented && action === "hinglish_voice_script") {
    return { blocked: true, stopCode: "dnd_opted_out",
      reason: "Customer has not consented to voice outreach." };
  }

  // 7. Promise-to-pay date in the future — wait, don't chase
  if (promiseToPay) {
    const promiseDate = new Date(promiseToPay);
    if (!isNaN(promiseDate.getTime()) && promiseDate > new Date()) {
      return { blocked: true, stopCode: "promise_to_pay_pending",
        reason: `Customer promised to pay by ${promiseToPay}. Do not contact before then.` };
    }
  }

  // 8. Max touches reached
  if (touchCount >= MAX_TOUCHES && outreachActions.includes(action as RecoveryAction)) {
    return { blocked: true, stopCode: "max_touches_reached",
      reason: `${touchCount} outreach attempts already made. Escalate or close.` };
  }

  // 9. Amount below floor — not worth outreach cost
  if (amountPaise < AMOUNT_FLOOR) {
    return { blocked: true, stopCode: "amount_below_floor",
      reason: `Amount ₹${(amountPaise / 100).toFixed(2)} is below the ₹${AMOUNT_FLOOR / 100} outreach floor.` };
  }

  // 10. Low LLM confidence on unknown cause — escalate, don't guess
  if (confidenceScore < LOW_CONF) {
    return { blocked: true, stopCode: "low_confidence",
      reason: `LLM confidence ${(confidenceScore * 100).toFixed(0)}% is too low to act autonomously.` };
  }

  return { blocked: false };
}
