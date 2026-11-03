# Live demo — 90 seconds, Razorpay test mode

SQLite is local. Do not deploy this to Vercel expecting the database to survive.

**Record against production, not `next dev`:**

```bash
npm run build
npm start
```

`next dev` can put a red issue badge on camera. `next.config.ts` hides `devIndicators` if you slip.

Checkout.js confirm (`POST /api/live/confirm`) does **not** need ngrok. Payment Link GET callback (`/api/webhooks/razorpay?case_id=…`) also recovers on localhost without a tunnel — it verifies `plink_id|reference_id|status|payment_id`, not the checkout HMAC. Prefer Payment Link on camera if Checkout.js is flaky.

## Once

```bash
cp .env.example .env
# fill RAZORPAY_KEY_ID, RAZORPAY_KEY_SECRET, RAZORPAY_WEBHOOK_SECRET
# LLM is optional. Without a key, taxonomy holds and the live loop still works.

npm install
npm run compliance
npm run build
npm start
```

Webhook (optional, only if you want `payment_link.paid` as the inbound actor):

```bash
ngrok http 3000
```

Set `APP_BASE_URL` to the ngrok https URL. In Razorpay Dashboard → Webhooks (test mode), point at `https://<ngrok>/api/webhooks/razorpay` for `payment.failed`, `payment.captured`, `payment_link.paid`, `subscription.pending`. Secret must match `RAZORPAY_WEBHOOK_SECRET`.

The homepage ledger loads `data/last-eval.json` if SQLite has no completed batch, so `/` is never empty.

## Clip 1 — mandate revoked (the hire)

1. http://localhost:3000
2. **Live: mandate revoked**
3. Case opens: cause `mandate_revoked`, action `send_one_time_payment_link`, stop rules clear
4. **Safer primary:** **Or pay via Payment Link** → Netbanking → any bank → **Success** on the mock page. `4111…` is rejected as international on this MID. Domestic test cards: see [Razorpay test cards](https://razorpay.com/docs/payments/payments/test-card-details/) (Visa `4386 2894 0766 0153`).
5. **Flourish if it opens in one take:** **Pay now** → Checkout.js → same Netbanking Success (no ngrok)
6. Status becomes recovered. Audit: actor `webhook`, event `payment_received`

Do not record a `kick_failed` clip as the hero. If keys fail, diagnosis still shows — skip to vs-rail.

## Clip 2 — same failure, Naive is illegal

Open a `mandate_revoked` triage case from the registry. The vs-rail shows Naive's first action: silent retry on a dead mandate.

## Clip 3 — model down

Ledger → **Open taxonomy-only cases**, or any row with a `fallback` badge. Banner: taxonomy held, policy still ran.

## If Payment Link create fails

Keys missing or network error: audit `executor_failure` / `kick_failed`. Case stays open. Checkout.js **Pay now** still works if keys are present (`POST /api/live/order`).
