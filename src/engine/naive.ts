import type { CaseInput } from "./agent";
import type { RecoveryAction } from "@/db/schema";

/**
 * Naive baseline: immediate retry + message everyone.
 * Used to prove Triage does better on the same batch.
 */
export interface NaiveResult {
  action: RecoveryAction;
  illegalRetry: boolean;   // retried a revoked mandate (bug)
  dndViolation: boolean;   // messaged a DND customer (bug)
  touchSent: boolean;
  recovered: boolean;      // determined by simulator
}

export function runNaive(c: CaseInput): NaiveResult {
  const NPCI_MAX = 3;

  // Naive always tries silent retry first regardless of cause
  const wantsRetry = c.retryCount < NPCI_MAX;

  // Illegal retry: mandate is revoked but naive retries anyway
  const illegalRetry = wantsRetry &&
    (c.errorReason === "mandate_revoked" ||
     c.errorReason === "mandate_cancelled" ||
     c.subscriptionState === "cancelled");

  // After retry cap, naive sends a payment link to everyone
  const wantsTouch = !wantsRetry || !illegalRetry;

  // DND violation: would send a message to DND customer
  const dndViolation = c.isDnd && wantsTouch;

  const action: RecoveryAction = wantsRetry ? "silent_retry_at_window" : "send_one_time_payment_link";

  return {
    action,
    illegalRetry,
    dndViolation,
    touchSent: wantsTouch && !dndViolation,
    recovered: false, // set by simulator
  };
}
