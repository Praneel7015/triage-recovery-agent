import { NextResponse } from "next/server";
import { ingestFailedPayment, kickLiveCase } from "@/adapters/ingest";
import { db } from "@/db/client";
import { cases } from "@/db/schema";
import { eq } from "drizzle-orm";
import { migrate } from "@/db/migrate";

migrate();

type Scenario = "mandate_revoked" | "insufficient_funds" | "bank_outage";

function entityFor(scenario: Scenario, id: string) {
  const now = Math.floor(Date.now() / 1000);
  if (scenario === "mandate_revoked") {
    return {
      payment: {
        id,
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
        subscription_id: "sub_demo_mandate",
        created_at: now,
      },
      subscription: { id: "sub_demo_mandate", status: "cancelled" as const },
    };
  }
  if (scenario === "bank_outage") {
    return {
      payment: {
        id,
        amount: 79900,
        currency: "INR",
        method: "upi",
        email: "neha.iyer@example.com",
        contact: "+919900112233",
        notes: { customer_name: "Neha Iyer" },
        error_code: "GATEWAY_ERROR",
        error_reason: "bank_technical_error",
        error_source: "issuer",
        error_step: "payment_authentication",
        error_description: "Issuing bank is temporarily unavailable",
        subscription_id: "sub_demo_outage",
        created_at: now,
      },
      subscription: { id: "sub_demo_outage", status: "active" as const },
    };
  }
  return {
    payment: {
      id,
      amount: 49900,
      currency: "INR",
      method: "upi",
      email: "priya.sharma@example.com",
      contact: "+919876543210",
      notes: { customer_name: "Priya Sharma" },
      error_code: "BAD_REQUEST_ERROR",
      error_reason: "insufficient_funds",
      error_source: "issuer",
      error_step: "authorization",
      error_description: "Insufficient funds in the account",
      subscription_id: "sub_demo_funds",
      created_at: now,
    },
    subscription: { id: "sub_demo_funds", status: "active" as const },
  };
}

/**
 * POST /api/demo/trigger
 * Body (optional): { scenario: "mandate_revoked" | "insufficient_funds" | "bank_outage" }
 * Ingests a live-style payment.failed, runs the agent to completion, returns the case.
 */
export async function POST(request: Request) {
  let scenario: Scenario = "mandate_revoked";
  try {
    const body = await request.json().catch(() => ({}));
    const s = (body as { scenario?: string }).scenario;
    if (s === "insufficient_funds" || s === "bank_outage" || s === "mandate_revoked") {
      scenario = s;
    }
  } catch {
    // default mandate_revoked — that is the 90-second clip
  }

  const uniqueId = `demo_pay_${Date.now().toString(36)}`;
  const { payment, subscription } = entityFor(scenario, uniqueId);

  const caseId = ingestFailedPayment(payment, "payment.failed", subscription);
  if (!caseId) {
    return NextResponse.json({ error: "Ingest failed" }, { status: 500 });
  }

  await kickLiveCase(caseId);

  const c = db.select().from(cases).where(eq(cases.id, caseId)).get();
  return NextResponse.json({
    ok: true,
    caseId,
    scenario,
    cause: c?.cause ?? null,
    action: c?.actionTaken ?? null,
    stopCode: c?.stopCode ?? null,
    paymentLinkUrl: c?.razorpayPaymentLinkUrl ?? null,
    llmFallbacks: c?.llmFallbacks ?? 0,
  });
}
