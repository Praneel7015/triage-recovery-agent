import Razorpay from "razorpay";
import crypto from "crypto";

let _client: Razorpay | null = null;

function getClient(): Razorpay {
  if (_client) return _client;

  const keyId     = process.env.RAZORPAY_KEY_ID;
  const keySecret = process.env.RAZORPAY_KEY_SECRET;

  if (!keyId || !keySecret || keyId.includes("XXXX")) {
    throw new Error("Razorpay keys not configured. Copy .env.example → .env and fill in test keys.");
  }

  _client = new Razorpay({ key_id: keyId, key_secret: keySecret });
  return _client;
}

export interface CreatePaymentLinkParams {
  caseId: string;
  customerId: string;
  customerName: string;
  customerEmail?: string | null;
  customerPhone?: string | null;
  amountPaise: number;
  description: string;
  expireAfterSeconds?: number;
}

export interface PaymentLinkResult {
  id: string;
  short_url: string;
  status: string;
}

/**
 * Creates a Razorpay Standard Payment Link.
 * Used for send_one_time_payment_link and send_method_update_link actions.
 */
export async function createPaymentLink(
  params: CreatePaymentLinkParams,
): Promise<PaymentLinkResult> {
  const rz = getClient();
  const expireBy = params.expireAfterSeconds
    ? Math.floor(Date.now() / 1000) + params.expireAfterSeconds
    : Math.floor(Date.now() / 1000) + 7 * 24 * 60 * 60; // 7 days default

  const link = await rz.paymentLink.create({
    amount: params.amountPaise,
    currency: "INR",
    description: params.description,
    customer: {
      name: params.customerName,
      email: params.customerEmail ?? undefined,
      contact: params.customerPhone ?? undefined,
    },
    notify: {
      sms: !!params.customerPhone,
      email: !!params.customerEmail,
    },
    reminder_enable: true,
    expire_by: expireBy,
    notes: {
      case_id: params.caseId,
      customer_id: params.customerId,
      source: "triage_agent",
    },
    callback_url: `${process.env.APP_BASE_URL ?? "http://localhost:3000"}/api/webhooks/razorpay`,
    callback_method: "get",
  } as any);

  return {
    id: (link as any).id,
    short_url: (link as any).short_url,
    status: (link as any).status,
  };
}

/**
 * Verifies the HMAC-SHA256 signature on an incoming Razorpay webhook.
 * Throws if the signature is invalid.
 */
export function verifyWebhookSignature(rawBody: string, signature: string): void {
  const secret = process.env.RAZORPAY_WEBHOOK_SECRET;
  if (!secret) throw new Error("RAZORPAY_WEBHOOK_SECRET not configured.");

  const expected = crypto
    .createHmac("sha256", secret)
    .update(rawBody)
    .digest("hex");

  if (!crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signature))) {
    throw new Error("Webhook signature mismatch.");
  }
}

/** Fetch a payment link by ID */
export async function getPaymentLink(id: string) {
  const rz = getClient();
  return await rz.paymentLink.fetch(id);
}
