import { NextResponse } from "next/server";
import { markCaseRecovered } from "@/lib/markRecovered";
import { verifyCheckoutSignature } from "@/adapters/razorpay";
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

  if (!process.env.RAZORPAY_KEY_SECRET) {
    return NextResponse.json({ error: "Razorpay key secret not configured" }, { status: 500 });
  }

  if (!verifyCheckoutSignature(razorpay_order_id, razorpay_payment_id, razorpay_signature)) {
    return NextResponse.json({ error: "Payment signature invalid" }, { status: 400 });
  }

  const result = markCaseRecovered({
    caseId,
    paymentId: razorpay_payment_id,
    detail: `Inline checkout: payment ${razorpay_payment_id} verified. Case marked recovered.`,
  });

  if (!result.ok) {
    return NextResponse.json({ error: "Case not found" }, { status: 404 });
  }

  return NextResponse.json({ ok: true, alreadyRecovered: result.alreadyRecovered });
}
