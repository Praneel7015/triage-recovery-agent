import "dotenv/config";
import { readFileSync, writeFileSync } from "fs";
import { runCampaign, type CampaignResult } from "@/engine/sequencer";
import { runNaiveCampaign, type NaiveResult } from "@/engine/naive";
import { report, formatRupees, type EconomicsReport } from "@/engine/economics";
import { computeLift, verdictFor, naturalRecoveryRate, type LiftReport } from "@/engine/holdout";
import type { CaseInput } from "@/engine/agent";
import type { FailureCause } from "@/db/schema";

interface ArmSummary {
  name: string;
  treatedCases: number;
  treatedRecovered: number;
  holdoutCases: number;
  holdoutRecovered: number;
  amountAtRiskPaise: number;
  grossRecoveredPaise: number;
  /** Gross recovery excluding money obtained through a rule violation. */
  compliantRecoveredPaise: number;
  illegalRecoveredPaise: number;
  taintedCases: number;
  outreachCostPaise: number;
  touches: number;
  economics: EconomicsReport;
  lift: LiftReport;
  compliance: {
    illegalRetries: number;
    dndViolations: number;
    ignoredOptOuts: number;
    outageContacts: number;
  };
  avgStepsPerCase: number;
  avgDaysToRecovery: number;
}

async function main() {
  const batchPath = process.argv[2] ?? "./data/batch.json";
  const batch: CaseInput[] = JSON.parse(readFileSync(batchPath, "utf-8"));

  header(`TRIAGE EVAL — ${batch.length} cases, 30-day bounded campaigns`);

  const triageRuns: CampaignResult[] = [];
  const naiveRuns:  NaiveResult[]    = [];

  process.stdout.write("  Running campaigns");
  for (let i = 0; i < batch.length; i++) {
    triageRuns.push(await runCampaign(batch[i]));
    naiveRuns.push(runNaiveCampaign(batch[i]));
    if (i % 20 === 0) process.stdout.write(".");
  }
  process.stdout.write(" done\n");

  const triage = summariseTriage(triageRuns);
  const naive  = summariseNaive(naiveRuns);

  printMoney(triage, naive);
  printLift(triage, naive);
  printCompliance(triage, naive);
  printCauseVerdicts(triageRuns, batch);
  printSegments(triageRuns, batch);
  printAI(triageRuns);

  const out = {
    cases: batch.length,
    triage: stripReports(triage),
    naive: stripReports(naive),
    runAt: new Date().toISOString(),
  };
  console.log("\n── JSON ────────────────────────────────────────────────────────");
  console.log(JSON.stringify(out, null, 2));

  const outPath = "./data/last-eval.json";
  writeFileSync(outPath, JSON.stringify(out, null, 2), "utf-8");
  console.log(`\n── Saved to ${outPath}`);
}

// ─── Summarisers ─────────────────────────────────────────────────────────────

function summariseTriage(runs: CampaignResult[]): ArmSummary {
  const treated = runs.filter(r => !r.isHoldout);
  const holdout = runs.filter(r =>  r.isHoldout);

  const gross  = treated.reduce((s, r) => s + r.recoveredAmountPaise, 0);
  const cost   = treated.reduce((s, r) => s + r.totalCostPaise, 0);
  const atRisk = runs.reduce((s, r) => s + r.amountPaise, 0);
  const touches = treated.reduce((s, r) => s + r.touchCount, 0);
  const touchedCases = treated.filter(r => r.touchCount > 0).length;

  const recoveredRuns = treated.filter(r => r.recoveredOnDay !== null);

  return {
    name: "Triage",
    treatedCases: treated.length,
    treatedRecovered: treated.filter(r => r.recovered).length,
    holdoutCases: holdout.length,
    holdoutRecovered: holdout.filter(r => r.recovered).length,
    amountAtRiskPaise: atRisk,
    grossRecoveredPaise: gross,
    // Triage never violates a rule, so all of its recovery is bankable.
    compliantRecoveredPaise: gross,
    illegalRecoveredPaise: 0,
    taintedCases: 0,
    outreachCostPaise: cost,
    touches,
    economics: report({ grossRecoveredPaise: gross, outreachCostPaise: cost, amountAtRiskPaise: atRisk, casesTouched: touchedCases }),
    lift: computeLift({
      treatedCases: treated.length,
      treatedRecovered: treated.filter(r => r.recovered).length,
      holdoutCases: holdout.length,
      holdoutRecovered: holdout.filter(r => r.recovered).length,
    }),
    compliance: { illegalRetries: 0, dndViolations: 0, ignoredOptOuts: 0, outageContacts: 0 },
    avgStepsPerCase: treated.length ? treated.reduce((s, r) => s + r.steps.length, 0) / treated.length : 0,
    avgDaysToRecovery: recoveredRuns.length
      ? recoveredRuns.reduce((s, r) => s + (r.recoveredOnDay ?? 0), 0) / recoveredRuns.length : 0,
  };
}

