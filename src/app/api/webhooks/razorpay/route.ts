import { NextResponse } from "next/server";
import { db } from "@/db/client";
import { auditLog } from "@/db/schema";
import { verifyWebhookSignature, verifyPaymentLinkCallback } from "@/adapters/razorpay";
import { ingestFailedPayment, kickLiveCase } from "@/adapters/ingest";
import { markCaseRecovered, findCaseIdFromPaymentNotes } from "@/lib/markRecovered";
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
    {};
  const paymentLinkEntity = payload.payload?.payment_link?.entity ?? {};
  const subscriptionEntity = payload.payload?.subscription?.entity ?? null;
  const notes = {
    ...(paymentLinkEntity.notes ?? {}),
    ...(paymentEntity.notes ?? {}),
  };
  let caseId  = (notes.case_id as string | undefined)
    ?? findCaseIdFromPaymentNotes({
      notesCaseId: notes.case_id,
      paymentLinkId: paymentLinkEntity.id,
      paymentId: paymentEntity.id,
    });

  // ── Ingest new failures into the case store ───────────────────────────────
  if (event === "payment.failed" && !notes.case_id) {
    caseId = ingestFailedPayment(paymentEntity, event, subscriptionEntity) ?? undefined;
    if (caseId) void kickLiveCase(caseId);
  }

  if (event === "subscription.pending" && subscriptionEntity?.id) {
    const pendingPayment = payload.payload?.payment?.entity ?? {
      id: `sub_${subscriptionEntity.id}_${now}`,
      amount: payload.payload?.subscription?.entity?.plan_amount,
      subscription_id: subscriptionEntity.id,
      notes: subscriptionEntity.notes ?? {},
    };
    if (!notes.case_id) {
      caseId = ingestFailedPayment(pendingPayment, event, subscriptionEntity) ?? undefined;
      if (caseId) void kickLiveCase(caseId);
    }
  }

  // ── Handle payment captured / link paid ───────────────────────────────────
  if (event === "payment_link.paid" || event === "payment.captured") {
    caseId = caseId ?? findCaseIdFromPaymentNotes({
      notesCaseId: notes.case_id,
      paymentLinkId: paymentLinkEntity.id,
      paymentId: paymentEntity.id,
    });

    if (caseId) {
      markCaseRecovered({
        caseId,
        paymentId: paymentEntity.id,
        detail: `Razorpay webhook ${event}: payment received. Case marked recovered.`,
      });
    }
  }

  // ── Handle payment.failed on an existing recovery link ────────────────────
  if (event === "payment.failed" && notes.case_id) {
    db.insert(auditLog).values({
      id: randomUUID(), caseId: notes.case_id, ts: now,
      actor: "webhook", event: "payment_failed_again",
      detail: `Razorpay webhook payment.failed: ${paymentEntity.error_description ?? "Unknown error"}. Case stays open.`,
    }).run();
  }

  return NextResponse.json({ ok: true, caseId: caseId ?? null });
}

export async function GET(request: Request) {
  const url     = new URL(request.url);
  const caseId  = url.searchParams.get("case_id");
  const status  = url.searchParams.get("razorpay_payment_link_status") ?? "";
  const linkId  = url.searchParams.get("razorpay_payment_link_id") ?? "";
  const payId   = url.searchParams.get("razorpay_payment_id") ?? "";
  const sig     = url.searchParams.get("razorpay_signature") ?? "";
  const refId   = url.searchParams.get("razorpay_payment_link_reference_id") ?? "";

  let recoveredCaseId: string | undefined;

  if (linkId && payId && sig) {
    const ok = verifyPaymentLinkCallback({
      paymentLinkId: linkId,
      paymentLinkReferenceId: refId,
      paymentLinkStatus: status,
      paymentId: payId,
      signature: sig,
    });
    if (ok && (status === "paid" || status === "partially_paid")) {
      recoveredCaseId =
        caseId
        ?? findCaseIdFromPaymentNotes({
          notesCaseId: refId || undefined,
          paymentLinkId: linkId,
          paymentId: payId || undefined,
        });
      if (recoveredCaseId) {
        markCaseRecovered({
          caseId: recoveredCaseId,
          paymentId: payId,
          detail: "Payment link callback (GET): signature verified. Case marked recovered.",
        });
      }
    }
  }

  const dest = recoveredCaseId ?? caseId ?? findCaseIdFromPaymentNotes({ paymentLinkId: linkId }) ?? "";
  return NextResponse.redirect(new URL(`/cases/${dest}`, request.url));
}
