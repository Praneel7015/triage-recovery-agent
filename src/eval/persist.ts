import "dotenv/config";
import { db } from "@/db/client";
import { migrate } from "@/db/migrate";
import { cases, auditLog, batchRuns, campaignSteps } from "@/db/schema";
import { runCampaign, type CampaignResult } from "@/engine/sequencer";
import { runNaiveCampaign, type NaiveResult } from "@/engine/naive";
import { report } from "@/engine/economics";
import { computeLift } from "@/engine/holdout";
import { classifyCause } from "@/engine/taxonomy";
import type { CaseInput } from "@/engine/agent";
import { readFileSync } from "fs";
import { randomUUID } from "crypto";
import { eq, isNotNull } from "drizzle-orm";

migrate();

function clearPriorEvalCases() {
  const old = db.select({ id: cases.id }).from(cases).where(isNotNull(cases.batchId)).all();
  for (const { id } of old) {
    db.delete(campaignSteps).where(eq(campaignSteps.caseId, id)).run();
    db.delete(auditLog).where(eq(auditLog.caseId, id)).run();
  }
  db.delete(cases).where(isNotNull(cases.batchId)).run();
}

/**
 * Runs both strategies over the batch and persists everything the UI needs:
 * the case, its campaign steps day by day, its audit trail, and the aggregate
 * economics and lift for each arm.
 */
export async function runBatch(batchPath = "./data/batch.json") {
  const now = Math.floor(Date.now() / 1000);
  clearPriorEvalCases();
  const raws = JSON.parse(readFileSync(batchPath, "utf-8")) as CaseInput[];

  const triageRunId = randomUUID();
  const naiveRunId  = randomUUID();

  db.insert(batchRuns).values([
    { id: triageRunId, name: "Triage", strategy: "triage", totalCases: raws.length, createdAt: now },
    { id: naiveRunId,  name: "Naive",  strategy: "naive",  totalCases: raws.length, createdAt: now },
  ]).run();

  const triageRuns: CampaignResult[] = [];
  const naiveRuns:  NaiveResult[]    = [];

  for (const raw of raws) {
    const triage = await runCampaign(raw);
    const naive  = runNaiveCampaign(raw);
    triageRuns.push(triage);
    naiveRuns.push(naive);

    persistTriageCase(raw, triage, triageRunId);
    persistNaiveCase(raw, naive, naiveRunId);
  }

  writeSummary(triageRunId, raws, triageRuns, null);
  writeSummary(naiveRunId,  raws, null, naiveRuns);

  return { triageRunId, naiveRunId };
}

// ─── Case persistence ────────────────────────────────────────────────────────

function baseCaseRow(raw: CaseInput, batchId: string, isNaive: boolean) {
  const ts = Math.floor(Date.now() / 1000);
  return {
    id: `${raw.id}_${isNaive ? "naive" : "triage"}`,
    customerId: raw.customerId,
    customerName: raw.customerName,
    customerPhone: raw.customerPhone ?? null,
    customerEmail: raw.customerEmail ?? null,
    amountPaise: raw.amountPaise,
    currency: raw.currency ?? "INR",
    paymentMethod: raw.paymentMethod,
    subscriptionId: raw.subscriptionId ?? null,
    subscriptionState: raw.subscriptionState ?? null,
    errorCode: raw.errorCode ?? null,
    errorReason: raw.errorReason ?? null,
    errorSource: raw.errorSource ?? null,
    errorStep: raw.errorStep ?? null,
    errorDescription: raw.errorDescription ?? null,
    retryCount: raw.retryCount ?? 0,
    touchCount: raw.touchCount ?? 0,
    isDnd: raw.isDnd ?? false,
    hasConsented: raw.hasConsented ?? true,
    salaryWindowHint: raw.salaryWindowHint ?? null,
    bankOutageActive: raw.bankOutageActive ?? false,
    segment: raw.segment ?? "subscription",
    invoiceId: raw.invoiceId ?? null,
    invoiceDueDate: raw.invoiceDueDate ?? null,
    agingDays: raw.agingDays ?? null,
    failedAt: (raw as any).failedAt ?? ts,
    createdAt: ts,
    updatedAt: ts,
    batchId,
    isNaiveRun: isNaive,
  };
}

