import type { CaseInput } from "@/engine/agent";
import type { FailureCause } from "@/db/schema";
import { chatJSON, llmConfigured } from "./llmClient";

export interface LLMResult {
  cause: FailureCause;
  narrative: string;
  outreachCopy: string;
  confidence: number;
  fallback: boolean;
  fallbackReason?: string;
}

const VALID_CAUSES: FailureCause[] = [
  "insufficient_funds", "bank_outage", "psp_down", "mandate_revoked",
  "instrument_expired", "customer_cancelled", "upi_hang", "auth_failed", "unknown",
];

const SYSTEM_PROMPT = `You are a payments diagnosis expert for Indian UPI, card, and e-mandate payments.
You classify why a payment failed so that the correct recovery action can be taken by a separate
policy engine. You never recommend an action and never decide anything about money.
Return only valid JSON.`;

/**
 * Interprets a failure whose error fields are ambiguous or contradictory.
 *
 * This is called only for the minority of cases the deterministic taxonomy cannot
 * settle. The returned cause is advisory: the policy engine decides the action, and
 * a confident taxonomy verdict outranks a hesitant model.
 */
export async function refineCause(c: CaseInput, taxonomyCause: FailureCause): Promise<LLMResult> {
  if (!llmConfigured()) {
    return fallback(taxonomyCause, "No LLM_API_KEY configured.");
  }

  const res = await chatJSON<{
    cause?: string; narrative?: string; outreach_copy?: string; confidence?: number;
  }>([
    { role: "system", content: SYSTEM_PROMPT },
    { role: "user",   content: buildPrompt(c, taxonomyCause) },
  ], { maxTokens: 900 });

  if (res.failed || !res.data) {
    return fallback(taxonomyCause, res.reason ?? "LLM call failed.");
  }

  const cause = VALID_CAUSES.includes(res.data.cause as FailureCause)
    ? (res.data.cause as FailureCause)
    : taxonomyCause;

  return {
    cause,
    narrative: res.data.narrative?.trim() || `Cause assessed as "${cause}".`,
    outreachCopy: res.data.outreach_copy?.trim() ?? "",
    confidence: clamp(res.data.confidence),
    fallback: false,
  };
}

/**
 * Hinglish voice script for a recovery call.
 * Code-mixed Hindi/English is what actually gets answered in India; a formal
 * English script reads like a collections notice and gets hung up on.
 */
export async function generateHinglishScript(c: CaseInput, cause: FailureCause): Promise<{
  script: string;
  fallback: boolean;
}> {
  if (!llmConfigured()) return { script: defaultHinglishScript(c, cause), fallback: true };

  const amount = (c.amountPaise / 100).toFixed(0);

  const res = await chatJSON<{ script?: string }>([
    { role: "system", content: "You write warm, respectful Hinglish payment reminders. Return only valid JSON." },
    { role: "user", content:
`Write a Hinglish (Hindi written in Latin script, mixed with English) voice script for a
payment recovery call. It will be read aloud by a text-to-speech engine.

Customer: ${c.customerName}
Amount pending: ₹${amount}
Why it failed: ${describeCause(cause)}

Rules: under 55 words, warm and respectful, never threatening, acknowledge the specific
reason it failed, end with one clear call to action. No emoji.

Return JSON: {"script":"..."}` },
  ], { maxTokens: 700 });

  if (res.failed || !res.data?.script) {
    return { script: defaultHinglishScript(c, cause), fallback: true };
  }
  return { script: res.data.script.trim(), fallback: false };
}

function describeCause(cause: FailureCause): string {
  switch (cause) {
    case "insufficient_funds": return "their account did not have enough balance";
    case "mandate_revoked":    return "their auto-pay mandate was cancelled";
    case "instrument_expired": return "their card has expired";
    case "bank_outage":        return "their bank was temporarily unavailable (our side, not theirs)";
    case "psp_down":           return "the UPI app was temporarily down (not their fault)";
    case "upi_hang":           return "the UPI request timed out midway";
    case "auth_failed":        return "the PIN or OTP did not go through";
    case "customer_cancelled": return "they chose to cancel";
    default:                   return "the payment did not go through";
  }
}

function clamp(v: unknown): number {
  const n = typeof v === "number" ? v : 0.7;
  return Math.max(0, Math.min(1, n));
}

