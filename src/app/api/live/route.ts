import { NextResponse } from "next/server";
import { db } from "@/db/client";
import { cases, auditLog } from "@/db/schema";
import { eq } from "drizzle-orm";
import { createPaymentLink } from "@/adapters/razorpay";
import { randomUUID } from "crypto";
import { migrate } from "@/db/migrate";

migrate();

/**
 * POST /api/live
 * Body: { caseId: string }
 * Creates a real Razorpay test-mode Payment Link for a case.
 * On executor failure, logs the error and returns escalated: true (graceful fallback).
 */
export async function POST(request: Request) {
  let caseId: string | undefined;

  try {
    const body = await request.json();
    caseId = body?.caseId as string | undefined;
    if (!caseId) return NextResponse.json({ error: "caseId required" }, { status: 400 });

    const c = db.select().from(cases).where(eq(cases.id, caseId)).get();
    if (!c) return NextResponse.json({ error: "Case not found" }, { status: 404 });

    if (c.amountPaise < 100) {
      return NextResponse.json({ error: "Amount too small for Razorpay (min ₹1)" }, { status: 400 });
    }

    const link = await createPaymentLink({
      caseId: c.id,
      customerId: c.customerId,
      customerName: c.customerName,
      customerEmail: c.customerEmail,
      customerPhone: c.customerPhone,
      amountPaise: c.amountPaise,
      description: `Recovery: ${c.diagnosisNarrative ?? "Payment due"}`,
      expireAfterSeconds: 7 * 24 * 60 * 60,
    });

    const now = Math.floor(Date.now() / 1000);
    db.update(cases).set({
      razorpayPaymentLinkId: link.id,
      razorpayPaymentLinkUrl: link.short_url,
      status: "in_progress",
      updatedAt: now,
    }).where(eq(cases.id, caseId)).run();

    db.insert(auditLog).values({
      id: randomUUID(),
      caseId,
      ts: now,
      actor: "executor",
      event: "payment_link_created",
      detail: `Razorpay Payment Link created: ${link.short_url}`,
    }).run();

    return NextResponse.json({ ok: true, paymentLink: link });
  } catch (err: any) {
    // Graceful executor failure — log and escalate
    if (caseId) {
      db.insert(auditLog).values({
        id: randomUUID(),
        caseId,
        ts: Math.floor(Date.now() / 1000),
        actor: "executor",
        event: "executor_failure",
        detail: `Payment Link creation failed: ${err.message}. Escalating to human.`,
      }).run();
    }
    return NextResponse.json({ ok: false, error: err.message, escalated: true }, { status: 502 });
  }
}
