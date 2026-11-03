# Architecture — Triage Recovery Agent

## Overview

Triage is a **fiduciary agent** for Indian Autopay failures. It closes the loop from a failed Razorpay webhook to a measured recovery outcome, with a full audit trail and hard stopping rules.

The core claim: **recovery is a diagnosis problem, not a messaging problem.** Retrying the wrong cause fails. Contacting a DND customer is illegal. Retrying a revoked mandate is fraudulent. Triage prevents all three.

It does **not** claim to recover more rupees than spam. On the 168-case batch, Naive recovers more gross and more bankable rupees. Triage's result is 0 rule breaks, fewer touches, and money a merchant can actually book. That is the shippable product.

---

## Data flow

```
                    ┌─────────────────────────────────┐
                    │          INGEST                 │
                    │  batch.json (eval) or           │
                    │  Razorpay webhook (live)        │
                    └──────────────┬──────────────────┘
                                   │
                                   ▼
                    ┌─────────────────────────────────┐
                    │        CASE STORE               │
                    │  SQLite · cases table           │
                    └──────────────┬──────────────────┘
                                   │
                    ┌──────────────▼──────────────────┐
                    │     CAUSE TAXONOMY              │
                    │  src/engine/taxonomy.ts         │
                    │  Razorpay error fields → cause  │
                    │                                 │
                    │  If needsInterpretation():      │
                    │  LLM, 12s timeout × 2 attempts  │
                    │  queued; 429 backoff            │
                    │  fallback → taxonomy holds      │
                    └──────────────┬──────────────────┘
                                   │
                    ┌──────────────▼──────────────────┐
                    │       POLICY GRAPH              │
                    │  src/engine/policy.ts           │
                    │  cause × stepIndex → action     │
                    │  ONLY place action is selected. │
                    └──────────────┬──────────────────┘
                                   │
                    ┌──────────────▼──────────────────┐
                    │        STOP RULES               │
                    │  src/engine/stops.ts            │
                    │  ONLY place action can be       │
                    │  vetoed. Policy wins over LLM.  │
                    └──────────────┬──────────────────┘
                                   │
                        ┌──────────┴──────────┐
                        │ blocked?            │ not blocked?
                        ▼                     ▼
                 ┌─────────────┐    ┌──────────────────────┐
                 │ Audit log   │    │      EXECUTOR        │
                 │             │    │  Eval: simulator     │
                 │             │    │  Live: first action  │
                 │             │    │  + paymentLink.create│
                 │             │    │  or Checkout.js order│
                 └─────────────┘    └──────────┬───────────┘
                                               │
                                    ┌──────────▼───────────┐
                                    │   AUDIT + LEDGER     │
                                    │  actor, event, flags │
                                    │  llm_fallback,       │
                                    │  policy_override     │
                                    └──────────────────────┘
```

---

## Why policy > LLM for money moves

LLMs are non-deterministic, can be unavailable, and have no concept of NPCI retry caps or TRAI DND. A fiduciary agent must be verifiable.

Enforced structurally:
- `policy.ts` is the only function that returns a `RecoveryAction`
- `stops.ts` is the only function that can block it
- The LLM receives no tool-calling surface that touches payments
- If the LLM is down, `llm_fallback: true` is logged and taxonomy-only result is used. The campaign still runs.

---

## Eval methodology

The simulator is **cause-faithful**, not random. Both arms see the **same 168 cases**, the same 10% holdout, and the same success tables. Naive runs a fixed six-step cadence (silent retry, then links, then voice) with **no diagnosis and no stop rules**.

Illegal recovery is attributed only to the **step that broke a rule**. A later legal payment link on a tainted campaign still counts as bankable. That is the honest accounting — and it is why Naive still wins rupees. We do not cook P(recover) to invert that.

Checkout (`segment: checkout`) and B2B invoice (`segment: b2b_invoice`) rows exist so the batch is not 100% subscriptions. Policy does **not** branch on `segment` or `agingDays`. They are dataset mix, not product lanes.

`npm run eval` writes `data/last-eval.json`. The ledger API serves the latest SQLite batch run, and falls back to that file so the homepage is never empty.

---

## Graceful failure (LLM down)

When `LLM_API_KEY` is missing, the provider returns 4xx/429, or the call exceeds 12s:

1. `llmClient.ts` returns `failed: true` (no throw)
2. `llm.ts` returns `fallback: true` with a reason
3. `agent.ts` keeps the taxonomy cause, logs `llm_fallback`
4. Policy and stops still select / veto the action
5. Eval completes. Scoreboard shows `LLM fallbacks: N`

The agent never 500s because a model is down. Taxonomy-only is a working product, not a degraded demo.

---

## Live Razorpay path (test mode) — single-shot

This is **not** the 30-day sequencer. Live ingest runs `runAgent()` once: diagnose + first action + optional Payment Link.

1. `payment.failed` / `subscription.pending` webhook, or `POST /api/demo/trigger`
2. `ingestFailedPayment` opens a case file
3. `kickLiveCase` runs the agent; if the action is a link, `paymentLink.create()` with `notes.case_id`
4. Case file: Checkout.js (`POST /api/live/order` → test card → `POST /api/live/confirm` verifies HMAC) **or** pay the Payment Link
5. `payment_link.paid` / `payment.captured` webhook, or confirmed signature, calls `markCaseRecovered`
6. Audit actor is `webhook`. The LLM is not in this path.
7. If `paymentLink.create()` throws: `executor_failure` is logged, `escalated: true` — the case stays open for a human

Webhook HMAC is verified. Checkout confirm verifies `order_id|payment_id`. Recovered writes are idempotent.

---

## File map

```
src/
  engine/
    taxonomy.ts      — Razorpay error fields → FailureCause
    policy.ts        — cause × step → RecoveryAction
    stops.ts         — ordered veto rules
    agent.ts         — diagnose → policy → stops (single-shot)
    sequencer.ts     — 30-day campaign runner (eval only)
    naive.ts         — fixed-cadence baseline
    economics.ts / holdout.ts / rng.ts

  adapters/
    simulator.ts     — cause-faithful eval outcomes
    razorpay.ts      — Payment Links + webhook HMAC
    ingest.ts        — live payment.failed → case + first action
    conversation.ts  — simulated Hinglish replies + intent extraction
    llm.ts / llmClient.ts

  eval/
    run.ts           — CLI (npm run eval) → data/last-eval.json
    persist.ts       — batch → SQLite for the UI
    job.ts           — background job for POST /api/eval
    compliance.ts    — 15 property assertions

  app/
    page.tsx              — Ledger: Naive ₹ first, then violations
    cases/                — Registry + case file + vs-rail
    api/demo/trigger      — POST live-style ingest (mandate_revoked | funds)
    api/live/             — Payment Link, Order, signature confirm
    api/webhooks/razorpay/
```
