import type { FailureCause, RecoveryAction } from "@/db/schema";

/**
 * Cause-faithful simulator.
 * Given the failure cause and proposed action, returns whether recovery succeeds.
 * Rules reflect real payment physics — not random.
 */
export interface SimInput {
  cause: FailureCause;
  action: RecoveryAction;
  blocked: boolean;
  retryCount: number;
  salaryWindowHint?: string | null;
  bankOutageActive?: boolean;
  amountPaise: number;
}

export interface SimResult {
  recovered: boolean;
  simulatedReason: string;
}

export function simulate(input: SimInput): SimResult {
  const { cause, action, blocked, bankOutageActive } = input;

  // Blocked actions never recover
  if (blocked) {
    return { recovered: false, simulatedReason: "Action was blocked by stop rules." };
  }

  switch (cause) {
    case "insufficient_funds": {
      if (action === "silent_retry_at_window") {
        // Post-salary window retries have ~65% success rate
        const salaryBoost = input.salaryWindowHint ? 0.15 : 0;
        return seeded(input, 0.65 + salaryBoost, "Salary window retry succeeded.", "Account still empty at retry time.");
      }
      if (action === "send_one_time_payment_link") {
        return seeded(input, 0.55, "Customer used payment link.", "Customer ignored payment link.");
      }
      if (action === "hinglish_voice_script") {
        return seeded(input, 0.72, "Voice call prompted immediate payment.", "Customer did not respond to voice.");
      }
      return { recovered: false, simulatedReason: "Action not suited for insufficient funds." };
    }

    case "bank_outage":
    case "psp_down": {
      if (action === "do_nothing") {
        // Outage clears; next natural billing cycle succeeds
        return seeded(input, 0.80, "Outage cleared; next cycle succeeded.", "Outage extended beyond billing window.");
      }
      // Any action during an outage fails and may harm customer trust
      return { recovered: false, simulatedReason: "Outage still active; any action fails." };
    }

    case "mandate_revoked": {
      if (action === "silent_retry_at_window") {
        // Retrying a revoked mandate always fails — illegal action
        return { recovered: false, simulatedReason: "Mandate is revoked. Auto-debit is impossible." };
      }
      if (action === "send_one_time_payment_link") {
        return seeded(input, 0.45, "Customer used one-time link.", "Customer did not complete payment.");
      }
      if (action === "send_method_update_link") {
        return seeded(input, 0.35, "Customer created a new mandate.", "Customer did not update payment method.");
      }
      return { recovered: false, simulatedReason: "Action not effective for revoked mandate." };
    }

    case "instrument_expired": {
      if (action === "send_method_update_link") {
        return seeded(input, 0.60, "Customer updated card; subscription resumed.", "Customer did not update instrument.");
      }
      if (action === "send_one_time_payment_link") {
        return seeded(input, 0.50, "Customer paid via alternate method.", "Customer did not complete payment.");
      }
      return { recovered: false, simulatedReason: "Expired instrument cannot be charged directly." };
    }

    case "customer_cancelled": {
      if (action === "do_nothing") {
        // Voluntary churn: do nothing is correct, no recovery attempt
        return { recovered: false, simulatedReason: "Voluntary cancellation; no recovery attempted (correct behavior)." };
      }
      if (action === "offer_pause") {
        return seeded(input, 0.30, "Customer accepted pause offer instead of cancelling.", "Customer declined pause offer.");
      }
      return { recovered: false, simulatedReason: "Chasing a voluntary cancellation backfires." };
    }

    case "upi_hang": {
      if (action === "send_one_time_payment_link") {
        return seeded(input, 0.70, "Fresh payment link succeeded.", "Customer abandoned fresh link too.");
      }
      if (action === "send_method_update_link") {
        return seeded(input, 0.55, "Customer switched to card; succeeded.", "Customer did not switch method.");
      }
      return { recovered: false, simulatedReason: "UPI hang not addressed." };
    }

    case "auth_failed": {
      if (action === "send_one_time_payment_link") {
        return seeded(input, 0.60, "Customer re-authenticated successfully.", "Authentication failed again.");
      }
      return { recovered: false, simulatedReason: "Auth failure requires customer action." };
    }

    case "unknown": {
      if (action === "escalate_human") {
        return seeded(input, 0.50, "Human agent resolved the case.", "Human escalation did not resolve.");
      }
      return { recovered: false, simulatedReason: "Unknown cause; no automated action." };
    }

    default:
      return { recovered: false, simulatedReason: "No simulation rule for this cause/action combination." };
  }
}

/** Seeded deterministic pseudo-random using case fields as seed */
function seeded(
  input: SimInput,
  successRate: number,
  successMsg: string,
  failMsg: string,
): SimResult {
  // Cheap deterministic hash from amount + retryCount
  const hash = (input.amountPaise * 31 + input.retryCount * 17) % 100;
  const recovered = hash < successRate * 100;
  return { recovered, simulatedReason: recovered ? successMsg : failMsg };
}
