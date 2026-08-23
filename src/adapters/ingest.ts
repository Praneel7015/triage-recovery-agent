import { db } from "@/db/client";
import { cases, auditLog } from "@/db/schema";
import { eq } from "drizzle-orm";
import { randomUUID } from "crypto";
import { classifyCause } from "@/engine/taxonomy";

interface RazorpayPaymentEntity {
  id?: string;
  amount?: number;
  currency?: string;
  method?: string;
  email?: string;
  contact?: string;
  notes?: Record<string, string>;
  error_code?: string;
  error_reason?: string;
  error_source?: string;
  error_step?: string;
  error_description?: string;
  subscription_id?: string;
  invoice_id?: string;
  created_at?: number;
}

interface RazorpaySubscriptionEntity {
  id?: string;
  status?: string;
  notes?: Record<string, string>;
}

function customerName(entity: RazorpayPaymentEntity): string {
  const fromNotes = entity.notes?.customer_name ?? entity.notes?.name;
  if (fromNotes) return fromNotes;
  if (entity.email) return entity.email.split("@")[0] ?? "Customer";
  if (entity.contact) return `+${entity.contact.slice(-4)} customer`;
  return "Customer";
}

function customerId(entity: RazorpayPaymentEntity): string {
  return entity.email ?? entity.contact ?? entity.id ?? randomUUID();
}

/**
 * Creates an open case file from a live Razorpay failure webhook.
 * Returns the case id, or null when the payload lacks enough identity.
 */
export function ingestFailedPayment(
  entity: RazorpayPaymentEntity,
  event: string,
  subscription?: RazorpaySubscriptionEntity | null,
): string | null {
  const paymentId = entity.id;
  if (!paymentId) return null;

  const caseId = `live_${paymentId}`;
  const existing = db.select({ id: cases.id }).from(cases).where(eq(cases.id, caseId)).get();
  if (existing) return caseId;

  const now = Math.floor(Date.now() / 1000);
  const fields = {
    errorCode: entity.error_code ?? null,
    errorReason: entity.error_reason ?? null,
    errorSource: entity.error_source ?? null,
    errorStep: entity.error_step ?? null,
    errorDescription: entity.error_description ?? null,
    bankOutageActive: false,
    subscriptionState: subscription?.status ?? null,
    paymentMethod: entity.method ?? "upi",
  };
  const cause = classifyCause(fields);

  db.insert(cases).values({
    id: caseId,
    customerId: customerId(entity),
    customerName: customerName(entity),
    customerPhone: entity.contact ?? null,
    customerEmail: entity.email ?? null,
    amountPaise: entity.amount ?? 0,
    currency: entity.currency ?? "INR",
    paymentMethod: entity.method ?? "upi",
    subscriptionId: entity.subscription_id ?? subscription?.id ?? null,
    subscriptionState: subscription?.status ?? null,
    razorpayPaymentId: paymentId,
    errorCode: fields.errorCode,
    errorReason: fields.errorReason,
    errorSource: fields.errorSource,
    errorStep: fields.errorStep,
    errorDescription: fields.errorDescription,
    cause,
    diagnosisNarrative: `Live ingest from ${event}. Cause classified from Razorpay error fields.`,
    status: "open",
    retryCount: 0,
    touchCount: 0,
    isDnd: false,
    hasConsented: true,
    bankOutageActive: false,
    segment: entity.invoice_id ? "b2b_invoice" : entity.subscription_id ? "subscription" : "checkout",
    invoiceId: entity.invoice_id ?? null,
    failedAt: entity.created_at ?? now,
    createdAt: now,
    updatedAt: now,
    batchId: null,
    isNaiveRun: false,
  }).run();

  db.insert(auditLog).values({
    id: randomUUID(),
    caseId,
    ts: now,
    actor: "webhook",
    event: "case_ingested",
    detail: `${event} → open case file ${caseId}. Preliminary cause: ${cause}.`,
  }).run();

  return caseId;
}
