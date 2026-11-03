/**
 * Regression tests: a case may only be marked recovered by a payment that
 * Razorpay signed for that case.
 */
import { test, before } from "node:test";
import assert from "node:assert/strict";
import crypto from "crypto";
import { mkdtempSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

const KEY_SECRET = "test_key_secret";
const WEBHOOK_SECRET = "test_webhook_secret";

// The DB client reads these at import time, so set them before any app import.
process.env.DATABASE_URL = join(mkdtempSync(join(tmpdir(), "triage-test-")), "test.db");
process.env.RAZORPAY_KEY_SECRET = KEY_SECRET;
process.env.RAZORPAY_WEBHOOK_SECRET = WEBHOOK_SECRET;

type App = {
  db: typeof import("@/db/client").db;
  cases: typeof import("@/db/schema").cases;
  eq: typeof import("drizzle-orm").eq;
  webhook: typeof import("@/app/api/webhooks/razorpay/route");
  confirm: typeof import("@/lib/confirmCheckout").confirmCheckoutPayment;
  razorpay: typeof import("@/adapters/razorpay");
};
let app: App;

before(async () => {
  const { db } = await import("@/db/client");
  const { cases } = await import("@/db/schema");
  const { eq } = await import("drizzle-orm");
  const webhook = await import("@/app/api/webhooks/razorpay/route");
  const { confirmCheckoutPayment } = await import("@/lib/confirmCheckout");
  const razorpay = await import("@/adapters/razorpay");
  app = { db, cases, eq, webhook, confirm: confirmCheckoutPayment, razorpay };
});

function hmac(secret: string, payload: string) {
  return crypto.createHmac("sha256", secret).update(payload).digest("hex");
}

function seedCase(id: string, opts: { linkId?: string; amountPaise?: number } = {}) {
  const now = Math.floor(Date.now() / 1000);
  app.db.insert(app.cases).values({
    id,
    customerId: `cust_${id}`,
    customerName: "Test Customer",
    amountPaise: opts.amountPaise ?? 49900,
    paymentMethod: "upi",
    status: "open",
    razorpayPaymentLinkId: opts.linkId ?? null,
    failedAt: now,
    createdAt: now,
    updatedAt: now,
  }).run();
}

function statusOf(id: string): string {
  return app.db.select({ status: app.cases.status }).from(app.cases)
    .where(app.eq(app.cases.id, id)).get()!.status;
}

function callbackUrl(params: Record<string, string>) {
  const u = new URL("http://localhost:3000/api/webhooks/razorpay");
  for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v);
  return u.toString();
}

function signedCallback(opts: { linkId: string; refId: string; status: string; payId: string }) {
  return {
    razorpay_payment_link_id: opts.linkId,
    razorpay_payment_link_reference_id: opts.refId,
    razorpay_payment_link_status: opts.status,
    razorpay_payment_id: opts.payId,
    razorpay_signature: hmac(KEY_SECRET, [opts.linkId, opts.refId, opts.status, opts.payId].join("|")),
  };
}

// ── Payment Link GET callback ────────────────────────────────────────────────

test("GET callback without signature params does not mark a case recovered", async () => {
  seedCase("case_nosig");
  const res = await app.webhook.GET(new Request(callbackUrl({
    case_id: "case_nosig",
    razorpay_payment_link_status: "paid",
  })));
  assert.equal(res.status, 307);
  assert.equal(statusOf("case_nosig"), "open");
});

test("GET callback ignores an unsigned case_id that points at a different case", async () => {
  seedCase("case_paid", { linkId: "plink_paid" });
  seedCase("case_victim");
  const res = await app.webhook.GET(new Request(callbackUrl({
    case_id: "case_victim",
    ...signedCallback({ linkId: "plink_paid", refId: "case_paid", status: "paid", payId: "pay_1" }),
  })));
  assert.equal(statusOf("case_victim"), "open");
  assert.equal(statusOf("case_paid"), "recovered");
  assert.match(res.headers.get("location") ?? "", /\/cases\/case_paid$/);
});

test("GET callback with a wrong-length signature is rejected without throwing", async () => {
  seedCase("case_shortsig", { linkId: "plink_short" });
  const res = await app.webhook.GET(new Request(callbackUrl({
    razorpay_payment_link_id: "plink_short",
    razorpay_payment_link_reference_id: "case_shortsig",
    razorpay_payment_link_status: "paid",
    razorpay_payment_id: "pay_2",
    razorpay_signature: "abc",
  })));
  assert.equal(res.status, 307);
  assert.equal(statusOf("case_shortsig"), "open");
});

