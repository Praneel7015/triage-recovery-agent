import { NextResponse } from "next/server";
import { ingestFailedPayment, kickLiveCase } from "@/adapters/ingest";
import { migrate } from "@/db/migrate";

migrate();

const DEMO_CASES = [
  {
    id: `demo_pay_${Date.now().toString(36)}`,
    amount: 49900,
    currency: "INR",
    method: "upi",
    email: "priya.sharma@example.com",
    contact: "+919876543210",
    notes: { customer_name: "Priya Sharma" },
    error_code: "BAD_REQUEST_ERROR",
    error_reason: "payment_failed",
    error_source: "customer",
    error_step: "payment_authentication",
    error_description: "Payment failed at authentication step",
    subscription_id: "sub_demo_001",
    created_at: Math.floor(Date.now() / 1000),
  },
  {
    id: `demo_pay_${(Date.now() + 1).toString(36)}`,
    amount: 199900,
    currency: "INR",
    method: "emandate",
    email: "amit.patel@example.com",
    contact: "+918765432109",
    notes: { customer_name: "Amit Patel" },
    error_code: "BAD_REQUEST_ERROR",
    error_reason: "mandate_revoked",
    error_source: "issuer",
    error_step: "debit",
    error_description: "e-mandate revoked by customer",
    subscription_id: "sub_demo_002",
    created_at: Math.floor(Date.now() / 1000),
  },
  {
    id: `demo_pay_${(Date.now() + 2).toString(36)}`,
    amount: 99900,
    currency: "INR",
    method: "card",
    email: "sunita.rao@example.com",
    contact: "+917654321098",
    notes: { customer_name: "Sunita Rao" },
    error_code: "BAD_REQUEST_ERROR",
    error_reason: "insufficient_funds",
    error_source: "issuer",
    error_step: "authorization",
    error_description: "Insufficient funds in the account",
    created_at: Math.floor(Date.now() / 1000),
  },
];

/**
 * POST /api/demo/trigger
 * Simulates a live payment.failed webhook, ingests the case, and kicks
 * the agent to run diagnosis + select the first action. Use for demos.
 * Returns the created caseId.
 */
export async function POST() {
  const entity = DEMO_CASES[Math.floor(Math.random() * DEMO_CASES.length)];
  // Give it a unique ID each time so repeated presses create new cases.
  const uniqueEntity = { ...entity, id: `demo_pay_${Date.now().toString(36)}` };

  const caseId = ingestFailedPayment(uniqueEntity, "payment.failed", null);
  if (!caseId) {
    return NextResponse.json({ error: "Ingest failed" }, { status: 500 });
  }

  void kickLiveCase(caseId);

  return NextResponse.json({ ok: true, caseId });
}
