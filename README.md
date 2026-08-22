# Triage — Revenue Recovery Agent

> **Razorpay AI Buildathon 2026 · Track 03: AI Revenue Recovery**

Triage is a bounded AI agent that recovers failed Indian Autopay and subscription revenue. It diagnoses *why* a payment failed before deciding *how* to recover — and proves the approach on a 100-case batch with a full audit trail.

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

Triage recovers **89.7%** of at-risk rupees vs **19.9%** for naive, with zero illegal retries and zero DND violations on the same 100 cases.

---

## Quick start

```bash
# 1. Clone and install
npm install

# 2. Configure keys
cp .env.example .env
# Fill in RAZORPAY_KEY_ID, RAZORPAY_KEY_SECRET, LLM_API_KEY

# 3. Run the batch eval (no server needed)
npm run eval

# 4. Start the control tower UI
npm run dev
# Open http://localhost:3000, click "Run Batch Eval"
```

---

## Architecture

```
Webhook / batch.json
        │
        ▼
  Case Store (SQLite)
        │
        ▼
  Cause Taxonomy          ← deterministic, maps Razorpay error fields to cause
  + LLM only if "unknown" ← 8s timeout → fallback; audit logs llm_fallback
        │
        ▼
  Policy Graph            ← cause × subscription_state × retry_count → action
  (src/engine/policy.ts)  ← ONLY place an action is selected
        │
        ▼
  Stop Rules              ← NPCI cap, DND, outage, PTP, mandate revoked, etc.
  (src/engine/stops.ts)   ← ONLY place action can be vetoed. Policy wins over LLM.
        │
   blocked?
  ┌─────┴──────┐
  │ yes        │ no
  ▼            ▼
Audit log   Executor ──► Simulator (eval) / Razorpay Payment Links (live)
                │
                ▼
           Audit log + Case outcome
                │
                ▼
        Control Tower (Next.js)
        Scoreboard · Case list · Audit timeline
```

**Core rule:** LLM writes diagnosis copy, Hinglish outreach, and promise-to-pay extraction. **It never fires a payment or a contact.** Policy selects; stop rules veto. If they disagree, policy wins.

---

## Closed action catalog

| Action | When |
|---|---|
| `silent_retry_at_window` | Insufficient funds, salary window inferred |
| `send_one_time_payment_link` | Mandate revoked, UPI hang, auth failed |
| `send_method_update_link` | Expired instrument, need new mandate |
| `offer_pause` | High-value voluntary cancellation |
| `hinglish_voice_script` | High-value (₹500+), consented, retries exhausted |
| `escalate_human` | Unknown cause, low confidence, complex cases |
| `do_nothing` | Bank outage, voluntary cancellation, PTP pending |

---

## Stop rules

1. Already paid
2. NPCI retry cap (1 original + 3)
3. Mandate revoked — blocks Autopay retry
4. Bank/PSP outage active — blocks all outreach
5. DND opted-out — blocks all contact actions
6. No consent — blocks voice
7. Promise-to-pay date in future — wait
8. Max 3 touches reached
9. Amount below ₹10 floor
10. LLM confidence < 0.4 → escalate human

---

## Eval output

```
npm run eval
```

Prints a comparison table + JSON. On a 100-case batch:

```
│ Amount recovered  │ ₹3,53,422     │ ₹78,564           │
│ Recovery rate     │ 89.7%         │ 19.9%             │
│ Illegal retries   │ 0             │ 15                │
│ DND violations    │ 0             │ 8                 │
│ Triage advantage: ₹2,74,858 more recovered            │
```

---

## Stack

- **Next.js 15 App Router + TypeScript** — one repo for agent, eval, UI, and API
- **SQLite + Drizzle** — case store, audit ledger, batch run tracking
- **Razorpay Node SDK** — Payment Links (test mode), webhook HMAC verification
- **OpenAI-compatible LLM** — diagnosis + Hinglish copy; fallback if unavailable
- **Simulator** — cause-faithful success/fail model for reproducible eval

---

## Git history

```
v0.1-eval-baseline  — dataset, taxonomy, policy, stops, simulator, eval harness
v0.2-agent-loop     — agent loop with DB persistence and audit ledger
v0.3-control-tower  — scoreboard, case list, case detail, live Payment Links
v1.0-submit         — final polish, architecture doc, pitch artifacts
```

---

## Pitch in one sentence

> Razorpay already retries. Triage decides *which* intervention the failure earned, under a retry cap, and proves it on a 100-case batch with an audit trail.
