import type { FailureCause } from "@/db/schema";

/**
 * Maps Razorpay error fields to a FailureCause.
 * Deterministic — no LLM involved. LLM is called only when this returns "unknown".
 */
export interface RazorpayErrorFields {
  errorCode?: string | null;
  errorReason?: string | null;
  errorSource?: string | null;
  errorStep?: string | null;
  errorDescription?: string | null;
  bankOutageActive?: boolean;
  subscriptionState?: string | null;
  paymentMethod?: string;
}

export function classifyCause(f: RazorpayErrorFields): FailureCause {
  const reason = (f.errorReason ?? "").toLowerCase();
  const source = (f.errorSource ?? "").toLowerCase();
  const step   = (f.errorStep ?? "").toLowerCase();
  const desc   = (f.errorDescription ?? "").toLowerCase();

  // Bank / PSP infrastructure outage — silence, no contact
  if (
    f.bankOutageActive ||
    reason === "bank_not_available" ||
    reason === "bank_technical_error" ||
    reason === "partner_bank_downtime" ||
    reason === "psp_app_not_available" ||
    reason === "psp_not_available" ||
    reason === "upi_app_technical_error" ||
    desc.includes("downtime") ||
    desc.includes("bank is not available")
  ) {
    return f.errorReason?.toLowerCase().includes("psp") ? "psp_down" : "bank_outage";
  }

  // Mandate explicitly revoked by customer
  if (
    f.subscriptionState === "cancelled" ||
    reason === "payment_cancelled" && source === "customer" && step === "payment_authentication" ||
    reason === "mandate_revoked" ||
    reason === "mandate_cancelled" ||
    desc.includes("mandate") && desc.includes("cancel")
  ) {
    return "mandate_revoked";
  }

  // Card / instrument has expired
  if (
    reason === "card_expired" ||
    reason === "invalid_card_expiry" ||
    desc.includes("expired")
  ) {
    return "instrument_expired";
  }

  // Insufficient funds — most recoverable, wait for salary window
  if (
    reason === "insufficient_funds" ||
    reason === "insufficient_funds_mandate_block" ||
    desc.includes("insufficient")
  ) {
    return "insufficient_funds";
  }

  // UPI timeout — looks like abandonment but is an infrastructure hang
  if (
    reason === "reqauth_mandate_not_acknowledged" ||
    reason === "upi_request_timeout" ||
    (f.paymentMethod === "upi" && reason === "payment_failed" && source !== "customer") ||
    desc.includes("timeout") ||
    desc.includes("not acknowledged")
  ) {
    return "upi_hang";
  }

  // Genuine customer cancellation
  if (
    reason === "payment_cancelled" ||
    reason === "payment_cancelled_by_user" ||
    source === "customer" && step === "payment_authentication"
  ) {
    return "customer_cancelled";
  }

  // Auth failure (OTP, 3DS, PIN)
  if (
    reason === "invalid_otp" ||
    reason === "incorrect_otp" ||
    reason === "payment_authentication_failed" ||
    reason === "invalid_device" ||
    step === "payment_authentication" && source !== "customer"
  ) {
    return "auth_failed";
  }

  return "unknown";
}

/** Human-readable cause labels for UI */
export const CAUSE_LABELS: Record<FailureCause, string> = {
  insufficient_funds:  "Insufficient Funds",
  bank_outage:         "Bank / Network Outage",
  psp_down:            "PSP Downtime",
  mandate_revoked:     "Mandate Revoked by Customer",
  instrument_expired:  "Card / Instrument Expired",
  customer_cancelled:  "Customer Cancelled",
  upi_hang:            "UPI Timeout (Infrastructure)",
  auth_failed:         "Authentication Failure",
  unknown:             "Unknown — needs LLM",
};