function persistTriageCase(raw: CaseInput, r: CampaignResult, batchId: string) {
  const caseId = `${raw.id}_triage`;
  const ts = Math.floor(Date.now() / 1000);

  db.delete(auditLog).where(eq(auditLog.caseId, caseId)).run();
  db.delete(campaignSteps).where(eq(campaignSteps.caseId, caseId)).run();

  db.insert(cases).values({
    ...baseCaseRow(raw, batchId, false),
    cause: r.cause as any,
    diagnosisNarrative: r.diagnosisNarrative,
    actionTaken: (r.steps.find(s => !s.blocked)?.action ?? "do_nothing") as any,
    stopCode: (r.finalStopCode ?? null) as any,
    status: r.finalStatus as any,
    promiseToPay: r.promiseToPay,
    isHoldout: r.isHoldout,
    totalCostPaise: r.totalCostPaise,
    recoveredAmountPaise: r.recoveredAmountPaise,
    recoveredOnDay: r.recoveredOnDay,
    stepCount: r.steps.length,
    confidenceScore: r.confidence,
    llmCalls: r.llmCalls,
    llmFallbacks: r.llmFallbacks,
    policyOverrides: r.policyOverrides,
    optedOut: r.optedOut,
    disputed: r.disputed,
    resolvedAt: r.recovered ? ts : null,
  }).run();

  for (const e of r.auditTrail) {
    db.insert(auditLog).values({
      id: randomUUID(), caseId, ts,
      actor: e.actor, event: e.event, detail: e.detail,
      llmUsed: e.llmUsed ?? false,
      llmFallback: e.llmFallback ?? false,
      policyOverride: e.policyOverride ?? false,
      day: e.day ?? null,
    }).run();
  }

  for (const s of r.steps) {
    db.insert(campaignSteps).values({
      id: randomUUID(), caseId, batchId,
      day: s.day, stepIndex: s.stepIndex,
      action: s.action as any, channel: s.channel,
      costPaise: s.costPaise, rationale: s.rationale,
      blocked: s.blocked,
      stopCode: (s.stopCode ?? null) as any,
      stopReason: s.stopReason ?? null,
      outcome: s.outcome, outcomeReason: s.outcomeReason,
      replyText: s.reply?.text ?? null,
      replyGroundTruth: s.reply?.groundTruth ?? null,
      intent: s.intent?.intent ?? null,
      intentConfidence: s.intent?.confidence ?? null,
      intentMethod: s.intent?.method ?? null,
      promiseDate: s.intent?.promiseDate ?? null,
      voiceScript: s.voiceScript ?? null,
    }).run();
  }
}

function persistNaiveCase(raw: CaseInput, r: NaiveResult, batchId: string) {
  const caseId = `${raw.id}_naive`;
  const ts = Math.floor(Date.now() / 1000);

  db.delete(auditLog).where(eq(auditLog.caseId, caseId)).run();
  db.delete(campaignSteps).where(eq(campaignSteps.caseId, caseId)).run();

  const cause = classifyCause({
    errorCode: raw.errorCode, errorReason: raw.errorReason,
    errorSource: raw.errorSource, errorStep: raw.errorStep,
    errorDescription: raw.errorDescription,
    bankOutageActive: raw.bankOutageActive ?? false,
    subscriptionState: raw.subscriptionState,
    paymentMethod: raw.paymentMethod,
  });

  db.insert(cases).values({
    ...baseCaseRow(raw, batchId, true),
    cause: cause as any,
    diagnosisNarrative: "Naive baseline does not diagnose. It applies a fixed dunning cadence to every case.",
    actionTaken: (r.steps[0]?.action ?? "do_nothing") as any,
    status: (r.recovered ? "recovered" : "unrecoverable") as any,
    isHoldout: r.isHoldout,
    totalCostPaise: r.totalCostPaise,
    recoveredAmountPaise: r.recoveredAmountPaise,
    recoveredOnDay: r.recoveredOnDay,
    stepCount: r.steps.length,
    resolvedAt: r.recovered ? ts : null,
  }).run();

  for (const s of r.steps) {
    const violations = [
      s.illegalRetry  ? "illegal retry against a dead mandate" : null,
      s.dndViolation  ? "contacted a DND customer"             : null,
      s.ignoredOptOut ? "contacted after an explicit opt-out"  : null,
      s.outageContact ? "contacted during a live outage"       : null,
    ].filter(Boolean);

    db.insert(campaignSteps).values({
      id: randomUUID(), caseId, batchId,
      day: s.day, stepIndex: r.steps.indexOf(s),
      action: s.action as any, channel: s.channel,
      costPaise: s.costPaise,
      rationale: "Fixed cadence, applied without regard to cause.",
      blocked: false,
      outcome: s.recovered ? "recovered" : "no_response",
      outcomeReason: violations.length
        ? `VIOLATION: ${violations.join("; ")}.`
        : "Executed with no diagnosis and no stop-rule check.",
    }).run();

    if (violations.length) {
      db.insert(auditLog).values({
        id: randomUUID(), caseId, ts,
        actor: "naive", event: "compliance_violation",
        detail: `Day ${s.day}: ${violations.join("; ")}.`,
        day: s.day,
      }).run();
    }
  }
}

// ─── Aggregate summaries ─────────────────────────────────────────────────────

