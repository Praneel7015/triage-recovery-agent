import { NextResponse } from "next/server";
import { db } from "@/db/client";
import { cases, auditLog } from "@/db/schema";
import { eq } from "drizzle-orm";
import { randomUUID } from "crypto";
import crypto from "crypto";
import { migrate } from "@/db/migrate";

migrate();

/**
 * POST /api/live/confirm
 * Body: { caseId, razorpay_order_id, razorpay_payment_id, razorpay_signature }
 * Verifies the Razorpay payment signature and marks the case recovered.
 */
export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Request body must be JSON" }, { status: 400 });
  }

  const b = body as Record<string, string>;
  const { caseId, razorpay_order_id, razorpay_payment_id, razorpay_signature } = b;

  if (!caseId || !razorpay_order_id || !razorpay_payment_id || !razorpay_signature) {
    return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
  }

  const keySecret = process.env.RAZORPAY_KEY_SECRET;
  if (!keySecret) {
    return NextResponse.json({ error: "Razorpay key secret not configured" }, { status: 500 });
  }

  const expected = crypto
    .createHmac("sha256", keySecret)
    .update(`${razorpay_order_id}|${razorpay_payment_id}`)
    .digest("hex");

  if (!crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(razorpay_signature))) {
    return NextResponse.json({ error: "Payment signature invalid" }, { status: 400 });
  }

  const now = Math.floor(Date.now() / 1000);

  db.update(cases)
    .set({ status: "recovered", resolvedAt: now, updatedAt: now, razorpayPaymentId: razorpay_payment_id })
    .where(eq(cases.id, caseId))
    .run();

  db.insert(auditLog).values({
    id: randomUUID(),
    caseId,
    ts: now,
    actor: "webhook",
    event: "payment_received",
    detail: `Inline checkout: payment ${razorpay_payment_id} verified. Case marked recovered.`,
  }).run();

  return NextResponse.json({ ok: true });
}
