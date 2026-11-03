import { db } from "@/db/client";
import { cases } from "@/db/schema";
import { eq } from "drizzle-orm";
import { verifyCheckoutSignature, fetchOrder, type OrderSnapshot } from "@/adapters/razorpay";
import { markCaseRecovered } from "@/lib/markRecovered";

export type ConfirmResult =
  | { ok: true; alreadyRecovered: boolean }
  | { ok: false; status: number; error: string };

/**
 * Closes a case after an inline Checkout.js payment.
 *
 * The Checkout signature only proves that `payment_id` paid `order_id`. It says
 * nothing about which case the order was for, so a genuine payment on one case
 * could otherwise be replayed against any other case id. The order's own
 * `notes.case_id` and amount, fetched from Razorpay, bind it to the case.
 */
export async function confirmCheckoutPayment(
  input: { caseId: string; orderId: string; paymentId: string; signature: string },
  getOrder: (orderId: string) => Promise<OrderSnapshot> = fetchOrder,
): Promise<ConfirmResult> {
  if (!verifyCheckoutSignature(input.orderId, input.paymentId, input.signature)) {
    return { ok: false, status: 400, error: "Payment signature invalid" };
  }

  let order: OrderSnapshot;
  try {
    order = await getOrder(input.orderId);
  } catch {
    return { ok: false, status: 502, error: "Could not fetch order from Razorpay" };
  }

  if (order.notes?.case_id !== input.caseId) {
    return { ok: false, status: 400, error: "Order does not belong to this case" };
  }

  const c = db.select({ amountPaise: cases.amountPaise }).from(cases)
    .where(eq(cases.id, input.caseId)).get();
  if (!c) return { ok: false, status: 404, error: "Case not found" };

  if (order.amount !== c.amountPaise) {
    return { ok: false, status: 400, error: "Order amount does not match the case" };
  }

  const result = markCaseRecovered({
    caseId: input.caseId,
    paymentId: input.paymentId,
    detail: `Inline checkout: payment ${input.paymentId} verified against order ${input.orderId}. Case marked recovered.`,
  });
  if (!result.ok) return { ok: false, status: 404, error: "Case not found" };

  return { ok: true, alreadyRecovered: result.alreadyRecovered };
}
