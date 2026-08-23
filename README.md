# Triage — Revenue Recovery Agent

> **Razorpay AI Buildathon 2026 · Track 03: AI Revenue Recovery**

Triage is a bounded AI agent that recovers failed Indian Autopay and subscription revenue. It diagnoses *why* a payment failed before deciding *how* to recover — then proves the approach on a 168-case batch with holdout-measured lift, unit economics, and a full audit trail.

---

## The thesis

Razorpay already retries. The unsolved problem is **which intervention the failure earned**, under a retry cap.

The same `payment.failed` event is four different diseases:

| Cause | Right move | Naive (wrong) |
|---|---|---|
| `insufficient_funds` | Silent retry after salary window | Retry now on empty account |
| `bank_outage` | **Do nothing** | Sends a payment link during a live outage |
| `mandate_revoked` | One-time Payment Link | Retries the dead mandate (illegal) |
| `customer_cancelled` | Do nothing | Spam dunning blast |

Naive dunning often recovers more **gross** rupees by messaging everyone. Triage wins on **compliance**, **net bankable recovery**, and **incremental lift** measured against a holdout that is never contacted.

---

## Quick start

```bash
npm install
cp .env.example .env   # RAZORPAY_*, LLM_API_KEY, RAZORPAY_WEBHOOK_SECRET

# Batch eval (CLI, ~10 min with LLM)
npm run eval

# Compliance property checks (must pass before shipping policy changes)
npm run compliance

# Control tower UI
npm run dev
# http://localhost:3000 → Run batch eval (runs in background, polls until done)
```

**Live demo:** POST `/api/live` from a case file to create a Razorpay Payment Link. Point webhooks at `/api/webhooks/razorpay` (ngrok in dev). `payment.failed` and `subscription.pending` events auto-open case files.

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
  30-day Campaign         ← cause-conditioned ladder + Hinglish reply loop
  Sequencer               ← holdout arm never contacted
        │
        ▼
  Simulator (eval) / Razorpay Payment Links (live)
        │
        ▼
  Control Tower           ← ledger, case files, campaign timeline, audit trail
```

**Core rule:** LLM writes diagnosis copy, Hinglish outreach, and promise-to-pay extraction. **It never selects an action or fires a contact.** Policy selects; stop rules veto.

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for the full data flow.

---

## Scripts

| Command | Purpose |
|---|---|
| `npm run eval` | Run 168-case batch through Triage + naive; print economics, lift, compliance |
| `npm run compliance` | Assert 15 compliance invariants across every campaign |
| `npm run dev` | Control tower UI + API |
| `npm run build` | Production build |

---

## Stack

- **Next.js App Router + TypeScript**
- **SQLite + Drizzle** — cases, campaign steps, audit log, batch runs
- **Razorpay Node SDK** — Payment Links, webhook HMAC, live failure ingest
- **OpenAI-compatible LLM** (Groq tested) — diagnosis + Hinglish copy + intent extraction
- **Deterministic simulator** — cause-faithful outcomes for reproducible eval

---

## Pitch in one sentence

> Razorpay already retries. Triage decides *which* intervention the failure earned, runs a bounded 30-day campaign under hard stop rules, and proves incremental lift on a holdout with an audit trail.
