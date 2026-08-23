import type { FailureCause } from "@/db/schema";
import { roll } from "./rng";

/**
 * Holdout control group and natural recovery.
 *
 * Some failed payments recover with no intervention at all: an outage clears and
 * the next scheduled debit succeeds, or the customer notices and pays unprompted.
 * A recovery agent that counts those as its own wins is lying to the merchant.
 *
 * We therefore hold back a fraction of cases with ZERO contact, measure how many
 * recover on their own, and report incremental lift — recovery we actually caused.
 */

export const HOLDOUT_FRACTION = 0.10;

/**
 * Deterministic holdout assignment.
 * Stable across runs so eval is reproducible, and independent of cause so the
 * control group is not biased toward easy or hard cases.
 */
export function isHoldout(caseId: string, fraction = HOLDOUT_FRACTION): boolean {
  return roll(`${caseId}|holdout-assignment`) < fraction;
}

/**
 * Probability a case recovers with no intervention whatsoever.
 *
 * These rates are the crux of the thesis. A bank outage mostly fixes itself, so
 * contacting those customers buys almost nothing. A revoked mandate almost never
 * fixes itself, so that is where intervention earns its cost.
 */
export const NATURAL_RECOVERY_RATE: Record<FailureCause, number> = {
  bank_outage:        0.65, // outage clears, next debit succeeds on its own
  psp_down:           0.60,
  upi_hang:           0.35, // customer simply tries again
  auth_failed:        0.30, // retries with the correct OTP
  insufficient_funds: 0.22, // some top up and pay unprompted
  instrument_expired: 0.12, // a few update the card themselves
  unknown:            0.10,
  mandate_revoked:    0.03, // they cancelled deliberately
  customer_cancelled: 0.02,
};

export function naturalRecoveryRate(cause: FailureCause): number {
  return NATURAL_RECOVERY_RATE[cause] ?? 0.10;
}

/**
 * Simulates whether an untouched case recovers by itself.
 * Seeded on the case id so holdout outcomes are reproducible.
 */
export function simulateNaturalRecovery(caseId: string, cause: FailureCause): boolean {
  return roll(`${caseId}|natural-recovery`) < naturalRecoveryRate(cause);
}

// ─── Lift analysis ───────────────────────────────────────────────────────────

export interface LiftInput {
  treatedCases: number;
  treatedRecovered: number;
  holdoutCases: number;
  holdoutRecovered: number;
}

export interface LiftReport {
  treatedRate: number;
  holdoutRate: number;
  /** Percentage points of recovery we actually caused. */
  absoluteLift: number;
  /** Relative improvement over doing nothing. */
  relativeLift: number;
  /** Share of treated recoveries that would have happened anyway. */
  attributableShare: number;
  sufficientSample: boolean;
}

export function computeLift(input: LiftInput): LiftReport {
  const { treatedCases, treatedRecovered, holdoutCases, holdoutRecovered } = input;

  const treatedRate = treatedCases > 0 ? treatedRecovered / treatedCases : 0;
  const holdoutRate = holdoutCases > 0 ? holdoutRecovered / holdoutCases : 0;
  const absoluteLift = treatedRate - holdoutRate;

  return {
    treatedRate,
    holdoutRate,
    absoluteLift,
    relativeLift: holdoutRate > 0 ? absoluteLift / holdoutRate : 0,
    attributableShare: treatedRate > 0 ? absoluteLift / treatedRate : 0,
    // Small batches cannot support a confident causal claim; say so rather than overclaim.
    sufficientSample: holdoutCases >= 10 && treatedCases >= 30,
  };
}

/**
 * Per-cause lift tells the merchant where outreach spend is justified.
 * Near-zero lift on a cause means: stop paying to contact these people.
 */
export interface CauseLift {
  cause: FailureCause;
  treatedCases: number;
  treatedRecovered: number;
  holdoutCases: number;
  holdoutRecovered: number;
  naturalRate: number;
  lift: LiftReport;
  spendPaise: number;
  verdict: "intervention_essential" | "intervention_helps" | "intervention_wasteful" | "insufficient_data";
}

export function verdictFor(lift: LiftReport, holdoutCases: number): CauseLift["verdict"] {
  if (holdoutCases < 3) return "insufficient_data";
  if (lift.absoluteLift >= 0.25) return "intervention_essential";
  if (lift.absoluteLift >= 0.08) return "intervention_helps";
  return "intervention_wasteful";
}