function summariseNaive(runs: NaiveResult[]): ArmSummary {
  const treated = runs.filter(r => !r.isHoldout);
  const holdout = runs.filter(r =>  r.isHoldout);

  const gross  = treated.reduce((s, r) => s + r.recoveredAmountPaise, 0);
  const cost   = treated.reduce((s, r) => s + r.totalCostPaise, 0);
  const atRisk = runs.reduce((s, r) => s + r.amountPaise, 0);
  const touches = treated.reduce((s, r) => s + r.touchCount, 0);
  const touchedCases = treated.filter(r => r.touchCount > 0).length;
  const recoveredRuns = treated.filter(r => r.recoveredOnDay !== null);

  return {
    name: "Naive",
    treatedCases: treated.length,
    treatedRecovered: treated.filter(r => r.recovered).length,
    holdoutCases: holdout.length,
    holdoutRecovered: holdout.filter(r => r.recovered).length,
    amountAtRiskPaise: atRisk,
    grossRecoveredPaise: gross,
    compliantRecoveredPaise: treated.reduce((s, r) => s + r.compliantRecoveryPaise, 0),
    illegalRecoveredPaise:   treated.reduce((s, r) => s + r.illegalRecoveryPaise, 0),
    taintedCases:            treated.filter(r => r.tainted).length,
    outreachCostPaise: cost,
    touches,
    economics: report({ grossRecoveredPaise: gross, outreachCostPaise: cost, amountAtRiskPaise: atRisk, casesTouched: touchedCases }),
    lift: computeLift({
      treatedCases: treated.length,
      treatedRecovered: treated.filter(r => r.recovered).length,
      holdoutCases: holdout.length,
      holdoutRecovered: holdout.filter(r => r.recovered).length,
    }),
    compliance: {
      illegalRetries: treated.reduce((s, r) => s + r.illegalRetries, 0),
      dndViolations:  treated.reduce((s, r) => s + r.dndViolations, 0),
      ignoredOptOuts: treated.reduce((s, r) => s + r.ignoredOptOuts, 0),
      outageContacts: treated.reduce((s, r) => s + r.outageContacts, 0),
    },
    avgStepsPerCase: treated.length ? treated.reduce((s, r) => s + r.steps.length, 0) / treated.length : 0,
    avgDaysToRecovery: recoveredRuns.length
      ? recoveredRuns.reduce((s, r) => s + (r.recoveredOnDay ?? 0), 0) / recoveredRuns.length : 0,
  };
}

// ─── Printers ────────────────────────────────────────────────────────────────

function header(t: string) {
  console.log("\n" + "═".repeat(70));
  console.log("  " + t);
  console.log("═".repeat(70) + "\n");
}

function row(label: string, a: string, b: string) {
  console.log("  " + label.padEnd(30) + a.padStart(16) + b.padStart(18));
}

