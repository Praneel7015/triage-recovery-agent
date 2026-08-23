import type { RecoveryAction, StopCode } from "@/db/schema";
import { costOfAction, isEconomicallySane, channelForAction } from "./economics";

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
  promiseToPay?: string | null;
  amountPaise: number;
  confidenceScore: number;
  /** Campaign context. */
  day?: number;
  spentPaise?: number;
  disputed?: boolean;
  ladderExhausted?: boolean;
  /** Reference date for promise-to-pay comparison; defaults to now. */
  now?: Date;
}

export interface StopResult {
  blocked: boolean;
  stopCode?: StopCode;
  reason?: string;
  /**
   * Permanent stops end the campaign. Transient stops only skip this step —
   * a promise-to-pay date, for example, means wait rather than give up.
   */
  permanent?: boolean;
}

export const NPCI_MAX_RETRIES   = 3;    // 1 original + 3 retries
export const MAX_TOUCHES        = 3;
export const AMOUNT_FLOOR_PAISE = 1_000; // ₹10
export const LOW_CONFIDENCE     = 0.4;
export const MAX_CAMPAIGN_DAYS  = 30;

const OUTREACH_ACTIONS: RecoveryAction[] = [
  "send_method_update_link",
  "send_one_time_payment_link",
  "offer_pause",
  "hinglish_voice_script",
];

function isOutreach(a: RecoveryAction): boolean {
  return OUTREACH_ACTIONS.includes(a);
}

/**
 * Ordered veto rules. First match wins.
 *
 * This is the only place an action can be blocked, and it runs on every step of
 * every campaign. Policy proposes; this function is what makes the agent safe to
 * point at real money.
 */
export function checkStops(input: StopInput): StopResult {
  const {
    action, retryCount, touchCount, isDnd, hasConsented, alreadyPaid,
    bankOutageActive, mandateRevoked, promiseToPay, amountPaise,
    confidenceScore, day = 0, spentPaise = 0, disputed = false,
    ladderExhausted = false, now = new Date(),
  } = input;

  // 1. Money is already in. Nothing to recover.
  if (alreadyPaid) {
    return { blocked: true, stopCode: "already_paid", permanent: true,
      reason: "Payment already received. Case closes without further action." };
  }

  // 2. Customer formally disputed the charge. Stop dunning, hand to a human.
  if (disputed) {
    return { blocked: true, stopCode: "customer_disputed", permanent: true,
      reason: "Customer disputed the charge. Automated collection must stop." };
  }

  // 3. Customer asked not to be contacted. Absolute, and it outranks revenue.
  if (isDnd && isOutreach(action)) {
    return { blocked: true, stopCode: "dnd_opted_out", permanent: true,
      reason: "Customer is on DND or has opted out. No outreach is permitted." };
  }

  // 4. Voice requires explicit consent.
  if (!hasConsented && action === "hinglish_voice_script") {
    return { blocked: true, stopCode: "dnd_opted_out", permanent: false,
      reason: "No consent on file for voice contact." };
  }

  // 5. Campaign window is over.
  if (day > MAX_CAMPAIGN_DAYS) {
    return { blocked: true, stopCode: "campaign_expired", permanent: true,
      reason: `Campaign exceeded its ${MAX_CAMPAIGN_DAYS}-day bound.` };
  }

  // 6. Escalation ladder has no rungs left.
  if (ladderExhausted && action === "do_nothing") {
    return { blocked: true, stopCode: "ladder_exhausted", permanent: true,
      reason: "All bounded interventions for this cause have been attempted." };
  }

  // 7. Regulatory retry cap on auto-debit.
  if (action === "silent_retry_at_window" && retryCount >= NPCI_MAX_RETRIES) {
    return { blocked: true, stopCode: "npci_retry_cap", permanent: false,
      reason: `NPCI permits 1 original debit plus 3 retries. ${retryCount} already used.` };
  }

  // 8. Retrying a revoked mandate is not just futile, it is not permitted.
  if (mandateRevoked && action === "silent_retry_at_window") {
    return { blocked: true, stopCode: "mandate_revoked_block", permanent: false,
      reason: "Mandate is revoked. Auto-debit against it is impermissible." };
  }

  // 9. Do not contact customers about our own outage.
  if (bankOutageActive && isOutreach(action)) {
    return { blocked: true, stopCode: "bank_outage_active", permanent: false,
      reason: "Bank/PSP outage is active. Contacting the customer now misattributes our failure." };
  }

  // 10. They told us when they will pay. Honour it.
  if (promiseToPay && isOutreach(action)) {
    const due = new Date(promiseToPay);
    if (!isNaN(due.getTime()) && due > now) {
      return { blocked: true, stopCode: "promise_to_pay_pending", permanent: false,
        reason: `Customer committed to pay by ${promiseToPay}. No contact before that date.` };
    }
  }

  // 11. Contact frequency cap.
  if (touchCount >= MAX_TOUCHES && isOutreach(action)) {
    return { blocked: true, stopCode: "max_touches_reached", permanent: true,
      reason: `${touchCount} outreach attempts already made. Further contact is harassment.` };
  }

  // 12. Too small to be worth pursuing at all.
  if (amountPaise < AMOUNT_FLOOR_PAISE && action !== "do_nothing") {
    return { blocked: true, stopCode: "amount_below_floor", permanent: true,
      reason: `₹${(amountPaise / 100).toFixed(2)} is below the ₹${AMOUNT_FLOOR_PAISE / 100} pursuit floor.` };
  }

  // 13. The touch costs too much relative to what is at stake.
  const econ = isEconomicallySane(action, amountPaise, spentPaise);
  if (!econ.sane) {
    return { blocked: true, stopCode: "uneconomic", permanent: false, reason: econ.reason };
  }

  // 14. We are not confident enough to spend money on a guess.
  if (confidenceScore < LOW_CONFIDENCE && action !== "do_nothing" && action !== "escalate_human") {
    return { blocked: true, stopCode: "low_confidence", permanent: false,
      reason: `Diagnosis confidence ${(confidenceScore * 100).toFixed(0)}% is below the ${LOW_CONFIDENCE * 100}% bar for autonomous spend.` };
  }

  return { blocked: false };
}
