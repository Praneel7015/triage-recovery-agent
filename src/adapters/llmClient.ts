/**
 * Shared LLM transport.
 *
 * Two things make this more than a fetch wrapper. First, free-tier providers
 * rate-limit aggressively (Groq allows 8k tokens/minute), and a batch of 168
 * campaigns will trip that instantly — so 429s are retried with the delay the
 * provider asks for rather than being silently swallowed as failures. Second,
 * every call is bounded by a timeout and a serialising queue, so an unavailable
 * model degrades the agent's judgment without ever stalling a campaign.
 */

export interface LlmResult<T> {
  data: T | null;
  /** True when we could not get a usable model response. */
  failed: boolean;
  reason?: string;
  attempts: number;
}

const TIMEOUT_MS     = 20_000;
const MAX_ATTEMPTS   = 3;
const MIN_GAP_MS     = 400;    // spacing between calls to stay under provider TPM
const MAX_BACKOFF_MS = 15_000;

/**
 * Reasoning models (gpt-oss, o-series, qwen-think) spend several hundred tokens
 * thinking before they emit anything. Budget too tightly and the response is
 * truncated mid-object, which the provider then rejects as invalid JSON — a 400
 * that looks exactly like a bad prompt. Headroom is not optional here.
 */
const DEFAULT_MAX_TOKENS = 900;

let queueTail: Promise<unknown> = Promise.resolve();
let lastCallAt = 0;

/** Serialises calls and spaces them out, so a batch does not burst into a 429. */
function enqueue<T>(fn: () => Promise<T>): Promise<T> {
  const run = queueTail.then(async () => {
    const gap = Date.now() - lastCallAt;
    if (gap < MIN_GAP_MS) await sleep(MIN_GAP_MS - gap);
    lastCallAt = Date.now();
    return fn();
  });
  // Keep the chain alive even if this call rejects.
  queueTail = run.then(() => undefined, () => undefined);
  return run;
}

function sleep(ms: number) {
  return new Promise(r => setTimeout(r, ms));
}

export function llmConfigured(): boolean {
  const key = process.env.LLM_API_KEY;
  return Boolean(key) && !key!.startsWith("sk-...");
}

/**
 * Requests a JSON object from the model.
 * Returns `failed: true` rather than throwing, so callers always have a path
 * to their deterministic fallback.
 */
export async function chatJSON<T = Record<string, unknown>>(
  messages: Array<{ role: "system" | "user"; content: string }>,
  opts: { maxTokens?: number } = {},
): Promise<LlmResult<T>> {
  if (!llmConfigured()) {
    return { data: null, failed: true, reason: "No LLM_API_KEY configured.", attempts: 0 };
  }

  const baseUrl = process.env.LLM_BASE_URL ?? "https://api.openai.com/v1";
  const model   = process.env.LLM_MODEL ?? "gpt-4o-mini";
  const apiKey  = process.env.LLM_API_KEY!;

  return enqueue(async () => {
    let lastReason = "";

    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

      try {
        const res = await fetch(`${baseUrl}/chat/completions`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
          body: JSON.stringify({
            model,
            temperature: 0,
            // Widen the budget on each retry, since truncation is the common failure.
            max_tokens: (opts.maxTokens ?? DEFAULT_MAX_TOKENS) * attempt,
            response_format: { type: "json_object" },
            messages,
          }),
          signal: controller.signal,
        });
        clearTimeout(timer);

        if (res.status === 429 || res.status >= 500) {
          const body = await res.text();
          const wait = retryDelayFrom(body, res.headers.get("retry-after"), attempt);
          lastReason = `HTTP ${res.status} from provider; waited ${wait}ms before retry.`;
          if (attempt < MAX_ATTEMPTS) { await sleep(wait); continue; }
          return { data: null, failed: true, reason: lastReason, attempts: attempt };
        }

        if (!res.ok) {
          const body = await res.text();
          // A 400 here is usually a truncated JSON body rather than a bad prompt,
          // so retry once with more room before giving up on the model.
          if (res.status === 400 && /json/i.test(body) && attempt < MAX_ATTEMPTS) {
            lastReason = `HTTP 400 (invalid/truncated JSON) — retrying with a larger token budget.`;
            continue;
          }
          return { data: null, failed: true, reason: `HTTP ${res.status}: ${summarise(body)}`, attempts: attempt };
        }

        const payload = await res.json();
        const content = payload?.choices?.[0]?.message?.content;
        if (!content) {
          lastReason = "Model returned an empty message.";
          if (attempt < MAX_ATTEMPTS) { await sleep(400 * attempt); continue; }
          return { data: null, failed: true, reason: lastReason, attempts: attempt };
        }

        try {
          return { data: JSON.parse(extractJson(content)) as T, failed: false, attempts: attempt };
        } catch {
          lastReason = "Model response was not parseable JSON.";
          if (attempt < MAX_ATTEMPTS) { await sleep(400 * attempt); continue; }
          return { data: null, failed: true, reason: lastReason, attempts: attempt };
        }
      } catch (e) {
        clearTimeout(timer);
        const aborted = e instanceof Error && e.name === "AbortError";
        lastReason = aborted ? `Timed out after ${TIMEOUT_MS}ms.` : `Transport error: ${(e as Error).message}`;
        if (attempt < MAX_ATTEMPTS && !aborted) { await sleep(400 * attempt); continue; }
        return { data: null, failed: true, reason: lastReason, attempts: attempt };
      }
    }

    return { data: null, failed: true, reason: lastReason || "Exhausted retries.", attempts: MAX_ATTEMPTS };
  });
}

/** Honours the provider's own "try again in Xs" hint when it gives one. */
function retryDelayFrom(body: string, retryAfter: string | null, attempt: number): number {
  if (retryAfter) {
    const secs = parseFloat(retryAfter);
    if (!isNaN(secs)) return Math.min(secs * 1000 + 250, MAX_BACKOFF_MS);
  }
  const m = body.match(/try again in ([\d.]+)s/i);
  if (m) return Math.min(parseFloat(m[1]) * 1000 + 250, MAX_BACKOFF_MS);
  return Math.min(800 * Math.pow(2, attempt - 1), MAX_BACKOFF_MS);
}

/** Keeps provider error bodies short enough to log usefully. */
function summarise(body: string): string {
  try {
    const parsed = JSON.parse(body);
    return String(parsed?.error?.message ?? body).slice(0, 160);
  } catch {
    return body.slice(0, 160);
  }
}

/** Some models wrap JSON in prose or fences despite being asked not to. */
function extractJson(s: string): string {
  const trimmed = s.trim();
  if (trimmed.startsWith("{")) return trimmed;
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenced) return fenced[1].trim();
  const first = trimmed.indexOf("{");
  const last  = trimmed.lastIndexOf("}");
  if (first !== -1 && last > first) return trimmed.slice(first, last + 1);
  return trimmed;
}