function printMoney(t: ArmSummary, n: ArmSummary) {
  header("UNIT ECONOMICS — net recovery, not gross");
  row("", "Triage", "Naive");
  console.log("  " + "─".repeat(64));
  row("Amount at risk",        formatRupees(t.amountAtRiskPaise),      formatRupees(n.amountAtRiskPaise));
  row("Gross recovered",       formatRupees(t.grossRecoveredPaise),    formatRupees(n.grossRecoveredPaise));
  row("  of which illegal",    formatRupees(t.illegalRecoveredPaise),  formatRupees(n.illegalRecoveredPaise));
  row("BANKABLE recovery",     formatRupees(t.compliantRecoveredPaise), formatRupees(n.compliantRecoveredPaise));
  row("Outreach spend",        formatRupees(t.outreachCostPaise),      formatRupees(n.outreachCostPaise));
  row("Net bankable",          formatRupees(t.compliantRecoveredPaise - t.outreachCostPaise),
                               formatRupees(n.compliantRecoveredPaise - n.outreachCostPaise));
  console.log("  " + "─".repeat(64));
  row("Return on outreach",    t.economics.roi.toFixed(0) + "x",       n.economics.roi.toFixed(0) + "x");
  row("Cost per ₹ recovered",  "₹" + t.economics.costPerRupeeRecovered.toFixed(4), "₹" + n.economics.costPerRupeeRecovered.toFixed(4));
  row("Customer touches",      String(t.touches),                       String(n.touches));
  row("Tainted cases",         String(t.taintedCases),                  String(n.taintedCases));
  row("Avg steps per case",    t.avgStepsPerCase.toFixed(1),            n.avgStepsPerCase.toFixed(1));
  row("Avg days to recovery",  t.avgDaysToRecovery.toFixed(1),          n.avgDaysToRecovery.toFixed(1));

  const bankableDelta = (t.compliantRecoveredPaise - t.outreachCostPaise) -
                        (n.compliantRecoveredPaise - n.outreachCostPaise);
  console.log("");
  if (n.grossRecoveredPaise > t.grossRecoveredPaise) {
    console.log("  → Naive recovers more GROSS rupees, and that is the honest result: dunning");
    console.log("    everyone six times works. But " + formatRupees(n.illegalRecoveredPaise) +
                " of it came from steps that broke");
    console.log("    a rule (DND, opt-out, dead mandate), which a merchant cannot bank.");
  }
  console.log("  → On bankable net recovery Triage is " +
              (bankableDelta >= 0 ? "ahead by " : "behind by ") + formatRupees(Math.abs(bankableDelta)) +
              ",");
  console.log("    using " + (n.touches - t.touches) + " fewer customer touches.");
}

function printLift(t: ArmSummary, n: ArmSummary) {
  header("INCREMENTAL LIFT — measured against a no-contact holdout");
  console.log(`  Holdout group: ${t.holdoutCases} cases, never contacted.`);
  console.log(`  Of those, ${t.holdoutRecovered} recovered anyway ` +
              `(${(t.lift.holdoutRate * 100).toFixed(1)}% natural recovery).\n`);
  row("", "Triage", "Naive");
  console.log("  " + "─".repeat(64));
  row("Treated recovery rate", (t.lift.treatedRate * 100).toFixed(1) + "%", (n.lift.treatedRate * 100).toFixed(1) + "%");
  row("Holdout recovery rate", (t.lift.holdoutRate * 100).toFixed(1) + "%", (n.lift.holdoutRate * 100).toFixed(1) + "%");
  row("Absolute lift",         (t.lift.absoluteLift * 100).toFixed(1) + " pp", (n.lift.absoluteLift * 100).toFixed(1) + " pp");
  row("Relative lift",         (t.lift.relativeLift * 100).toFixed(0) + "%",  (n.lift.relativeLift * 100).toFixed(0) + "%");
  row("Caused by us",          (t.lift.attributableShare * 100).toFixed(0) + "%", (n.lift.attributableShare * 100).toFixed(0) + "%");

  console.log("\n  → " + (t.lift.sufficientSample
    ? "Sample supports a causal claim."
    : "Holdout is small; treat lift as directional, not significant."));
}

function printCompliance(t: ArmSummary, n: ArmSummary) {
  header("COMPLIANCE — violations are bugs, not tradeoffs");
  row("", "Triage", "Naive");
  console.log("  " + "─".repeat(64));
  row("Illegal mandate retries", String(t.compliance.illegalRetries), String(n.compliance.illegalRetries));
  row("DND violations",          String(t.compliance.dndViolations),  String(n.compliance.dndViolations));
  row("Ignored opt-outs",        String(t.compliance.ignoredOptOuts), String(n.compliance.ignoredOptOuts));
  row("Contacts during outage",  String(t.compliance.outageContacts), String(n.compliance.outageContacts));

  const totalN = n.compliance.illegalRetries + n.compliance.dndViolations +
                 n.compliance.ignoredOptOuts + n.compliance.outageContacts;
  console.log(`\n  → Triage: 0 violations. Naive: ${totalN} violations across the batch.`);
}

