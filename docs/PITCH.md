# 5-minute pitch — say this, don't decorate it

Talk like a builder. No "synergies." Screen is the product.

Record with `npm run build && npm start` — see [docs/DEMO.md](DEMO.md). Do not film `next dev`.

## 0:00–0:40 — Same event, four diseases

Open the ledger.

"Razorpay already retries. The unsolved problem is which intervention a `payment.failed` earned — and which ones you are not allowed to run.

Insufficient funds wants a silent retry after salary day. A bank outage wants silence. A cancelled customer wants nothing. A revoked mandate wants a one-time Payment Link. Naive silent-retries the dead mandate. That is illegal."

Click **Live: mandate revoked**.

## 0:40–1:40 — Live money loop

Case file opens. Cause: mandate revoked. Action: one-time Payment Link. Stop rules clear.

Prefer **Or pay via Payment Link** on camera. Checkout.js **Pay now** only if the modal opens in one take.

"Confirm path — actor is webhook, not the model — marks recovered. Signature verified. Idempotent if it fires twice.

This is single-shot live. The 30-day ladder is eval-only. I am not pretending a serverless box runs a month of dunning."

## 1:40–3:00 — Ledger, honest

Back to `/`.

"Naive recovered more. Read the first number. Then 157 violations. Then Triage recovered less, with zero violations.

Illegal rupees on the violating step are a few thousand. A later legal link still counts. I did not cook the simulator so Triage 'wins' money. Spam works. Razorpay cannot ship spam.

Holdout: 18 cases never contacted. Lift is directional, not a significance claim.

`npm run compliance` — 15 invariants. I will run it."

Switch to terminal, run `npm run compliance`. It passes.

## 3:00–4:10 — Architecture + failure

"Three modules. Taxonomy reads Razorpay error fields. Policy is the only function that returns an action. Stops are the only function that can veto it. The LLM writes copy and reads Hinglish replies. It has no payment tools.

When Groq 400s or 429s, we log `llm_fallback` and hold the taxonomy verdict. The campaign still runs."

Open a taxonomy-only case (ledger → Open taxonomy-only cases, or a fallback badge). Show the audit flag.

Same case vs-rail: Triage Payment Link vs Naive silent retry.

## 4:10–5:00 — Week one at Razorpay

"What I did not build, on purpose: WhatsApp Business, Exotel, checkout funnels, AR aging. Those are labels in the batch, not product lanes.

Week one I would wire mandate status from the Subscriptions API, a TRAI clock on DND, and a real WhatsApp sender behind the same policy and stops. The decision engine does not change. The executor does."

Stop talking.
