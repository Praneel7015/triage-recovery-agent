import "dotenv/config";
import { db } from "@/db/client";
import { migrate } from "@/db/migrate";
import { cases, auditLog, batchRuns } from "@/db/schema";
import { runAgent, type CaseInput } from "@/engine/agent";
import { runNaive } from "@/engine/naive";
import { simulate } from "@/adapters/simulator";
import { readFileSync } from "fs";
import { randomUUID } from "crypto";
import { eq } from "drizzle-orm";

migrate();

export async function runBatch(batchPath = "./data/batch.json") {
  const now = Math.floor(Date.now() / 1000);
  const rawBatch = JSON.parse(readFileSync(batchPath, "utf-8")) as any[];

  const triageRunId = randomUUID();
  const naiveRunId  = randomUUID();

  // Seed batch_runs entries
  db.insert(batchRuns).values([
    { id: triageRunId, name: "Triage", strategy: "triage", totalCases: rawBatch.length, amountAtRiskPaise: 0, createdAt: now },
    { id: naiveRunId,  name: "Naive",  strategy: "naive",  totalCases: rawBatch.length, amountAtRiskPaise: 0, createdAt: now },
  ]).run();

  let trRecovered = 0, trAmountRecovered = 0, trTouches = 0, trStops = 0, trLlmFB = 0, trOverrides = 0;
  let naRecovered = 0, naAmountRecovered = 0, naTouches = 0, naIllegal = 0, naDnd = 0;
  let amountAtRisk = 0;

  const TOUCH_ACTIONS = new Set(["send_method_update_link","send_one_time_payment_link","offer_pause","hinglish_voice_script"]);

  for (const raw of rawBatch) {
    amountAtRisk += raw.amountPaise;
    const caseInput: CaseInput = { ...raw };

    // ── Triage case ──────────────────────────────────────────────────────────
    const triageCaseId = `${raw.id}_triage`;
    const ts = Math.floor(Date.now() / 1000);

    // Upsert case
    db.insert(cases).values({
      id: triageCaseId,
      customerId: raw.customerId,
      customerName: raw.customerName,
      customerPhone: raw.customerPhone,
      customerEmail: raw.customerEmail,
      amountPaise: raw.amountPaise,
      currency: raw.currency ?? "INR",
      paymentMethod: raw.paymentMethod,
      subscriptionId: raw.subscriptionId,
      subscriptionState: raw.subscriptionState,
      razorpayPaymentId: raw.razorpayPaymentId,
      errorCode: raw.errorCode,
      errorReason: raw.errorReason,
      errorSource: raw.errorSource,
      errorStep: raw.errorStep,
      errorDescription: raw.errorDescription,
      retryCount: raw.retryCount ?? 0,
      touchCount: raw.touchCount ?? 0,
      isDnd: raw.isDnd ?? false,
      hasConsented: raw.hasConsented ?? true,
      promiseToPay: raw.promiseToPay,
      salaryWindowHint: raw.salaryWindowHint,
      bankOutageActive: raw.bankOutageActive ?? false,
      failedAt: raw.failedAt ?? ts,
      createdAt: ts, updatedAt: ts,
      batchId: triageRunId,
      isNaiveRun: false,
      status: "open",
    }).onConflictDoNothing().run();

    const result = await runAgent(caseInput);

    // Write audit trail
    for (const entry of result.auditTrail) {
      db.insert(auditLog).values({
        id: randomUUID(),
        caseId: triageCaseId,
        ts: Math.floor(Date.now() / 1000),
        actor: entry.actor,
        event: entry.event,
        detail: entry.detail,
        llmUsed: entry.llmUsed ?? false,
        llmFallback: entry.llmFallback ?? false,
        policyOverride: entry.policyOverride ?? false,
      }).run();
    }

    const isTouched = TOUCH_ACTIONS.has(result.action) && !result.blocked;
    if (result.blocked) trStops++;
    if (isTouched)      trTouches++;
    if (result.llmFallback)  trLlmFB++;
    if (result.policyOverride) trOverrides++;

    let status: string = result.blocked ? "stopped" : "in_progress";

    if (!result.blocked) {
      const sim = simulate({ cause: result.cause, action: result.action, blocked: false, retryCount: raw.retryCount ?? 0, salaryWindowHint: raw.salaryWindowHint, bankOutageActive: raw.bankOutageActive ?? false, amountPaise: raw.amountPaise });
      if (sim.recovered) {
        trRecovered++; trAmountRecovered += raw.amountPaise;
        status = "recovered";
        db.insert(auditLog).values({ id: randomUUID(), caseId: triageCaseId, ts: Math.floor(Date.now()/1000), actor: "executor", event: "simulated_recovered", detail: sim.simulatedReason }).run();
      } else {
        db.insert(auditLog).values({ id: randomUUID(), caseId: triageCaseId, ts: Math.floor(Date.now()/1000), actor: "executor", event: "simulated_failed", detail: sim.simulatedReason }).run();
      }
    }

    db.update(cases).set({ cause: result.cause, diagnosisNarrative: result.diagnosisNarrative, actionTaken: result.action, stopCode: result.stopCode, status: status as any, updatedAt: Math.floor(Date.now()/1000) }).where(eq(cases.id, triageCaseId)).run();

    // ── Naive case ───────────────────────────────────────────────────────────
    const naiveCaseId = `${raw.id}_naive`;
    db.insert(cases).values({ ...db.select().from(cases).where(eq(cases.id, triageCaseId)).get() as any, id: naiveCaseId, batchId: naiveRunId, isNaiveRun: true, status: "open", actionTaken: null, cause: null, diagnosisNarrative: null, stopCode: null }).onConflictDoNothing().run();

    const naive = runNaive(caseInput);
    if (naive.dndViolation) naDnd++;
    if (naive.illegalRetry) naIllegal++;
    if (naive.touchSent)    naTouches++;

    const naiveCause = raw.subscriptionState === "cancelled" ? "mandate_revoked" : raw.errorReason === "insufficient_funds" ? "insufficient_funds" : raw.bankOutageActive ? "bank_outage" : raw.errorReason === "bank_not_available" ? "bank_outage" : raw.errorReason === "card_expired" ? "instrument_expired" : raw.errorReason === "reqauth_mandate_not_acknowledged" ? "upi_hang" : raw.errorReason === "payment_cancelled" && raw.errorSource === "customer" ? "customer_cancelled" : raw.errorReason === "invalid_otp" ? "auth_failed" : "unknown";

    const naiveSim = simulate({ cause: naiveCause as any, action: naive.action, blocked: false, retryCount: raw.retryCount ?? 0, salaryWindowHint: raw.salaryWindowHint, bankOutageActive: raw.bankOutageActive ?? false, amountPaise: raw.amountPaise });
    if (naiveSim.recovered) { naRecovered++; naAmountRecovered += raw.amountPaise; }

    db.update(cases).set({ cause: naiveCause as any, actionTaken: naive.action, status: naiveSim.recovered ? "recovered" : "open", updatedAt: Math.floor(Date.now()/1000) }).where(eq(cases.id, naiveCaseId)).run();
  }

  // Update batch run summaries
  db.update(batchRuns).set({ recovered: trRecovered, amountAtRiskPaise: amountAtRisk, amountRecoveredPaise: trAmountRecovered, touchesSent: trTouches, stopRuleHits: trStops, llmFallbacks: trLlmFB, policyOverrides: trOverrides, completedAt: Math.floor(Date.now()/1000) }).where(eq(batchRuns.id, triageRunId)).run();
  db.update(batchRuns).set({ recovered: naRecovered, amountAtRiskPaise: amountAtRisk, amountRecoveredPaise: naAmountRecovered, touchesSent: naTouches, illegalRetries: naIllegal, dndViolations: naDnd, completedAt: Math.floor(Date.now()/1000) }).where(eq(batchRuns.id, naiveRunId)).run();

  return { triageRunId, naiveRunId };
}
