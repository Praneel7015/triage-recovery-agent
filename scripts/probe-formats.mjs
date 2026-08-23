import "dotenv/config";

const key = process.env.LLM_API_KEY;
const base = process.env.LLM_BASE_URL;

const PROMPT = `A payment failed and the error fields are ambiguous.
error_reason: payment_cancelled
error_source: customer
error_description: PSP did not acknowledge in time.
Subscription state: pending
Choose one cause: insufficient_funds|bank_outage|psp_down|mandate_revoked|instrument_expired|customer_cancelled|upi_hang|auth_failed|unknown
Return JSON: {"cause":"...","narrative":"...","confidence":0.0-1.0}`;

const SCHEMA = {
  type: "json_schema",
  json_schema: {
    name: "diagnosis",
    strict: true,
    schema: {
      type: "object",
      properties: {
        cause: { type: "string" },
        narrative: { type: "string" },
        confidence: { type: "number" },
      },
      required: ["cause", "narrative", "confidence"],
      additionalProperties: false,
    },
  },
};

async function attempt(model, label, extra) {
  try {
    const res = await fetch(`${base}/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
      body: JSON.stringify({
        model, temperature: 0, max_tokens: 500,
        messages: [
          { role: "system", content: "You diagnose Indian payment failures." },
          { role: "user", content: PROMPT },
        ],
        ...extra,
      }),
    });
    const d = await res.json();
    if (res.status !== 200) {
      console.log(`  ${model.padEnd(22)} ${label.padEnd(14)} HTTP ${res.status}  ${JSON.stringify(d.error?.message ?? d).slice(0, 90)}`);
      return;
    }
    const c = d.choices[0].message.content ?? "";
    console.log(`  ${model.padEnd(22)} ${label.padEnd(14)} OK  tok=${d.usage?.total_tokens}  ${JSON.stringify(c).slice(0, 110)}`);
  } catch (e) {
    console.log(`  ${model.padEnd(22)} ${label.padEnd(14)} ERR ${e.message}`);
  }
}

for (const model of ["openai/gpt-oss-20b", "openai/gpt-oss-120b", "qwen/qwen3.6-27b", "groq/compound-mini"]) {
  await attempt(model, "no format", {});
  await attempt(model, "json_object", { response_format: { type: "json_object" } });
  await attempt(model, "json_schema", { response_format: SCHEMA });
  console.log("");
}
