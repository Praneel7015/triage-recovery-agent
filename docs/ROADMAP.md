# Roadmap

Written 3 Nov 2026 after an audit of `feat/razorpay-adapters-eval-ui-docs` (PR #1, commit `8d5e2e3`).

Sizes: **XS** < 1h · **S** half a day · **M** 1–2 days · **L** most of a week.

## Where things stand

| Check | Result |
|---|---|
| `tsc --noEmit` | passes |
| `next build` | passes (13 routes) |
| `npm run compliance` | 15/15 properties hold over 168 campaigns |
| `npm run eval` (no keys) | runs; Triage 78/150 recovered, 29.8 pp lift, 0 violations; Naive 90/150, 37.8 pp, 157 violations |
| `eslint` | **fails**: 49 errors, 8 warnings (45× `no-explicit-any`, 4× `react-hooks/set-state-in-effect`) |
| Unit tests | none |
| CI | none |

`npm run eval` needs no keys. Without `LLM_API_KEY` the agent falls back to taxonomy-only diagnosis and the headline numbers are unchanged.

## P0: before anything else

### 1. Stop forged requests from marking cases recovered (S)
Two paths can mark a case `recovered` (and write a `payment_received` audit row) for a case that was never paid:
- `GET /api/webhooks/razorpay` checks the Payment Link signature, then marks the case named by the **unsigned** `case_id` query param. One genuine paid callback, replayed with a different `case_id`, closes any case.
- `POST /api/live/confirm` checks the Checkout signature over `order_id|payment_id`, but never checks that the order belongs to `caseId`. One genuine Checkout payment closes any case.

The audit trail is the core of the product, so this comes first. The fix: resolve the case only from signed data (link id / reference id, or the order's `notes.case_id`) and add a test harness with regression tests.

### 2. Get lint green and add CI (S)
49 lint errors means `next lint`-gated deploys fail and new bugs hide in the noise. Type the Razorpay SDK responses and the Drizzle enum casts. Replace the `setState`-in-effect patterns. Then add a GitHub Actions workflow that runs lint, `tsc`, tests, `compliance` and a keyless `eval`.

### 3. Re-baseline the published numbers (XS, needs Praneel's decision)
The resume and pitch quote **+32-pt lift** and **64% fewer messages**. Those came from the 23 Aug eval (82/150 recovered, 32.4 pp). The code on PR #1 gives **29.8 pp** and **146 vs 426 touches (66% fewer)**, both with and without an LLM key. The committed `data/last-eval.json` (1 Sep) already shows 29.8 pp. Either re-run with the tested Groq config and commit the result, or update the quoted figures. Don't tune the simulator to recover the old number.

### 4. Land PR #1 and tidy `main` (XS)
PR #1 is mergeable and is strictly better than `origin/main`: it has the signature-length fix, the Payment Link HMAC fix, and the 168-case docs. Local `main` already points at the PR #1 commit and is "ahead 1" only because of that, so after merging, reset local `main` to `origin/main`.

## P1: needed for a real deploy

### 5. Auth on the control tower and mutating routes (M)
Every route is public. `POST /api/eval` starts a ~10-minute LLM job. `POST /api/demo/trigger` creates real (test-mode) Payment Links. `GET /api/cases` returns customer names, phones and emails. Add login for the UI (or a basic-auth gate as a first step), and keep only the webhook public.

### 6. Persistence that survives a deploy (M–L)
SQLite on local disk is fine on a VM with a volume (Fly.io, Railway) but is lost on serverless hosts. `migrate()` runs at import time in every route module. Pick a host first. Then either keep SQLite on a volume or move to Turso or Postgres via Drizzle, and switch to `drizzle-kit` migrations.

### 7. Webhook hardening (M)
- Deduplicate on `x-razorpay-event-id`. Razorpay retries, and only `markCaseRecovered` is idempotent today.
- `kickLiveCase` is fire-and-forget (`void`). On serverless it can be killed after the response is sent, so it needs a durable job.
- `payment.failed` with an unknown `notes.case_id` writes an orphan audit row (there are no foreign-key constraints). Check that the case exists first.
- `partially_paid` and any `payment.captured` mark the full amount recovered. Check the amount.
- Make the GET Payment Link callback display-only and let the signed POST `payment_link.paid` be the source of truth.

### 8. Unit tests for the decision core (S–M)
- Taxonomy: classification and confidence/conflict signals, for example `payment_cancelled` with an active mandate gives "conflicting" at 0.5.
- Stop-rule ordering: first match wins, and `already_paid` outranks `uneconomic`.
- Policy ladder rungs per cause.
- Signature helpers: wrong-length and missing-parameter cases.

These protect the "policy graph, not the LLM, picks the action" claim.

### 9. Eval rigour and labelling (M)
- The holdout is 18 cases, and `sufficientSample` accepts any holdout of 10 or more, so the eval prints "Sample supports a causal claim" on 18. Raise the threshold or report a confidence interval, and consider a larger batch.
- Simulator success rates (`adapters/simulator.ts`), natural-recovery rates (`engine/holdout.ts`) and channel costs (`engine/economics.ts`) are hand-set. Label them as assumptions in the UI and README.
- Add a risk-adjusted net metric that prices DND, opt-out and NPCI violations, rather than leaving them as a separate column.
- Compliance property P6 reads `Date.now()`, so its result depends on the day it runs. Pin the eval clock.

## P2: product depth and hygiene

| # | Item | Why | Size |
|---|---|---|---|
| 10 | Real outreach channels (WhatsApp/SMS provider), DND registry lookup, consent capture | Live path is single-shot Payment Link only; outreach is simulated | L |
| 11 | Multi-step live campaigns via a scheduler/queue | The 30-day ladder exists only in eval | L |
| 12 | Remove dead code and unused imports (`selectStep`, `costOfAction`, `naturalRecoveryRate`, `scripts/probe-*`) | Noise | XS |
| 13 | Dev setup note: on Node 24 / npm 11.19 `npm ci` tries to `node-gyp rebuild` better-sqlite3 even though its tarball ships `prebuilds/win32-x64.node`; `npm ci --ignore-scripts` works | New machines fail to install without Visual Studio | XS |
| 14 | `npm audit`: sharp advisories (libheif, librsvg) via Next | Dependency hygiene | XS |
| 15 | Structured logging and error tracking on the live path | Audit log covers business events only | S |
