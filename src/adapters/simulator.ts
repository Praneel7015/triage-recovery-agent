import type { FailureCause, RecoveryAction } from "@/db/schema";
import { roll } from "@/engine/rng";

/**
 * Cause-faithful outcome simulator.
 *
 * The success of a recovery action depends on why the payment failed. Retrying a
 * revoked mandate cannot work no matter how many times you try; retrying an empty
 * account after payday usually does. Encoding that relationship is what lets the
 * eval distinguish a good decision from a lucky one.
 *
 * Base rates are anchored to published dunning and smart-retry benchmarks for the
 * Indian market rather than tuned to flatter the agent. Every draw is seeded on
 * the case id so both strategy arms face identical luck.
 */

export interface SimInput {
  caseId: string;
  cause: FailureCause;
  action: RecoveryAction;
  blocked: boolean;
  retryCount: number;
  salaryWindowHint?: string | null;
  bankOutageActive?: boolean;
  amountPaise: number;
  /** Which campaign step this is, so repeated attempts decay. */
  stepIndex?: number;
}

export interface SimOutput {
  recovered: boolean;
  simulatedReason: string;
}

/** P(recovery | cause, action) for a single attempt. */
const RATES: Partial<Record<FailureCause, Partial<Record<RecoveryAction, number>>>> = {
  insufficient_funds: {
    silent_retry_at_window:     0.45,
    send_one_time_payment_link: 0.30,
    hinglish_voice_script:      0.40,
    escalate_human:             0.46,
    send_method_update_link:    0.14,
    do_nothing:                 0.22,
  },
  bank_outage: {
    silent_retry_at_window:     0.55,
    send_one_time_payment_link: 0.25,
    hinglish_voice_script:      0.20,
    escalate_human:             0.28,
    do_nothing:                 0.65,
  },
  psp_down: {
    silent_retry_at_window:     0.52,
    send_one_time_payment_link: 0.30,
    do_nothing:                 0.60,
    escalate_human:             0.26,
  },
  mandate_revoked: {
    silent_retry_at_window:     0.00, // structurally impossible
    send_one_time_payment_link: 0.28,
    send_method_update_link:    0.22,
    hinglish_voice_script:      0.24,
    escalate_human:             0.30,
    offer_pause:                0.16,
    do_nothing:                 0.03,
  },
  instrument_expired: {
    silent_retry_at_window:     0.02, // expired card will not clear
    send_method_update_link:    0.38,
    send_one_time_payment_link: 0.30,
    hinglish_voice_script:      0.32,
    escalate_human:             0.34,
    do_nothing:                 0.12,
  },
  customer_cancelled: {
    silent_retry_at_window:     0.01,
    offer_pause:                0.18,
    send_one_time_payment_link: 0.08,
    hinglish_voice_script:      0.12,
    escalate_human:             0.15,
    do_nothing:                 0.02,
  },
  upi_hang: {
    send_one_time_payment_link: 0.48,
    silent_retry_at_window:     0.35,
    send_method_update_link:    0.30,
    hinglish_voice_script:      0.34,
    escalate_human:             0.36,
    do_nothing:                 0.35,
  },
  auth_failed: {
    send_one_time_payment_link: 0.42,
    send_method_update_link:    0.28,
    silent_retry_at_window:     0.20,
    hinglish_voice_script:      0.30,
    escalate_human:             0.32,
    do_nothing:                 0.30,
  },
  unknown: {
    escalate_human:             0.35,
    send_one_time_payment_link: 0.18,
    silent_retry_at_window:     0.12,
    do_nothing:                 0.10,
  },
};

export function simulate(input: SimInput): SimOutput {
  const { caseId, cause, action, blocked, retryCount, salaryWindowHint, bankOutageActive, amountPaise } = input;
  const step = input.stepIndex ?? 0;

  if (blocked) {
    return { recovered: false, simulatedReason: "Action was blocked, so nothing was attempted." };
  }

  let rate = RATES[cause]?.[action] ?? 0.05;
  const notes: string[] = [];

  // Retrying a dead mandate or expired card cannot succeed, whatever the cadence.
  if (rate === 0) {
    return {
      recovered: false,
      simulatedReason: `${action} cannot succeed against ${cause}: the payment instrument is structurally unusable.`,
    };
  }

  // Timing a silent retry to the salary cycle materially improves an NSF retry.
  if (action === "silent_retry_at_window" && cause === "insufficient_funds" && salaryWindowHint) {
    rate += 0.12;
    notes.push(`retry aligned to the ${salaryWindowHint} credit window`);
  }

  // Contacting a customer mid-outage does not help and mildly annoys them.
  if (bankOutageActive && action !== "do_nothing" && action !== "silent_retry_at_window") {
    rate *= 0.45;
    notes.push("attempted while the outage was still live");
  }

  // Each additional NPCI retry is less likely to clear than the last.
  if (action === "silent_retry_at_window" && retryCount > 1) {
    rate *= Math.pow(0.72, retryCount - 1);
    notes.push(`retry ${retryCount} carries decayed odds`);
  }

  // Repeated contact suffers fatigue.
  if (step > 0 && action !== "silent_retry_at_window" && action !== "do_nothing") {
    rate *= Math.pow(0.80, step);
    notes.push(`message fatigue at step ${step}`);
  }

  // Large amounts are harder to clear in one go.
  if (amountPaise > 500_000) {
    rate *= 0.88;
    notes.push("large ticket size");
  }

  rate = Math.max(0, Math.min(1, rate));

  const recovered = roll(`${caseId}|${cause}|${action}|${step}|${retryCount}`) < rate;

  const detail = notes.length ? ` (${notes.join("; ")})` : "";
  return {
    recovered,
    simulatedReason: recovered
      ? `${action} cleared against ${cause} at ${(rate * 100).toFixed(0)}% odds${detail}.`
      : `${action} did not clear against ${cause} at ${(rate * 100).toFixed(0)}% odds${detail}.`,
  };
}
