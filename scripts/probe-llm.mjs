import "dotenv/config";

const key   = process.env.LLM_API_KEY;
const base  = process.env.LLM_BASE_URL;
const model = process.env.LLM_MODEL;

async function probe(label, body) {
  try {
    const res = await fetch(`${base}/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    if (data.choices) {
      console.log(`${label}: OK -> ${JSON.stringify(data.choices[0].message.content).slice(0, 160)}`);
      return true;
    }
    console.log(`${label}: FAILED -> ${JSON.stringify(data.error ?? data).slice(0, 300)}`);
    return false;
  } catch (e) {
    console.log(`${label}: ERROR -> ${e.message}`);
    return false;
  }
}

console.log(`model=${model} base=${base}\n`);

await probe("plain", {
  model, temperature: 0,
  messages: [{ role: "user", content: 'Return only this JSON: {"a":1}' }],
});

await probe("json_object", {
  model, temperature: 0,
  response_format: { type: "json_object" },
  messages: [{ role: "user", content: 'Return only this JSON: {"a":1}' }],
});

await probe("system+json", {
  model, temperature: 0,
  response_format: { type: "json_object" },
  messages: [
    { role: "system", content: "You return only valid JSON." },
    { role: "user", content: 'Classify intent of "kal kar dunga". Return {"intent":"promise_to_pay","confidence":0.9}' },
  ],
});