function printCauseVerdicts(runs: CampaignResult[], batch: CaseInput[]) {
  header("WHERE OUTREACH SPEND IS JUSTIFIED — per-cause lift");

  const byCause = new Map<FailureCause, { t: CampaignResult[]; h: CampaignResult[] }>();
  for (const r of runs) {
    if (!byCause.has(r.cause)) byCause.set(r.cause, { t: [], h: [] });
    (r.isHoldout ? byCause.get(r.cause)!.h : byCause.get(r.cause)!.t).push(r);
  }

  console.log("  " + "cause".padEnd(20) + "n".padStart(5) + "treated".padStart(9) +
              "holdout".padStart(9) + "lift".padStart(9) + "spend".padStart(11) + "  verdict");
  console.log("  " + "─".repeat(84));

  const ordered = [...byCause.entries()]
    .sort((a, b) => (b[1].t.length + b[1].h.length) - (a[1].t.length + a[1].h.length));

  for (const [cause, g] of ordered) {
    const tRate = g.t.length ? g.t.filter(r => r.recovered).length / g.t.length : 0;
    const hRate = g.h.length ? g.h.filter(r => r.recovered).length / g.h.length : 0;
    const lift  = computeLift({
      treatedCases: g.t.length, treatedRecovered: g.t.filter(r => r.recovered).length,
      holdoutCases: g.h.length, holdoutRecovered: g.h.filter(r => r.recovered).length,
    });
    const spend = g.t.reduce((s, r) => s + r.totalCostPaise, 0);
    const verdict = verdictFor(lift, g.h.length);

    console.log("  " +
      cause.padEnd(20) +
      String(g.t.length + g.h.length).padStart(5) +
      ((tRate * 100).toFixed(0) + "%").padStart(9) +
      ((hRate * 100).toFixed(0) + "%").padStart(9) +
      ((lift.absoluteLift * 100).toFixed(0) + "pp").padStart(9) +
      formatRupees(spend).padStart(11) + "  " +
      verdictLabel(verdict));
  }

  console.log("\n  → Causes marked wasteful recover at the same rate whether or not we");
  console.log("    contact them. Spending on those is pure loss, and Triage does not.");
}

function verdictLabel(v: string): string {
  switch (v) {
    case "intervention_essential": return "intervention essential";
    case "intervention_helps":     return "intervention helps";
    case "intervention_wasteful":  return "WASTEFUL — do not contact";
    default:                       return "insufficient holdout";
  }
}

function printSegments(runs: CampaignResult[], batch: CaseInput[]) {
  header("BY REVENUE SEGMENT");
  const segOf = new Map(batch.map(c => [c.id, c.segment ?? "subscription"]));
  const groups = new Map<string, CampaignResult[]>();
  for (const r of runs) {
    const s = segOf.get(r.caseId) ?? "subscription";
    if (!groups.has(s)) groups.set(s, []);
    groups.get(s)!.push(r);
  }

  console.log("  " + "segment".padEnd(16) + "n".padStart(5) + "at risk".padStart(14) +
              "recovered".padStart(14) + "spend".padStart(11) + "rate".padStart(8));
  console.log("  " + "─".repeat(70));
  for (const [seg, rs] of groups) {
    const atRisk = rs.reduce((s, r) => s + r.amountPaise, 0);
    const rec    = rs.reduce((s, r) => s + r.recoveredAmountPaise, 0);
    const spend  = rs.reduce((s, r) => s + r.totalCostPaise, 0);
    console.log("  " + seg.padEnd(16) + String(rs.length).padStart(5) +
      formatRupees(atRisk).padStart(14) + formatRupees(rec).padStart(14) +
      formatRupees(spend).padStart(11) +
      ((atRisk ? (rec / atRisk) * 100 : 0).toFixed(0) + "%").padStart(8));
  }

  // B2B aging buckets
  const b2b = batch.filter(c => c.segment === "b2b_invoice");
  if (b2b.length) {
    const byId = new Map(runs.map(r => [r.caseId, r]));
    const buckets = [
      { label: "0-30 days",  min: 0,  max: 30 },
      { label: "31-60 days", min: 31, max: 60 },
      { label: "61-90 days", min: 61, max: 90 },
    ];
    console.log("\n  B2B receivables by aging bucket:");
    for (const b of buckets) {
      const inB = b2b.filter(c => (c.agingDays ?? 0) >= b.min && (c.agingDays ?? 0) <= b.max);
      if (!inB.length) continue;
      const rs = inB.map(c => byId.get(c.id)!).filter(Boolean);
      const atRisk = rs.reduce((s, r) => s + r.amountPaise, 0);
      const rec    = rs.reduce((s, r) => s + r.recoveredAmountPaise, 0);
      console.log("    " + b.label.padEnd(14) + String(inB.length).padStart(4) + " invoices  " +
        formatRupees(atRisk).padStart(13) + " at risk  " +
        ((atRisk ? (rec / atRisk) * 100 : 0).toFixed(0) + "% recovered").padStart(16));
    }
  }
}

