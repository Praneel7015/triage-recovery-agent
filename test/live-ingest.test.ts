/**
 * Razorpay delivers webhooks at least once: a retried payment.failed must not
 * run the agent twice or create a second campaign step / Payment Link.
 */
import { test, before } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

process.env.DATABASE_URL = join(mkdtempSync(join(tmpdir(), "triage-ingest-")), "test.db");
// No model and no Razorpay keys: the agent falls back to taxonomy, and link
// creation fails closed into an audit entry.
process.env.LLM_API_KEY = "";
process.env.RAZORPAY_KEY_ID = "";
process.env.RAZORPAY_KEY_SECRET = "";

let ingest: typeof import("@/adapters/ingest");
let db: typeof import("@/db/client").db;
let schema: typeof import("@/db/schema");
let eq: typeof import("drizzle-orm").eq;

before(async () => {
  const { migrate } = await import("@/db/migrate");
  migrate();
  ingest = await import("@/adapters/ingest");
  ({ db } = await import("@/db/client"));
  schema = await import("@/db/schema");
  ({ eq } = await import("drizzle-orm"));
});

test("a repeated kick for the same live case adds no second step", async () => {
  const caseId = ingest.ingestFailedPayment({
    id: "pay_dup_1",
    amount: 199900,
    method: "emandate",
    email: "test@example.com",
    error_code: "BAD_REQUEST_ERROR",
    error_reason: "mandate_revoked",
    error_description: "e-mandate revoked by customer",
    subscription_id: "sub_dup",
  }, "payment.failed", { id: "sub_dup", status: "cancelled" });
  assert.ok(caseId);

  await ingest.kickLiveCase(caseId);
  await ingest.kickLiveCase(caseId);

  const steps = db.select().from(schema.campaignSteps)
    .where(eq(schema.campaignSteps.caseId, caseId)).all();
  assert.equal(steps.length, 1);
});

test("re-ingesting the same payment returns the existing case", () => {
  const entity = { id: "pay_dup_2", amount: 49900, error_reason: "insufficient_funds" };
  const first = ingest.ingestFailedPayment(entity, "payment.failed");
  const second = ingest.ingestFailedPayment(entity, "payment.failed");
  assert.equal(first, second);
  const rows = db.select().from(schema.cases).where(eq(schema.cases.id, first!)).all();
  assert.equal(rows.length, 1);
});

test("two concurrent kicks for one case add one step", async () => {
  const caseId = ingest.ingestFailedPayment({
    id: "pay_race_1",
    amount: 99900,
    method: "upi",
    error_code: "BAD_REQUEST_ERROR",
    error_reason: "insufficient_funds",
    error_description: "Insufficient funds",
  }, "payment.failed");
  assert.ok(caseId);

  await Promise.all([ingest.kickLiveCase(caseId), ingest.kickLiveCase(caseId)]);

  const steps = db.select().from(schema.campaignSteps)
    .where(eq(schema.campaignSteps.caseId, caseId)).all();
  assert.equal(steps.length, 1);
});

test("a fresh claim blocks a kick, an abandoned one can be retaken", async () => {
  const caseId = ingest.ingestFailedPayment({
    id: "pay_lease_1",
    amount: 49900,
    method: "upi",
    error_reason: "insufficient_funds",
  }, "payment.failed");
  assert.ok(caseId);
  const stepsFor = () => db.select().from(schema.campaignSteps)
    .where(eq(schema.campaignSteps.caseId, caseId)).all().length;
  const now = Math.floor(Date.now() / 1000);

  // Another kick claimed it seconds ago and is still running.
  db.update(schema.cases).set({ status: "in_progress", updatedAt: now - 10 })
    .where(eq(schema.cases.id, caseId)).run();
  await ingest.kickLiveCase(caseId);
  assert.equal(stepsFor(), 0);

  // That kick's process died an hour ago without recording anything.
  db.update(schema.cases).set({ updatedAt: now - 3600 })
    .where(eq(schema.cases.id, caseId)).run();
  await ingest.kickLiveCase(caseId);
  assert.equal(stepsFor(), 1);
});
