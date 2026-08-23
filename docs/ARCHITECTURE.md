# Architecture — Triage Recovery Agent

## Overview

Triage is a **fiduciary agent** for Indian subscription payments. It closes the loop from a failed Razorpay webhook to a measured recovery outcome, with a full audit trail and hard stopping rules.

The core claim: **recovery is a diagnosis problem, not a messaging problem.** Retrying the wrong cause fails. Contacting a DND customer is illegal. Retrying a revoked mandate is fraudulent. Triage prevents all three — and proves it numerically.

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
                    │  Fields: error_reason,          │
                    │  subscription_state, retry_count│
                    │  isDnd, promiseToPay, etc.      │
                    └──────────────┬──────────────────┘
                                   │
                    ┌──────────────▼──────────────────┐
                    │     CAUSE TAXONOMY              │
                    │  src/engine/taxonomy.ts         │
                    │  Maps Razorpay error fields →   │
                    │  FailureCause (deterministic)   │
                    │                                 │
                    │  If cause === "unknown":         │
                    │  ┌───────────────────────────┐  │
                    │  │ LLM (OpenAI-compatible)   │  │
                    │  │ 8s timeout → fallback     │  │
                    │  │ Returns JSON: cause +     │  │
                    │  │ narrative + confidence    │  │
                    │  └───────────────────────────┘  │
                    └──────────────┬──────────────────┘
                                   │
                    ┌──────────────▼──────────────────┐
                    │       POLICY GRAPH              │
                    │  src/engine/policy.ts           │
                    │  cause × state × retryCount →  │
                    │  RecoveryAction (closed set)    │
                    │                                 │
                    │  ONLY place action is selected. │
                    │  LLM suggestion is ignored.     │
                    └──────────────┬──────────────────┘
                                   │
                    ┌──────────────▼──────────────────┐
                    │        STOP RULES               │
                    │  src/engine/stops.ts            │
                    │  Ordered vetoes:                │
                    │  already_paid | npci_cap |      │
                    │  mandate_revoked | dnd |        │
                    │  bank_outage | ptp_pending |    │
                    │  max_touches | amount_floor |   │
                    │  low_confidence                 │
                    │                                 │
                    │  ONLY place action can be       │
                    │  vetoed. Policy wins over LLM.  │
                    └──────────────┬──────────────────┘
                                   │
                        ┌──────────┴──────────┐
                        │ blocked?            │ not blocked?
                        ▼                     ▼
                 ┌─────────────┐    ┌──────────────────────┐
                 │ Audit log   │    │      EXECUTOR        │
                 │ stop_code   │    │                      │
                 │ Case:stopped│    │  Simulator (eval):   │
                 └─────────────┘    │  cause-faithful      │
                                    │  success probability │
                                    │                      │
                                    │  Razorpay (live):    │
                                    │  paymentLink.create  │
                                    │  HMAC webhook verify │
                                    └──────────┬───────────┘
                                               │
                                    ┌──────────▼───────────┐
                                    │    AUDIT LEDGER      │
                                    │  Every action logged │
                                    │  with actor + event  │
                                    │  + detail + flags    │
                                    │  (llm_fallback,      │
                                    │   policy_override)   │
                                    └──────────┬───────────┘
                                               │
                                    ┌──────────▼───────────┐
                                    │   CONTROL TOWER      │
                                    │  Next.js App Router  │
                                    │                      │
                                    │  / — Scoreboard      │
                                    │  Triage vs Naive:    │
                                    │  ₹ recovered, stops, │
                                    │  illegal retries,    │
                                    │  DND violations      │
                                    │                      │
                                    │  /cases — Case list  │
                                    │  /cases/[id] —       │
                                    │  Full audit timeline │
                                    └──────────────────────┘