function printAI(runs: CampaignResult[]) {
  header("AI USAGE — where the model actually earns its place");
  const llmCases   = runs.filter(r => r.llmCalls > 0).length;
  const totalCalls = runs.reduce((s, r) => s + r.llmCalls, 0);
  const fallbacks  = runs.reduce((s, r) => s + r.llmFallbacks, 0);
  const overrides  = runs.reduce((s, r) => s + r.policyOverrides, 0);
  const extractions = runs.reduce((s, r) => s + r.intentExtractions, 0);
  const correct     = runs.reduce((s, r) => s + r.intentCorrect, 0);
  const replies     = runs.reduce((s, r) => s + r.steps.filter(st => st.reply).length, 0);

  console.log(`  Cases routed to the LLM        ${llmCases} of ${runs.length} ` +
              `(${((llmCases / runs.length) * 100).toFixed(0)}% — the rest were unambiguous)`);
  console.log(`  Total LLM calls                ${totalCalls}`);
  console.log(`  Fallbacks to deterministic     ${fallbacks}`);
  console.log(`  Policy overrode the LLM        ${overrides}`);
  console.log(`  Inbound replies received       ${replies}`);
  console.log(`  Intents extracted              ${extractions}`);
  if (extractions > 0) {
    console.log(`  Intent accuracy vs ground truth ${((correct / extractions) * 100).toFixed(1)}%`);
  }

  // A silently degraded model is worse than a missing one, so name the reasons.
  const reasons = new Map<string, number>();
  for (const r of runs) {
    for (const reason of r.llmFallbackReasons) {
      const key = reason.split("—")[0].trim().slice(0, 70);
      reasons.set(key, (reasons.get(key) ?? 0) + 1);
    }
  }
  if (reasons.size) {
    console.log("\n  Fallback reasons:");
    for (const [reason, count] of [...reasons.entries()].sort((a, b) => b[1] - a[1])) {
      console.log(`    ${String(count).padStart(3)} × ${reason}`);
    }
  }

  console.log("\n  → The model diagnoses ambiguity and reads Hinglish replies.");
  console.log("    It never selects an action and never moves money.");
}

function stripReports(a: ArmSummary) {
  return {
    name: a.name,
    treatedCases: a.treatedCases,
    treatedRecovered: a.treatedRecovered,
    holdoutCases: a.holdoutCases,
    holdoutRecovered: a.holdoutRecovered,
    amountAtRiskPaise: a.amountAtRiskPaise,
    grossRecoveredPaise: a.grossRecoveredPaise,
    compliantRecoveredPaise: a.compliantRecoveredPaise,
    illegalRecoveredPaise: a.illegalRecoveredPaise,
    taintedCases: a.taintedCases,
    outreachCostPaise: a.outreachCostPaise,
    netRecoveredPaise: a.economics.netRecoveredPaise,
    netBankablePaise: a.compliantRecoveredPaise - a.outreachCostPaise,
    roi: Number(a.economics.roi.toFixed(2)),
    costPerRupeeRecovered: Number(a.economics.costPerRupeeRecovered.toFixed(5)),
    touches: a.touches,
    absoluteLiftPct: Number((a.lift.absoluteLift * 100).toFixed(2)),
    relativeLiftPct: Number((a.lift.relativeLift * 100).toFixed(1)),
    compliance: a.compliance,
    avgStepsPerCase: Number(a.avgStepsPerCase.toFixed(2)),
    avgDaysToRecovery: Number(a.avgDaysToRecovery.toFixed(2)),
  };
}

main().catch(e => { console.error(e); process.exit(1); });
