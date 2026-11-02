import { NextResponse } from "next/server";
import { confirmCheckoutPayment } from "@/lib/confirmCheckout";
import { migrate } from "@/db/migrate";

migrate();

/**
 * POST /api/live/confirm
 * Body: { caseId, razorpay_order_id, razorpay_payment_id, razorpay_signature }
 * Verifies the Razorpay payment signature, checks the order was created for
 * this case, and marks the case recovered.
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

  if (!process.env.RAZORPAY_KEY_SECRET) {
    return NextResponse.json({ error: "Razorpay key secret not configured" }, { status: 500 });
  }

  const result = await confirmCheckoutPayment({
    caseId,
    orderId: razorpay_order_id,
    paymentId: razorpay_payment_id,
    signature: razorpay_signature,
  });

  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }

  return NextResponse.json({ ok: true, alreadyRecovered: result.alreadyRecovered });
}
