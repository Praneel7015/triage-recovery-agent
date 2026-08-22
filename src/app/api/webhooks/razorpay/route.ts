import { NextResponse } from "next/server";
import { db } from "@/db/client";
import { cases, auditLog } from "@/db/schema";
import { eq } from "drizzle-orm";
import { verifyWebhookSignature } from "@/adapters/razorpay";
import { randomUUID } from "crypto";
import { migrate } from "@/db/migrate";

migrate();

export async function POST(request: Request) {
  const rawBody = await request.text();
  const signature = request.headers.get("x-razorpay-signature") ?? "";

  // ── Verify signature ──────────────────────────────────────────────────────
  try {
    verifyWebhookSignature(rawBody, signature);
  } catch {
    return NextResponse.json({ error: "Invalid signature" }, { status: 400 });
  }

  const payload = JSON.parse(rawBody);
  const event   = payload.event as string;
  const now     = Math.floor(Date.now() / 1000);

  // ── Handle payment.captured on a payment link ─────────────────────────────
  if (event === "payment_link.paid" || event === "payment.captured") {
    const notes   = payload.payload?.payment?.entity?.notes ?? payload.payload?.payment_link?.entity?.notes ?? {};
    const caseId  = notes.case_id;

    if (caseId) {
      db.update(cases).set({ status: "recovered", resolvedAt: now, updatedAt: now }).where(eq(cases.id, caseId)).run();
      db.insert(auditLog).values({
        id: randomUUID(), caseId, ts: now,
        actor: "webhook", event: "payment_received",
        detail: `Razorpay webhook ${event}: payment received. Case marked recovered.`,
      }).run();
    }
  }

  // ── Handle payment.failed on a payment link ───────────────────────────────
  if (event === "payment.failed") {
    const paymentEntity = payload.payload?.payment?.entity ?? {};
    const notes = paymentEntity.notes ?? {};
    const caseId = notes.case_id;

    if (caseId) {
      db.update(cases).set({ status: "unrecoverable", updatedAt: now }).where(eq(cases.id, caseId)).run();
      db.insert(auditLog).values({
        id: randomUUID(), caseId, ts: now,
        actor: "webhook", event: "payment_failed_again",
        detail: `Razorpay webhook payment.failed: ${paymentEntity.error_description ?? "Unknown error"}.`,
      }).run();
    }
  }

  return NextResponse.json({ ok: true });
}

// Allow GET for Razorpay callback_url (redirect after payment)
export async function GET(request: Request) {
  const url     = new URL(request.url);
  const caseId  = url.searchParams.get("case_id");
  const status  = url.searchParams.get("razorpay_payment_link_status");

  if (caseId && status === "paid") {
    const now = Math.floor(Date.now() / 1000);
    db.update(cases).set({ status: "recovered", resolvedAt: now, updatedAt: now }).where(eq(cases.id, caseId)).run();
  }

  return NextResponse.redirect(new URL(`/cases/${caseId ?? ""}`, request.url));
}