function fallback(cause: FailureCause, reason: string): LLMResult {
  return {
    cause,
    narrative: `Held at the taxonomy verdict "${cause}" because the model was unavailable.`,
    outreachCopy: "",
    confidence: 0.6,
    fallback: true,
    fallbackReason: reason,
  };
}

function defaultHinglishScript(c: CaseInput, cause?: FailureCause): string {
  const amount = (c.amountPaise / 100).toFixed(0);
  const name   = c.customerName;

  switch (cause) {
    case "insufficient_funds":
      return `Namaste ${name} ji. Aapka ₹${amount} ka payment balance ki wajah se complete nahi hua. ` +
        `Jab account mein funds hon, aap link pe click karke payment kar sakte hain. Dhanyavaad.`;
    case "mandate_revoked":
      return `Namaste ${name} ji. Aapka auto-pay mandate cancel ho gaya hai, isliye ₹${amount} ka payment pending hai. ` +
        `Aap ek baar link se manually pay kar sakte hain ya naya mandate set up kar sakte hain. Dhanyavaad.`;
    case "instrument_expired":
      return `Namaste ${name} ji. Aapka card expire ho gaya hai, isliye ₹${amount} ka payment nahi hua. ` +
        `Nayi card details update karein ya link se ek-baar payment karein. Shukriya.`;
    case "bank_outage":
      return `Namaste ${name} ji. Aapka ₹${amount} ka payment bank ki temporary problem ki wajah se nahi hua — ` +
        `aapki koi galti nahi. Thodi der mein link se try karein, bank theek ho jayega. Dhanyavaad.`;
    case "psp_down":
      return `Namaste ${name} ji. UPI app thodi der ke liye down tha, isliye ₹${amount} ka payment pending raha. ` +
        `Ab sab theek hai — link pe click karke pay kar sakte hain. Dhanyavaad.`;
    case "upi_hang":
      return `Namaste ${name} ji. UPI request beech mein ruk gayi, ₹${amount} deducted nahi hua. ` +
        `Please link se dobara try karein. Ek minute lagega. Shukriya.`;
    case "auth_failed":
      return `Namaste ${name} ji. PIN ya OTP sahi nahi tha, isliye ₹${amount} ka payment nahi hua. ` +
        `Link pe click karein aur dobara try karein — is baar hoga. Dhanyavaad.`;
    case "customer_cancelled":
      return `Namaste ${name} ji. Lagta hai payment beech mein cancel ho gaya. ₹${amount} abhi bhi pending hai. ` +
        `Jab ready hon, link se complete kar sakte hain. Koi pareshani ho to batayein.`;
    default:
      return `Namaste ${name} ji. Aapka ₹${amount} ka payment abhi pending hai. ` +
        `Jab aapko convenient ho, aap link se pay kar sakte hain. Koi dikkat ho to humein bataiye, ` +
        `hum help karenge. Dhanyavaad.`;
  }
}

function buildPrompt(c: CaseInput, taxonomyCause: FailureCause): string {
  return `A payment failed and the error fields are ambiguous. Determine the most likely root cause.

Payment:
- Method: ${c.paymentMethod}
- Amount: ₹${(c.amountPaise / 100).toFixed(2)}
- error_reason: ${c.errorReason || "(empty)"}
- error_source: ${c.errorSource || "(empty)"}
- error_step: ${c.errorStep || "(empty)"}
- error_description: ${c.errorDescription || "(empty)"}
- Subscription state: ${c.subscriptionState ?? "n/a"}
- Retries already used: ${c.retryCount}
- Deterministic taxonomy's best guess: ${taxonomyCause}

Note: in Indian UPI, a "payment_cancelled" from the customer is frequently a PSP timeout
misreported as a deliberate abort. Weigh the description and the mandate state, not just
the coded reason.

Choose exactly one cause:
insufficient_funds | bank_outage | psp_down | mandate_revoked | instrument_expired |
customer_cancelled | upi_hang | auth_failed | unknown

Set confidence honestly. Below 0.75 the deterministic verdict will be kept instead of yours.

Return JSON:
{"cause":"...","narrative":"2-3 sentences for the merchant","outreach_copy":"short WhatsApp message or empty string","confidence":0.0-1.0}`;
}