function writeSummary(
  runId: string,
  raws: CaseInput[],
  triage: CampaignResult[] | null,
  naive: NaiveResult[] | null,
) {
  const atRisk = raws.reduce((s, c) => s + c.amountPaise, 0);
  const done   = Math.floor(Date.now() / 1000);

  if (triage) {
    const treated = triage.filter(r => !r.isHoldout);
    const hold    = triage.filter(r =>  r.isHoldout);
    const gross   = treated.reduce((s, r) => s + r.recoveredAmountPaise, 0);
    const cost    = treated.reduce((s, r) => s + r.totalCostPaise, 0);
    const touched = treated.filter(r => r.touchCount > 0).length;
    const econ    = report({ grossRecoveredPaise: gross, outreachCostPaise: cost, amountAtRiskPaise: atRisk, casesTouched: touched });
    const lift    = computeLift({
      treatedCases: treated.length, treatedRecovered: treated.filter(r => r.recovered).length,
      holdoutCases: hold.length,    holdoutRecovered: hold.filter(r => r.recovered).length,
    });
    const replies = triage.reduce((s, r) => s + r.steps.filter(st => st.reply).length, 0);
    const extractions = triage.reduce((s, r) => s + r.intentExtractions, 0);
    const correct = triage.reduce((s, r) => s + r.intentCorrect, 0);
    const recoveredRuns = treated.filter(r => r.recoveredOnDay !== null);

    db.update(batchRuns).set({
      recovered: treated.filter(r => r.recovered).length,
      amountAtRiskPaise: atRisk,
      amountRecoveredPaise: gross,
      touchesSent: treated.reduce((s, r) => s + r.touchCount, 0),
      stopRuleHits: triage.reduce((s, r) => s + r.steps.filter(st => st.blocked).length, 0),
      illegalRetries: 0, dndViolations: 0, ignoredOptOuts: 0, outageContacts: 0,
      llmFallbacks: triage.reduce((s, r) => s + r.llmFallbacks, 0),
      policyOverrides: triage.reduce((s, r) => s + r.policyOverrides, 0),
      outreachCostPaise: cost,
      netRecoveredPaise: econ.netRecoveredPaise,
      roi: econ.roi,
      costPerRupeeRecovered: econ.costPerRupeeRecovered,
      treatedCases: treated.length,
      treatedRecovered: treated.filter(r => r.recovered).length,
      holdoutCases: hold.length,
      holdoutRecovered: hold.filter(r => r.recovered).length,
      absoluteLiftPct: lift.absoluteLift * 100,
      relativeLiftPct: lift.relativeLift * 100,
      repliesReceived: replies,
      intentExtractions: extractions,
      intentAccuracyPct: extractions ? (correct / extractions) * 100 : 0,
      avgStepsPerCase: treated.length ? treated.reduce((s, r) => s + r.steps.length, 0) / treated.length : 0,
      avgDaysToRecovery: recoveredRuns.length
        ? recoveredRuns.reduce((s, r) => s + (r.recoveredOnDay ?? 0), 0) / recoveredRuns.length : 0,
      completedAt: done,
    }).where(eq(batchRuns.id, runId)).run();
  }

  if (naive) {
    const treated = naive.filter(r => !r.isHoldout);
    const hold    = naive.filter(r =>  r.isHoldout);
    const gross   = treated.reduce((s, r) => s + r.recoveredAmountPaise, 0);
    const cost    = treated.reduce((s, r) => s + r.totalCostPaise, 0);
    const touched = treated.filter(r => r.touchCount > 0).length;
    const econ    = report({ grossRecoveredPaise: gross, outreachCostPaise: cost, amountAtRiskPaise: atRisk, casesTouched: touched });
    const lift    = computeLift({
      treatedCases: treated.length, treatedRecovered: treated.filter(r => r.recovered).length,
      holdoutCases: hold.length,    holdoutRecovered: hold.filter(r => r.recovered).length,
    });
    const recoveredRuns = treated.filter(r => r.recoveredOnDay !== null);

    db.update(batchRuns).set({
      recovered: treated.filter(r => r.recovered).length,
      amountAtRiskPaise: atRisk,
      amountRecoveredPaise: gross,
      touchesSent: treated.reduce((s, r) => s + r.touchCount, 0),
      stopRuleHits: 0,
      illegalRetries: treated.reduce((s, r) => s + r.illegalRetries, 0),
      dndViolations:  treated.reduce((s, r) => s + r.dndViolations, 0),
      ignoredOptOuts: treated.reduce((s, r) => s + r.ignoredOptOuts, 0),
      outageContacts: treated.reduce((s, r) => s + r.outageContacts, 0),
      outreachCostPaise: cost,
      netRecoveredPaise: econ.netRecoveredPaise,
      roi: econ.roi,
      costPerRupeeRecovered: econ.costPerRupeeRecovered,
      treatedCases: treated.length,
      treatedRecovered: treated.filter(r => r.recovered).length,
      holdoutCases: hold.length,
      holdoutRecovered: hold.filter(r => r.recovered).length,
      absoluteLiftPct: lift.absoluteLift * 100,
      relativeLiftPct: lift.relativeLift * 100,
      avgStepsPerCase: treated.length ? treated.reduce((s, r) => s + r.steps.length, 0) / treated.length : 0,
      avgDaysToRecovery: recoveredRuns.length
        ? recoveredRuns.reduce((s, r) => s + (r.recoveredOnDay ?? 0), 0) / recoveredRuns.length : 0,
      completedAt: done,
    }).where(eq(batchRuns.id, runId)).run();
  }
}
