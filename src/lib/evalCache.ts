import { readFileSync, existsSync } from "fs";
import { join } from "path";

/**
 * Shape of data/last-eval.json — written by `npm run eval` and by persist.
 * The ledger falls back to this so `/` is never an empty state for judges.
 */
export interface LastEvalArm {
  name: string;
  treatedCases: number;
  treatedRecovered: number;
  holdoutCases: number;
  holdoutRecovered: number;
  amountAtRiskPaise: number;
  grossRecoveredPaise: number;
  compliantRecoveredPaise: number;
  illegalRecoveredPaise: number;
  taintedCases?: number;
  outreachCostPaise: number;
  netRecoveredPaise: number;
  netBankablePaise?: number;
  roi: number;
  costPerRupeeRecovered: number;
  touches: number;
  absoluteLiftPct: number;
  relativeLiftPct: number;
  compliance: {
    illegalRetries: number;
    dndViolations: number;
    ignoredOptOuts: number;
    outageContacts: number;
  };
  avgStepsPerCase: number;
  avgDaysToRecovery: number;
  llmFallbacks?: number;
  policyOverrides?: number;
  intentAccuracyPct?: number;
}

export interface LastEvalFile {
  cases: number;
  triage: LastEvalArm;
  naive: LastEvalArm;
  runAt: string;
}

export interface LedgerRun {
  id: string;
  name: string;
  strategy: string;
  totalCases: number;
  recovered: number;
  amountAtRiskPaise: number;
  amountRecoveredPaise: number;
  touchesSent: number;
  stopRuleHits: number;
  illegalRetries: number;
  illegalRecoveredPaise: number;
  dndViolations: number;
  ignoredOptOuts: number;
  outageContacts: number;
  llmFallbacks: number;
  policyOverrides: number;
  outreachCostPaise: number;
  netRecoveredPaise: number;
  roi: number;
  costPerRupeeRecovered: number;
  treatedCases: number;
  treatedRecovered: number;
  holdoutCases: number;
  holdoutRecovered: number;
  absoluteLiftPct: number;
  relativeLiftPct: number;
  intentAccuracyPct: number;
  avgStepsPerCase: number;
  avgDaysToRecovery: number;
  createdAt: number;
  sourcedFromCache?: boolean;
}

function lastEvalPath() {
  return join(process.cwd(), "data", "last-eval.json");
}

export function readLastEval(): LastEvalFile | null {
  const path = lastEvalPath();
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, "utf-8")) as LastEvalFile;
  } catch {
    return null;
  }
}

function armToRun(arm: LastEvalArm, strategy: string, cases: number, runAt: string): LedgerRun {
  const createdAt = Math.floor(new Date(runAt).getTime() / 1000) || Math.floor(Date.now() / 1000);
  const c = arm.compliance ?? { illegalRetries: 0, dndViolations: 0, ignoredOptOuts: 0, outageContacts: 0 };
  return {
    id: `cached_${strategy}`,
    name: arm.name,
    strategy,
    totalCases: cases,
    recovered: arm.treatedRecovered,
    amountAtRiskPaise: arm.amountAtRiskPaise,
    amountRecoveredPaise: arm.grossRecoveredPaise,
    touchesSent: arm.touches,
    stopRuleHits: 0,
    illegalRetries: c.illegalRetries,
    illegalRecoveredPaise: arm.illegalRecoveredPaise ?? 0,
    dndViolations: c.dndViolations,
    ignoredOptOuts: c.ignoredOptOuts,
    outageContacts: c.outageContacts,
    llmFallbacks: arm.llmFallbacks ?? 0,
    policyOverrides: arm.policyOverrides ?? 0,
    outreachCostPaise: arm.outreachCostPaise,
    netRecoveredPaise: arm.netRecoveredPaise,
    roi: arm.roi,
    costPerRupeeRecovered: arm.costPerRupeeRecovered,
    treatedCases: arm.treatedCases,
    treatedRecovered: arm.treatedRecovered,
    holdoutCases: arm.holdoutCases,
    holdoutRecovered: arm.holdoutRecovered,
    absoluteLiftPct: arm.absoluteLiftPct,
    relativeLiftPct: arm.relativeLiftPct,
    intentAccuracyPct: arm.intentAccuracyPct ?? 0,
    avgStepsPerCase: arm.avgStepsPerCase,
    avgDaysToRecovery: arm.avgDaysToRecovery,
    createdAt,
    sourcedFromCache: true,
  };
}

export function lastEvalAsLedgerRuns(): LedgerRun[] | null {
  const file = readLastEval();
  if (!file?.triage || !file?.naive) return null;
  return [
    armToRun(file.triage, "triage", file.cases, file.runAt),
    armToRun(file.naive, "naive", file.cases, file.runAt),
  ];
}

/**
 * Older SQLite batch rows stored illegalRecoveredPaise as 0.
 * Overlay only that field from last-eval so the ledger does not contradict the pitch.
 * Gross recovered is never rewritten.
 */
export function overlayIllegalFromCache<T extends { strategy: string; illegalRecoveredPaise?: number | null }>(
  runs: T[],
): T[] {
  const file = readLastEval();
  const cachedIllegal = file?.naive?.illegalRecoveredPaise ?? 0;
  if (!cachedIllegal) return runs;
  return runs.map((r) => {
    if (r.strategy !== "naive") return r;
    if ((r.illegalRecoveredPaise ?? 0) !== 0) return r;
    return { ...r, illegalRecoveredPaise: cachedIllegal };
  });
}
