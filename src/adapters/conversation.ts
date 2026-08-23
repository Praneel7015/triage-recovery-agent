import type { FailureCause } from "@/db/schema";
import type { Channel } from "@/engine/economics";
import { chatJSON, llmConfigured } from "./llmClient";
import { roll } from "@/engine/rng";

/**
 * Inbound customer replies.
 *
 * A recovery campaign that only talks is a broadcast, not an agent. Real customers
 * answer — usually in code-mixed Hinglish — and the correct next action depends
 * entirely on what they said. "kal kar dunga" means wait. "STOP" means never
 * contact again. "already paid" means reconcile, not chase.
 *
 * Parsing that is genuine LLM work, so the model is load-bearing here. A keyword
 * classifier stands in whenever the model is unavailable.
 */

export type ReplyIntent =
  | "promise_to_pay"
  | "already_paid"
  | "dispute"
  | "opt_out"
  | "confused"
  | "no_response";

export interface InboundReply {
  text: string;
  /** What the fixture actually meant, used to score extraction accuracy. */
  groundTruth: ReplyIntent;
  receivedOnDay: number;
}

export interface ExtractedIntent {
  intent: ReplyIntent;
  /** ISO date when the customer says they will pay, if any. */
  promiseDate: string | null;
  confidence: number;
  /** True when the LLM was unavailable and keywords were used instead. */
  fallback: boolean;
  method: "llm" | "keyword";
}

// ─── Reply corpus, in the Hinglish customers actually write ───────────────────

const REPLIES: Record<Exclude<ReplyIntent, "no_response">, string[]> = {
  promise_to_pay: [
    "bhai kal salary aa rahi hai, parso pakka kar dunga",
    "1 tarikh ko ho jayega, thoda wait karo",
    "abhi paise nahi hai, next week karta hoon",
    "sorry yaar, 3 din me kar dunga promise",
    "salary credit hote hi pay kar dunga, 7th tak",
  ],
  already_paid: [
    "maine already payment kar diya hai bhai, check karo",
    "payment ho gaya hai, screenshot bhej raha hoon",
    "arre yaar paisa cut gaya mere account se already",
    "already paid via UPI yesterday, why message again",
  ],
  dispute: [
    "maine ye subscription cancel kar diya tha, phir kyun charge",
    "mujhe ye service nahi chahiye, band karo",
    "I never authorised this mandate, remove it",
    "galat charge hai ye, main pay nahi karunga",
  ],
  opt_out: [
    "mujhe message na bhejo, STOP",
    "stop messaging me please",
    "band karo ye messages, block kar dunga",
    "STOP",
  ],
  confused: [
    "ye kya hai? samajh nahi aaya",
    "kaun bol raha hai? kis cheez ka payment",
    "what is this for",
  ],
};

/** Probability that a touch on this channel gets any reply at all. */
const REPLY_RATE: Record<Channel, number> = {
  none: 0, retry: 0, email: 0.06, sms: 0.12, whatsapp: 0.32, voice: 0.45, human: 0.80,
};

/**
 * Deterministic reply simulation, seeded on case id and day so campaigns replay
 * identically. Intent distribution is conditioned on the failure cause, because
 * a revoked mandate produces disputes and an empty account produces promises.
 */
export function simulateInboundReply(
  caseId: string,
  cause: FailureCause,
  channel: Channel,
  day: number,
): InboundReply | null {
  const rate = REPLY_RATE[channel] ?? 0;
  if (rate === 0) return null;

  if (roll(`${caseId}|${day}|reply`) > rate) return null;

  const intent = pickIntent(cause, roll(`${caseId}|${day}|intent`));
  if (intent === "no_response") return null;

  const pool = REPLIES[intent];
  const idx  = Math.floor(roll(`${caseId}|${day}|text`) * pool.length);

  return { text: pool[Math.min(idx, pool.length - 1)], groundTruth: intent, receivedOnDay: day };
}

function pickIntent(cause: FailureCause, roll: number): ReplyIntent {
  // Weights per cause; they sum to 1 within each branch.
  if (cause === "mandate_revoked" || cause === "customer_cancelled") {
    if (roll < 0.45) return "dispute";
    if (roll < 0.65) return "opt_out";
    if (roll < 0.80) return "promise_to_pay";
    if (roll < 0.92) return "confused";
    return "already_paid";
  }
  if (cause === "insufficient_funds") {
    if (roll < 0.62) return "promise_to_pay";
    if (roll < 0.74) return "already_paid";
    if (roll < 0.84) return "confused";
    if (roll < 0.94) return "opt_out";
    return "dispute";
  }
  if (cause === "bank_outage" || cause === "psp_down" || cause === "upi_hang") {
    if (roll < 0.42) return "already_paid";   // money often left their account
    if (roll < 0.68) return "confused";
    if (roll < 0.86) return "promise_to_pay";
    if (roll < 0.95) return "dispute";
    return "opt_out";
  }
  if (roll < 0.40) return "promise_to_pay";
  if (roll < 0.60) return "confused";
  if (roll < 0.78) return "already_paid";
  if (roll < 0.92) return "dispute";
  return "opt_out";
}

