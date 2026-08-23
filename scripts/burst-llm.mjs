import "dotenv/config";

// Reproduces the eval's call pattern to find where the provider starts refusing.
const key = process.env.LLM_API_KEY;
const base = process.env.LLM_BASE_URL;
const model = process.env.LLM_MODEL;

const PROMPT = `A payment failed and the error fields are ambiguous. Determine the root cause.
error_reason: payment_cancelled
error_source: customer
error_step: payment_authentication
error_description: PSP did not acknowledge in time.
Subscription state: pending
Choose one: insufficient_funds|bank_outage|psp_down|mandate_revoked|instrument_expired|customer_cancelled|upi_hang|auth_failed|unknown
Return JSON: {"cause":"...","narrative":"...","confidence":0.0-1.0}`;

async function one(i) {
  const t0 = Date.now();
  const res = await fetch(`${base}/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
    body: JSON.stringify({
      model, temperature: 0, max_tokens: 300,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: "You diagnose Indian payment failures. Return only JSON." },
        { role: "user", content: PROMPT },
      ],
    }),
  });
  const ms = Date.now() - t0;
  if (res.status !== 200) {
    const body = await res.text();
    const hint = body.match(/try again in ([\d.]+)s/i);
    return { i, status: res.status, ms, hint: hint ? hint[1] + "s" : body.slice(0, 120) };
  }
  const d = await res.json();
  return { i, status: 200, ms, usage: d.usage?.total_tokens };
}

const gap = Number(process.argv[2] ?? 0);
console.log(`model=${model} gap=${gap}ms\n`);

let ok = 0, limited = 0, tokens = 0;
for (let i = 1; i <= 20; i++) {
  const r = await one(i);
  if (r.status === 200) { ok++; tokens += r.usage ?? 0; }
  else limited++;
  console.log(`  #${String(i).padStart(2)} status=${r.status} ${r.ms}ms ` +
    (r.status === 200 ? `tokens=${r.usage}` : `RETRY-AFTER=${r.hint}`));
  if (gap) await new Promise(res => setTimeout(res, gap));
}
console.log(`\n  ok=${ok} rate_limited=${limited} avg_tokens=${ok ? Math.round(tokens / ok) : 0}`);
