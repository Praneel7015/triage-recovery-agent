import { db, sqlite } from "./client";

/**
 * Creates all tables if they do not exist.
 * Run once at server startup or via `npm run db:push`.
 */
export function migrate() {
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS cases (
      id TEXT PRIMARY KEY,
      customer_id TEXT NOT NULL,
      customer_name TEXT NOT NULL,
      customer_phone TEXT,
      customer_email TEXT,
      amount_paise INTEGER NOT NULL,
      currency TEXT NOT NULL DEFAULT 'INR',
      payment_method TEXT NOT NULL,
      subscription_id TEXT,
      subscription_state TEXT,
      razorpay_payment_id TEXT,
      error_code TEXT,
      error_reason TEXT,
      error_source TEXT,
      error_step TEXT,
      error_description TEXT,
      cause TEXT,
      diagnosis_narrative TEXT,
      action_taken TEXT,
      stop_code TEXT,
      status TEXT NOT NULL DEFAULT 'open',
      retry_count INTEGER NOT NULL DEFAULT 0,
      touch_count INTEGER NOT NULL DEFAULT 0,
      is_dnd INTEGER NOT NULL DEFAULT 0,
      has_consented INTEGER NOT NULL DEFAULT 1,
      promise_to_pay TEXT,
      salary_window_hint TEXT,
      bank_outage_active INTEGER NOT NULL DEFAULT 0,
      razorpay_payment_link_id TEXT,
      razorpay_payment_link_url TEXT,
      failed_at INTEGER NOT NULL,
      created_at INTEGER NOT NULL DEFAULT 0,
      updated_at INTEGER NOT NULL DEFAULT 0,
      resolved_at INTEGER,
      batch_id TEXT,
      is_naive_run INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS audit_log (
      id TEXT PRIMARY KEY,
      case_id TEXT NOT NULL,
      ts INTEGER NOT NULL,
      actor TEXT NOT NULL,
      event TEXT NOT NULL,
      detail TEXT,
      llm_used INTEGER NOT NULL DEFAULT 0,
      llm_fallback INTEGER NOT NULL DEFAULT 0,
      policy_override INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS batch_runs (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      strategy TEXT NOT NULL,
      total_cases INTEGER NOT NULL,
      recovered INTEGER NOT NULL DEFAULT 0,
      amount_at_risk_paise INTEGER NOT NULL DEFAULT 0,
      amount_recovered_paise INTEGER NOT NULL DEFAULT 0,
      touches_sent INTEGER NOT NULL DEFAULT 0,
      stop_rule_hits INTEGER NOT NULL DEFAULT 0,
      illegal_retries INTEGER NOT NULL DEFAULT 0,
      dnd_violations INTEGER NOT NULL DEFAULT 0,
      llm_fallbacks INTEGER NOT NULL DEFAULT 0,
      policy_overrides INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL,
      completed_at INTEGER,
      metrics_json TEXT
    );
  `);
}
