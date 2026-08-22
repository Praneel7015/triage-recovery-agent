import type { CaseInput } from "@/engine/agent";
import type { FailureCause } from "@/db/schema";

export interface LLMResult {
  cause: FailureCause;
  narrative: string;
  outreachCopy: string;
  confidence: number;
  fallback: boolean;
}

/**
 * Calls an OpenAI-compatible LLM with structured output.
 * Used only when taxonomy returns "unknown" or to generate outreach copy.
 * Timeout: 8 seconds. On failure, returns fallback=true.
 */
export async function refineCause(c: CaseInput, taxonomyCause: FailureCause): Promise<LLMResult> {
  const apiKey   = process.env.LLM_API_KEY;
  const baseUrl  = process.env.LLM_BASE_URL ?? "https://api.openai.com/v1";
  const model    = process.env.LLM_MODEL ?? "gpt-4o-mini";

  if (!apiKey || apiKey.startsWith("sk-...")) {
    return makeFallback(taxonomyCause, "No LLM API key configured.");
  }

  const prompt = buildPrompt(c, taxonomyCause);

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);

    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        temperature: 0,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: prompt },
        ],
      }),
      signal: controller.signal,
    });

    clearTimeout(timeout);

    if (!response.ok) {
      return makeFallback(taxonomyCause, `LLM API error: ${response.status}`);
    }

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content ?? "{}";
    const parsed = JSON.parse(content);

    return {
      cause: (parsed.cause as FailureCause) ?? taxonomyCause,
      narrative: parsed.narrative ?? "",
      outreachCopy: parsed.outreach_copy ?? "",
      confidence: typeof parsed.confidence === "number" ? parsed.confidence : 0.7,
      fallback: false,
    };
  } catch (err: any) {
    const reason = err?.name === "AbortError" ? "LLM request timed out (8s)." : `LLM error: ${err?.message}`;
    return makeFallback(taxonomyCause, reason);
  }
}

/**
 * Generates Hinglish outreach copy for high-value voice cases.
 */
export async function generateHinglishScript(c: CaseInput, cause: FailureCause): Promise<string> {
  const apiKey  = process.env.LLM_API_KEY;
  const baseUrl = process.env.LLM_BASE_URL ?? "https://api.openai.com/v1";
  const model   = process.env.LLM_MODEL ?? "gpt-4o-mini";

  if (!apiKey || apiKey.startsWith("sk-...")) {
    return defaultHinglishScript(c);
  }

  const amountRupees = (c.amountPaise / 100).toFixed(2);

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 6000);

    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        temperature: 0.4,
        messages: [{
          role: "user",
          content: `Write a short, friendly Hinglish (Hindi+English mix) voice script for a recovery call.
Customer name: ${c.customerName}
Amount due: ₹${amountRupees}
Failure reason: ${cause}
Keep it under 60 words. Warm, respectful, no pressure. End with a clear call to action.
Return only the script text.`,
        }],
      }),
      signal: controller.signal,
    });

    clearTimeout(timeout);
    if (!response.ok) return defaultHinglishScript(c);
    const data = await response.json();
    return data.choices?.[0]?.message?.content ?? defaultHinglishScript(c);
  } catch {
    return defaultHinglishScript(c);
  }
}

/** Extract a promise-to-pay date from a customer reply using the LLM */
export async function extractPromiseToPay(replyText: string): Promise<string | null> {
  const apiKey  = process.env.LLM_API_KEY;
  const baseUrl = process.env.LLM_BASE_URL ?? "https://api.openai.com/v1";
  const model   = process.env.LLM_MODEL ?? "gpt-4o-mini";

  if (!apiKey || apiKey.startsWith("sk-...")) return null;

  try {
    const controller = new AbortController();
    setTimeout(() => controller.abort(), 5000);

    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        temperature: 0,
        response_format: { type: "json_object" },
        messages: [{
          role: "user",
          content: `Extract a promise-to-pay date from this customer message. Today is ${new Date().toISOString().split("T")[0]}.
Message: "${replyText}"
Return JSON: { "date": "YYYY-MM-DD" } or { "date": null } if no date mentioned.`,
        }],
      }),
    });

    if (!response.ok) return null;
    const data = await response.json();
    const parsed = JSON.parse(data.choices?.[0]?.message?.content ?? "{}");
    return parsed.date ?? null;
  } catch {
    return null;
  }
}

function makeFallback(cause: FailureCause, reason: string): LLMResult {
  return {
    cause,
    narrative: `Cause classified as "${cause}" via taxonomy (LLM fallback: ${reason})`,
    outreachCopy: "",
    confidence: 0.6,
    fallback: true,
  };
}

function defaultHinglishScript(c: CaseInput): string {
  const amount = (c.amountPaise / 100).toFixed(0);
  return `Namaste ${c.customerName} ji! Aapka ₹${amount} ka payment pending hai. Kripya convenient time par payment kar dijiye. Koi problem ho toh humse baat karein — hum help karne ke liye yahan hain!`;
}

function buildPrompt(c: CaseInput, taxonomyCause: FailureCause): string {
  return `Analyze this failed Indian payment and classify the failure cause.

Payment details:
- Method: ${c.paymentMethod}
- Amount: ₹${(c.amountPaise / 100).toFixed(2)}
- Error reason: ${c.errorReason ?? "not provided"}
- Error source: ${c.errorSource ?? "not provided"}
- Error step: ${c.errorStep ?? "not provided"}
- Error description: ${c.errorDescription ?? "not provided"}
- Subscription state: ${c.subscriptionState ?? "n/a"}
- Taxonomy initial guess: ${taxonomyCause}

Classify into one of: insufficient_funds | bank_outage | psp_down | mandate_revoked | instrument_expired | customer_cancelled | upi_hang | auth_failed | unknown

Return JSON:
{
  "cause": "<one of the above>",
  "narrative": "<2-3 sentence explanation for the merchant>",
  "outreach_copy": "<short SMS/WhatsApp message to the customer, if any outreach is warranted>",
  "confidence": <0.0-1.0>
}`;
}

const SYSTEM_PROMPT = `You are a payments diagnosis expert for Indian UPI/card/subscription payments.
You help classify payment failures precisely so the correct recovery action is taken.
Return only valid JSON. Never suggest actions — only diagnose.`;
