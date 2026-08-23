import { NextResponse } from "next/server";
import { db } from "@/db/client";
import { cases } from "@/db/schema";
import { eq } from "drizzle-orm";
import Razorpay from "razorpay";
import { migrate } from "@/db/migrate";

migrate();

/**
 * POST /api/live/order
 * Body: { caseId: string }
 * Creates a Razorpay Order and returns the order_id + metadata needed by
 * checkout.js to open the inline payment modal on the same page.
 */
export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Request body must be JSON" }, { status: 400 });
  }

  const caseId = (body as Record<string, unknown>)?.caseId as string | undefined;
  if (!caseId || typeof caseId !== "string") {
    return NextResponse.json({ error: "caseId required" }, { status: 400 });
  }

  const c = db.select().from(cases).where(eq(cases.id, caseId.trim())).get();
  if (!c) return NextResponse.json({ error: "Case not found" }, { status: 404 });
  if (c.amountPaise < 100) {
    return NextResponse.json({ error: "Amount too small for Razorpay (min ₹1)" }, { status: 400 });
  }

  const keyId     = process.env.RAZORPAY_KEY_ID;
  const keySecret = process.env.RAZORPAY_KEY_SECRET;
  if (!keyId || !keySecret || keyId.includes("XXXX")) {
    return NextResponse.json({ error: "Razorpay keys not configured" }, { status: 500 });
  }

  try {
    const rz = new Razorpay({ key_id: keyId, key_secret: keySecret });
    const order = await (rz.orders as any).create({
      amount: c.amountPaise,
      currency: c.currency ?? "INR",
      receipt: c.id.slice(0, 40),
      notes: {
        case_id: c.id,
        customer_id: c.customerId,
        source: "triage_agent",
      },
    });

    return NextResponse.json({
      ok: true,
      orderId: order.id,
      amount: c.amountPaise,
      currency: c.currency ?? "INR",
      keyId,
      customerName: c.customerName,
      customerEmail: c.customerEmail ?? "",
      customerPhone: c.customerPhone ?? "",
      description: c.diagnosisNarrative ?? "Payment recovery",
      caseId: c.id,
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 502 });
  }
}