```

---

## Why policy > LLM for money moves

LLMs are non-deterministic, can be unavailable, and have no concept of regulatory caps.  
A "fiduciary" agent must be verifiable — every money action must have a machine-readable reason.

The architecture enforces this structurally:
- `policy.ts` is the only function that returns a `RecoveryAction`
- `stops.ts` is the only function that can block it
- The LLM receives no tool-calling surface that touches payments
- If the LLM is down, `llm_fallback: true` is logged and taxonomy-only result is used

This is the "AI judgment + bounded money actions" property the panel evaluates.

---

## Eval methodology

The simulator is **cause-faithful**, not random:

| Cause | Action | Simulated success rate |
|---|---|---|
| `insufficient_funds` + `silent_retry_at_window` | 65–80% (salary boost) |
| `bank_outage` + `do_nothing` | 80% (outage clears) |
| `bank_outage` + any contact | 0% (outage still active) |
| `mandate_revoked` + `silent_retry_at_window` | 0% (always illegal) |
| `mandate_revoked` + `send_one_time_payment_link` | 45% |
| `customer_cancelled` + `do_nothing` | 0% (correct; no recovery attempted) |

The eval runs both Triage and Naive on the **same 100 cases** with the same simulator. The naive baseline always picks `silent_retry_at_window` (like a blunt cron job). The counterfactual shows the diagnosis advantage, not just a cherry-picked lucky run.

---

## Graceful failure story

When the LLM API key is missing or the call times out (8s):

1. `llm.ts` returns `fallback: true`
2. `agent.ts` uses taxonomy-only cause (usually sufficient)
3. Audit log records `llm_fallback` flag on the relevant entry
4. `npm run eval` still completes with `"llmFallbacks": N`
5. The scoreboard shows `LLM fallbacks: N` in the Triage column

The agent degrades gracefully — it never returns a 500 error, and taxonomy-only still beats naive.

---

## Live Razorpay path (test mode)

1. Set `RAZORPAY_KEY_ID` and `RAZORPAY_KEY_SECRET` (test mode keys from Razorpay Dashboard)
2. Set `RAZORPAY_WEBHOOK_SECRET` and configure webhook URL in Dashboard
3. Open any Triage case in the UI → click "Create Payment Link"
4. `POST /api/live` calls `razorpay.paymentLink.create()`
5. Real `rzp_test_` URL is returned and stored on the case
6. Paying on the test link fires `payment_link.paid` webhook → case marked `recovered`
7. If `paymentLink.create()` throws (wrong keys, network error), the error is caught, logged as `executor_failure`, and the response includes `escalated: true` — the graceful fallback

---

## File map

```
src/
  engine/
    taxonomy.ts      — Razorpay error fields → FailureCause
    policy.ts        — cause × state × retry → RecoveryAction
    stops.ts         — ordered veto rules
    agent.ts         — diagnose → policy → stops → audit
    sequencer.ts     — 30-day campaign runner + reply loop
    naive.ts         — spam baseline for comparison
    economics.ts     — net recovery, ROI, cost per rupee
    holdout.ts       — incremental lift vs never-contacted arm
    rng.ts           — deterministic seeded simulator

  adapters/
    simulator.ts     — cause-faithful success/fail for eval
    razorpay.ts      — Payment Links + webhook HMAC
    ingest.ts        — live payment.failed → open case file
    conversation.ts  — Hinglish inbound replies + intent extraction
    llm.ts           — structured LLM output + copy generation
    llmClient.ts     — shared LLM client with retry

  db/
    schema.ts        — cases, campaign_steps, audit_log, batch_runs
    client.ts        — Drizzle + SQLite
    migrate.ts       — schema bootstrap + column migrations

  eval/
    run.ts           — CLI eval (npm run eval)
    persist.ts       — batch eval → DB for UI
    job.ts           — background eval job for /api/eval
    compliance.ts    — 15 property assertions (npm run compliance)

  components/
    Nav.tsx, CampaignTimeline.tsx, VoicePlayer.tsx

  app/
    page.tsx              — Ledger / scoreboard
    cases/                — Case registry + case file detail
    api/eval/             — POST start batch, GET job status
    api/batch/            — GET batch run summaries
    api/cases/            — GET cases list + detail
    api/live/             — POST create Payment Link
    api/webhooks/razorpay/ — POST ingest + recovery webhooks

data/
  batch.json   — 168 synthetic cases (subscription, checkout, B2B invoice)
```