test("GET callback for a partially paid link does not mark the case recovered", async () => {
  seedCase("case_partial", { linkId: "plink_partial" });
  await app.webhook.GET(new Request(callbackUrl(
    signedCallback({ linkId: "plink_partial", refId: "case_partial", status: "partially_paid", payId: "pay_3" }),
  )));
  assert.equal(statusOf("case_partial"), "open");
});

// ── Checkout.js confirm ──────────────────────────────────────────────────────

function checkoutInput(caseId: string, orderId: string, paymentId: string) {
  return { caseId, orderId, paymentId, signature: hmac(KEY_SECRET, `${orderId}|${paymentId}`) };
}

test("confirm rejects a genuine payment whose order belongs to another case", async () => {
  seedCase("case_order_owner");
  seedCase("case_order_victim");
  const result = await app.confirm(
    checkoutInput("case_order_victim", "order_1", "pay_4"),
    async () => ({ id: "order_1", amount: 49900, notes: { case_id: "case_order_owner" } }),
  );
  assert.equal(result.ok, false);
  assert.equal(statusOf("case_order_victim"), "open");
});

test("confirm rejects an order whose amount does not match the case", async () => {
  seedCase("case_amount", { amountPaise: 199900 });
  const result = await app.confirm(
    checkoutInput("case_amount", "order_2", "pay_5"),
    async () => ({ id: "order_2", amount: 100, notes: { case_id: "case_amount" } }),
  );
  assert.equal(result.ok, false);
  assert.equal(statusOf("case_amount"), "open");
});

test("confirm rejects a bad signature before fetching the order", async () => {
  seedCase("case_badsig");
  let fetched = false;
  const result = await app.confirm(
    { caseId: "case_badsig", orderId: "order_3", paymentId: "pay_6", signature: "deadbeef" },
    async () => { fetched = true; return { id: "order_3", amount: 49900, notes: { case_id: "case_badsig" } }; },
  );
  assert.equal(result.ok, false);
  assert.equal(fetched, false);
  assert.equal(statusOf("case_badsig"), "open");
});

test("confirm marks the case recovered when signature, order and amount all match", async () => {
  seedCase("case_good");
  const result = await app.confirm(
    checkoutInput("case_good", "order_4", "pay_7"),
    async () => ({ id: "order_4", amount: 49900, notes: { case_id: "case_good" } }),
  );
  assert.deepEqual(result, { ok: true, alreadyRecovered: false });
  assert.equal(statusOf("case_good"), "recovered");
});

// ── Signature helpers and POST webhook ───────────────────────────────────────

test("signaturesMatch returns false on length mismatch instead of throwing", () => {
  assert.equal(app.razorpay.signaturesMatch("a".repeat(64), "abc"), false);
  assert.equal(app.razorpay.signaturesMatch("a".repeat(64), ""), false);
  assert.equal(app.razorpay.signaturesMatch("a".repeat(64), "a".repeat(64)), true);
});

test("POST webhook with a bad signature returns 400 and changes nothing", async () => {
  seedCase("case_post");
  const body = JSON.stringify({
    event: "payment.captured",
    payload: { payment: { entity: { id: "pay_8", notes: { case_id: "case_post" } } } },
  });
  for (const signature of ["", "abc", hmac("wrong_secret", body)]) {
    const res = await app.webhook.POST(new Request("http://localhost:3000/api/webhooks/razorpay", {
      method: "POST", body, headers: { "x-razorpay-signature": signature },
    }));
    assert.equal(res.status, 400);
  }
  assert.equal(statusOf("case_post"), "open");
});

test("POST webhook with a valid signature marks the named case recovered", async () => {
  seedCase("case_post_ok");
  const body = JSON.stringify({
    event: "payment.captured",
    payload: { payment: { entity: { id: "pay_9", notes: { case_id: "case_post_ok" } } } },
  });
  const res = await app.webhook.POST(new Request("http://localhost:3000/api/webhooks/razorpay", {
    method: "POST", body, headers: { "x-razorpay-signature": hmac(WEBHOOK_SECRET, body) },
  }));
  assert.equal(res.status, 200);
  assert.equal(statusOf("case_post_ok"), "recovered");
});