// ─── Intent extraction ───────────────────────────────────────────────────────

const SYSTEM = `You classify inbound customer replies to Indian payment-recovery messages.
Replies are usually code-mixed Hinglish (Hindi written in Latin script mixed with English).
Return only valid JSON. Never invent a payment date the customer did not state.`;

/**
 * Extracts structured intent from a free-text reply.
 * Falls back to keyword matching when the LLM is unreachable so the campaign
 * never stalls on an unavailable model.
 */
export async function extractIntent(text: string, today: Date = new Date()): Promise<ExtractedIntent> {
  if (!llmConfigured()) return keywordFallback(text, today);

  const todayISO = today.toISOString().split("T")[0];

  const res = await chatJSON<{ intent?: string; promise_date?: string | null; confidence?: number }>([
    { role: "system", content: SYSTEM },
    { role: "user", content:
`Today is ${todayISO}.

Customer reply: "${text}"

Classify the intent as exactly one of:
promise_to_pay | already_paid | dispute | opt_out | confused

If and only if the intent is promise_to_pay, resolve any stated timing
("kal", "parso", "1 tarikh", "next week", "3 din me") into an absolute date.

Return JSON: {"intent":"...","promise_date":"YYYY-MM-DD or null","confidence":0.0-1.0}` },
  ], { maxTokens: 600 });

  if (res.failed || !res.data) return keywordFallback(text, today);

  const intent = normaliseIntent(res.data.intent);
  if (!intent) return keywordFallback(text, today);

  return {
    intent,
    promiseDate: intent === "promise_to_pay" ? (res.data.promise_date ?? null) : null,
    confidence: typeof res.data.confidence === "number" ? res.data.confidence : 0.7,
    fallback: false,
    method: "llm",
  };
}

function normaliseIntent(v: unknown): ReplyIntent | null {
  const s = String(v ?? "").toLowerCase().trim();
  const allowed: ReplyIntent[] = ["promise_to_pay", "already_paid", "dispute", "opt_out", "confused", "no_response"];
  return (allowed as string[]).includes(s) ? (s as ReplyIntent) : null;
}

/** Deterministic keyword classifier used when the LLM is unavailable. */
export function keywordFallback(text: string, today: Date = new Date()): ExtractedIntent {
  const t = text.toLowerCase();

  if (/\bstop\b|band karo|na bhejo|unsubscribe|block/.test(t)) {
    return { intent: "opt_out", promiseDate: null, confidence: 0.9, fallback: true, method: "keyword" };
  }
  if (/already|ho gaya|kar diya|cut gaya|paid|screenshot/.test(t)) {
    return { intent: "already_paid", promiseDate: null, confidence: 0.75, fallback: true, method: "keyword" };
  }
  if (/cancel|nahi chahiye|never authorised|galat|dispute|nahi karunga/.test(t)) {
    return { intent: "dispute", promiseDate: null, confidence: 0.75, fallback: true, method: "keyword" };
  }
  if (/kal|parso|tarikh|next week|din me|salary|wait|promise|dunga|karta hoon|karunga/.test(t)) {
    return {
      intent: "promise_to_pay",
      promiseDate: guessPromiseDate(t, today),
      confidence: 0.65,
      fallback: true,
      method: "keyword",
    };
  }
  if (/kya hai|samajh|kaun|what is this/.test(t)) {
    return { intent: "confused", promiseDate: null, confidence: 0.7, fallback: true, method: "keyword" };
  }
  return { intent: "confused", promiseDate: null, confidence: 0.3, fallback: true, method: "keyword" };
}

function guessPromiseDate(t: string, today: Date): string {
  const add = (days: number) => {
    const d = new Date(today);
    d.setDate(d.getDate() + days);
    return d.toISOString().split("T")[0];
  };
  if (/parso/.test(t))              return add(2);
  if (/\bkal\b/.test(t))            return add(1);
  if (/next week|agle hafte/.test(t)) return add(7);

  const dinMatch = t.match(/(\d+)\s*din/);
  if (dinMatch) return add(Math.min(parseInt(dinMatch[1], 10), 30));

  const tarikhMatch = t.match(/(\d{1,2})\s*(?:tarikh|th|st|nd|rd)/);
  if (tarikhMatch) {
    const dom = parseInt(tarikhMatch[1], 10);
    const d = new Date(today);
    if (dom > d.getDate()) d.setDate(dom);
    else { d.setMonth(d.getMonth() + 1); d.setDate(dom); }
    return d.toISOString().split("T")[0];
  }
  return add(5);
}
