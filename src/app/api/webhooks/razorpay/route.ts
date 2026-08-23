import { NextResponse } from "next/server";
import { db } from "@/db/client";
import { cases, auditLog } from "@/db/schema";
import { eq } from "drizzle-orm";
import { verifyWebhookSignature } from "@/adapters/razorpay";
import { ingestFailedPayment } from "@/adapters/ingest";
import { randomUUID } from "crypto";
import { migrate } from "@/db/migrate";

migrate();

export async function POST(request: Request) {
  const rawBody = await request.text();
  const signature = request.headers.get("x-razorpay-signature") ?? "";

  try {
    verifyWebhookSignature(rawBody, signature);
  } catch {
    return NextResponse.json({ error: "Invalid signature" }, { status: 400 });
  }

  const payload = JSON.parse(rawBody);
  const event   = payload.event as string;
  const now     = Math.floor(Date.now() / 1000);

  const paymentEntity =
    payload.payload?.payment?.entity ??
    payload.payload?.payment_link?.entity ??
    {};
  const subscriptionEntity = payload.payload?.subscription?.entity ?? null;
  const notes = paymentEntity.notes ?? {};
  let caseId  = notes.case_id as string | undefined;

  // ── Ingest new failures into the case store ───────────────────────────────
  if (event === "payment.failed" && !caseId) {
    caseId = ingestFailedPayment(paymentEntity, event, subscriptionEntity) ?? undefined;
  }

  if (event === "subscription.pending" && subscriptionEntity?.id) {
    const pendingPayment = payload.payload?.payment?.entity ?? {
      id: `sub_${subscriptionEntity.id}_${now}`,
      amount: payload.payload?.subscription?.entity?.plan_amount,
      subscription_id: subscriptionEntity.id,
      notes: subscriptionEntity.notes ?? {},
    };
    if (!caseId) {
      caseId = ingestFailedPayment(pendingPayment, event, subscriptionEntity) ?? undefined;
    }
  }

  // ── Handle payment.captured on a payment link ─────────────────────────────
  if (event === "payment_link.paid" || event === "payment.captured") {
    caseId = caseId ?? notes.case_id;

    if (caseId) {
      db.update(cases).set({ status: "recovered", resolvedAt: now, updatedAt: now }).where(eq(cases.id, caseId)).run();
      db.insert(auditLog).values({
        id: randomUUID(), caseId, ts: now,
        actor: "webhook", event: "payment_received",
        detail: `Razorpay webhook ${event}: payment received. Case marked recovered.`,
      }).run();
    }
  }

  // ── Handle payment.failed on an existing recovery link ────────────────────
  if (event === "payment.failed" && caseId && notes.case_id) {
    db.update(cases).set({ status: "unrecoverable", updatedAt: now }).where(eq(cases.id, caseId)).run();
    db.insert(auditLog).values({
      id: randomUUID(), caseId, ts: now,
      actor: "webhook", event: "payment_failed_again",
      detail: `Razorpay webhook payment.failed: ${paymentEntity.error_description ?? "Unknown error"}.`,
    }).run();
  }

  return NextResponse.json({ ok: true, caseId: caseId ?? null });
}

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
