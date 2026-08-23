import { sqlite } from "./client";

/**
 * Creates all tables if they do not exist, then adds any columns introduced
 * after a database was first created.
 *
 * SQLite has no `ADD COLUMN IF NOT EXISTS`, so new columns are applied
 * individually and duplicate-column errors are ignored. This keeps an existing
 * eval database usable across schema changes without a migration toolchain,
 * which matters when the demo database is the one holding the recorded results.
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
      policy_override INTEGER NOT NULL DEFAULT 0,
      day INTEGER
    );

    CREATE TABLE IF NOT EXISTS campaign_steps (
      id TEXT PRIMARY KEY,
      case_id TEXT NOT NULL,
      batch_id TEXT,
      day INTEGER NOT NULL,
      step_index INTEGER NOT NULL,
      action TEXT NOT NULL,
      channel TEXT NOT NULL,
      cost_paise INTEGER NOT NULL DEFAULT 0,
      rationale TEXT,
      blocked INTEGER NOT NULL DEFAULT 0,
      stop_code TEXT,
      stop_reason TEXT,
      outcome TEXT NOT NULL,
      outcome_reason TEXT,
      reply_text TEXT,
      reply_ground_truth TEXT,
      intent TEXT,
      intent_confidence REAL,
      intent_method TEXT,
      promise_date TEXT,
      voice_script TEXT
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

    CREATE INDEX IF NOT EXISTS idx_audit_case   ON audit_log (case_id);
    CREATE INDEX IF NOT EXISTS idx_steps_case   ON campaign_steps (case_id);
    CREATE INDEX IF NOT EXISTS idx_cases_batch  ON cases (batch_id);
  `);

  addColumns("cases", [
    "is_holdout INTEGER NOT NULL DEFAULT 0",
    "segment TEXT NOT NULL DEFAULT 'subscription'",
    "total_cost_paise INTEGER NOT NULL DEFAULT 0",
    "recovered_amount_paise INTEGER NOT NULL DEFAULT 0",
    "recovered_on_day INTEGER",
    "step_count INTEGER NOT NULL DEFAULT 0",
    "confidence_score REAL",
    "llm_calls INTEGER NOT NULL DEFAULT 0",
    "llm_fallbacks INTEGER NOT NULL DEFAULT 0",
    "policy_overrides INTEGER NOT NULL DEFAULT 0",
    "opted_out INTEGER NOT NULL DEFAULT 0",
    "disputed INTEGER NOT NULL DEFAULT 0",
    "invoice_id TEXT",
    "invoice_due_date TEXT",
    "aging_days INTEGER",
  ]);

  addColumns("batch_runs", [
    "outreach_cost_paise INTEGER NOT NULL DEFAULT 0",
    "net_recovered_paise INTEGER NOT NULL DEFAULT 0",
    "roi REAL NOT NULL DEFAULT 0",
    "cost_per_rupee_recovered REAL NOT NULL DEFAULT 0",
    "treated_cases INTEGER NOT NULL DEFAULT 0",
    "treated_recovered INTEGER NOT NULL DEFAULT 0",
    "holdout_cases INTEGER NOT NULL DEFAULT 0",
    "holdout_recovered INTEGER NOT NULL DEFAULT 0",
    "absolute_lift_pct REAL NOT NULL DEFAULT 0",
    "relative_lift_pct REAL NOT NULL DEFAULT 0",
    "ignored_opt_outs INTEGER NOT NULL DEFAULT 0",
    "outage_contacts INTEGER NOT NULL DEFAULT 0",
    "illegal_recovered_paise INTEGER NOT NULL DEFAULT 0",
    "replies_received INTEGER NOT NULL DEFAULT 0",
    "intent_extractions INTEGER NOT NULL DEFAULT 0",
    "intent_accuracy_pct REAL NOT NULL DEFAULT 0",
    "avg_steps_per_case REAL NOT NULL DEFAULT 0",
    "avg_days_to_recovery REAL NOT NULL DEFAULT 0",
  ]);

  addColumns("audit_log", ["day INTEGER"]);
  addColumns("campaign_steps", ["outreach_copy TEXT"]);
}

function addColumns(table: string, defs: string[]) {
  for (const def of defs) {
    try {
      sqlite.exec(`ALTER TABLE ${table} ADD COLUMN ${def};`);
    } catch (e) {
      const msg = (e as Error).message ?? "";
      // Expected when the column is already present from a previous run.
      if (!/duplicate column name/i.test(msg)) throw e;
    }
  }
}
