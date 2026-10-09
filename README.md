# Triage — Revenue Recovery Agent

> **Razorpay AI Buildathon 2026 · Track 03: AI Revenue Recovery**

Triage is a bounded recovery agent for Indian Autopay failures. It diagnoses *why* a payment failed, picks the intervention that failure earned, and refuses the interventions a listed company is not allowed to run.

Naive dunning recovers more rupees on this batch. Triage recovers less, touches fewer customers, and breaks zero rules. A merchant can book every rupee. Razorpay can ship it.

```bash
npm install
cp .env.example .env          # RAZORPAY_*, LLM_API_KEY, RAZORPAY_WEBHOOK_SECRET

npm run compliance            # 15 invariants — must pass
npm run eval                  # 168-case batch; writes data/last-eval.json
npm run build && npm start    # record the pitch against this, not `next dev`
npm run dev                   # http://localhost:3000 (dev only)
```

---

## The thesis (honest)

Razorpay already retries. The unsolved problem is **which intervention the failure earned**, under a retry cap — and which interventions you are not allowed to run.

The same `payment.failed` event is four different diseases:

| Cause | Right move | Naive (wrong) |
|---|---|---|
| `insufficient_funds` | Silent retry after salary window | Retry now on an empty account |
| `bank_outage` | **Do nothing** | Payment link during a live outage |
| `mandate_revoked` | One-time Payment Link | Silent-retry a dead mandate (**illegal**) |
| `customer_cancelled` | Do nothing | Spam dunning blast |

On the 168-case batch, Naive recovers more **gross and bankable** rupees by messaging everyone. The illegal slice of that recovery is small (a later legal link still counts). What is not small is **157 rule breaks** — DND, opt-outs, dead-mandate retries, contacts during outage. Triage: **0**.

Triage is not a money-maxing bot. It is a fiduciary decision engine. TRAI, NPCI, and merchant deboarding care about the 157, not the extra lakhs from spam.

---

## What this is / is not

**Is:** cause taxonomy over real Razorpay error fields → policy graph (only place an action is selected) → stop rules (only place an action is vetoed) → 30-day campaign in eval, single-shot live path → audit trail. LLM writes diagnosis copy, Hinglish outreach, and intent extraction. **It never selects an action or moves money.**

**Is not:** a WhatsApp/SMS/voice sender. Eval outreach is simulated. Live execution creates a Razorpay Payment Link or Checkout.js order and closes the case on `payment.captured` / signature verify. Checkout and B2B invoice rows in `data/batch.json` are **dataset mix**, not separate product lanes — policy does not branch on `segment` or `agingDays`.

---

## Scripts

| Command | Purpose |
|---|---|
| `npm run compliance` | 15 property checks over every campaign. Run this first. |
| `npm run eval` | 168 cases through Triage + Naive. Prints economics, lift, compliance. Writes `data/last-eval.json`. |
| `npm run dev` | Control tower. Ledger falls back to `last-eval.json` if no DB run exists. |
| `npm run build` | Production build |

**Live demo (test mode):** `POST /api/demo/trigger` with `{ "scenario": "mandate_revoked" }` opens a case, runs the agent, and creates a Payment Link when policy asks for one. Pay with Checkout.js (test card). Webhook / signature verify marks the case recovered. Tunnel with ngrok and set `APP_BASE_URL` — see [docs/DEMO.md](docs/DEMO.md). Pitch script: [docs/PITCH.md](docs/PITCH.md).

---

## Architecture

```
Webhook / batch.json
        │
        ▼
  Case Store (SQLite)
        │
        ▼
  Cause Taxonomy          ← deterministic; LLM only when ambiguous
        │
        ▼
  Policy Graph            ← ONLY place an action is selected
        │
        ▼
  Stop Rules              ← ONLY place action can be vetoed
        │
        ▼
  Eval: 30-day sequencer  ← cause-conditioned ladder + simulated Hinglish replies
  Live: single-shot       ← first action + Payment Link / Checkout.js
        │
        ▼
  Simulator (eval) / Razorpay test-mode (live)
        │
        ▼
  Control Tower           ← ledger (Naive ₹ first), case files, vs-rail, audit
```

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

---

## Stack

- Next.js App Router + TypeScript
- SQLite + Drizzle — cases, campaign steps, audit log, batch runs
- Razorpay Node SDK — Payment Links, Orders, webhook HMAC
- OpenAI-compatible LLM (Groq `groq/compound-mini` tested) — diagnosis + copy + intent, never money
- Deterministic simulator — cause-faithful outcomes for reproducible eval

---

## Pitch in one sentence

> Razorpay already retries. Triage decides which intervention a failure earned, refuses the illegal ones, and proves the tradeoff on a holdout: Naive wins rupees, Triage is the one you can ship.
