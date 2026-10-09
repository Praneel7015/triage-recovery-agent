import { db } from "@/db/client";
import { cases, auditLog } from "@/db/schema";
import { eq } from "drizzle-orm";
import { randomUUID } from "crypto";

/**
 * Marks a case recovered after a verified Razorpay payment.
 * Idempotent: a second webhook or checkout confirm does not duplicate the audit row.
 */
export function markCaseRecovered(opts: {
  caseId: string;
  detail: string;
  paymentId?: string;
}): { ok: boolean; alreadyRecovered: boolean } {
  const c = db.select().from(cases).where(eq(cases.id, opts.caseId)).get();
  if (!c) return { ok: false, alreadyRecovered: false };

  if (c.status === "recovered") {
    return { ok: true, alreadyRecovered: true };
  }

  const now = Math.floor(Date.now() / 1000);
  db.update(cases).set({
    status: "recovered",
    resolvedAt: now,
    updatedAt: now,
    recoveredAmountPaise: c.amountPaise,
    razorpayPaymentId: opts.paymentId ?? c.razorpayPaymentId,
  }).where(eq(cases.id, opts.caseId)).run();

  db.insert(auditLog).values({
    id: randomUUID(),
    caseId: opts.caseId,
    ts: now,
    actor: "webhook",
    event: "payment_received",
    detail: opts.detail,
  }).run();

  return { ok: true, alreadyRecovered: false };
}

export function findCaseIdFromPaymentNotes(opts: {
  notesCaseId?: string;
  paymentLinkId?: string;
  paymentId?: string;
}): string | undefined {
  if (opts.notesCaseId) {
    const hit = db.select({ id: cases.id }).from(cases).where(eq(cases.id, opts.notesCaseId)).get();
    if (hit) return hit.id;
  }
  if (opts.paymentLinkId) {
    const hit = db.select({ id: cases.id }).from(cases)
      .where(eq(cases.razorpayPaymentLinkId, opts.paymentLinkId)).get();
    if (hit) return hit.id;
  }
  if (opts.paymentId) {
    const hit = db.select({ id: cases.id }).from(cases)
      .where(eq(cases.razorpayPaymentId, opts.paymentId)).get();
    if (hit) return hit.id;
  }
  return undefined;
}

export function siblingCaseId(id: string): string | null {
  if (id.endsWith("_triage")) return id.replace(/_triage$/, "_naive");
  if (id.endsWith("_naive")) return id.replace(/_naive$/, "_triage");
  return null;
}
