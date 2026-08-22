import { sqliteTable, text, integer, real } from "drizzle-orm/sqlite-core";

// ─── Cause taxonomy ─────────────────────────────────────────────────────────
export type FailureCause =
  | "insufficient_funds"
  | "bank_outage"
  | "psp_down"
  | "mandate_revoked"
  | "instrument_expired"
  | "customer_cancelled"
  | "upi_hang"
  | "auth_failed"
  | "unknown";

// ─── Action catalog (closed — agent cannot invent new actions) ───────────────
export type RecoveryAction =
  | "silent_retry_at_window"
  | "send_method_update_link"
  | "send_one_time_payment_link"
  | "offer_pause"
  | "hinglish_voice_script"
  | "escalate_human"
  | "do_nothing";

// ─── Stop codes ──────────────────────────────────────────────────────────────
export type StopCode =
  | "npci_retry_cap"
  | "already_paid"
  | "dnd_opted_out"
  | "bank_outage_active"
  | "mandate_revoked_block"
  | "promise_to_pay_pending"
  | "max_touches_reached"
  | "amount_below_floor"
  | "low_confidence"
  | "executor_failure";

// ─── Case status ─────────────────────────────────────────────────────────────
export type CaseStatus =
  | "open"
  | "in_progress"
  | "recovered"
  | "unrecoverable"
  | "escalated"
  | "stopped";

// ─── Cases ───────────────────────────────────────────────────────────────────
export const cases = sqliteTable("cases", {
  id: text("id").primaryKey(),
  // customer fields
  customerId: text("customer_id").notNull(),
  customerName: text("customer_name").notNull(),
  customerPhone: text("customer_phone"),
  customerEmail: text("customer_email"),
  // payment fields
  amountPaise: integer("amount_paise").notNull(), // always in paise
  currency: text("currency").notNull().default("INR"),
  paymentMethod: text("payment_method").notNull(), // upi | card | emandate
  subscriptionId: text("subscription_id"),
  subscriptionState: text("subscription_state"), // active | pending | halted | cancelled
  // failure fields from Razorpay webhook
  razorpayPaymentId: text("razorpay_payment_id"),
  errorCode: text("error_code"),
  errorReason: text("error_reason"),
  errorSource: text("error_source"),
  errorStep: text("error_step"),
  errorDescription: text("error_description"),
  // agent state
  cause: text("cause") as any,
  diagnosisNarrative: text("diagnosis_narrative"),
  actionTaken: text("action_taken") as any,
  stopCode: text("stop_code") as any,
  status: text("status").notNull().default("open") as any,
  retryCount: integer("retry_count").notNull().default(0),
  touchCount: integer("touch_count").notNull().default(0),
  // context
  isDnd: integer("is_dnd", { mode: "boolean" }).notNull().default(false),
  hasConsented: integer("has_consented", { mode: "boolean" }).notNull().default(true),
  promiseToPay: text("promise_to_pay"), // ISO date string if customer has committed
  salaryWindowHint: text("salary_window_hint"), // "1st" | "7th" | "last_working"
  bankOutageActive: integer("bank_outage_active", { mode: "boolean" }).notNull().default(false),
  // live Razorpay fields
  razorpayPaymentLinkId: text("razorpay_payment_link_id"),
  razorpayPaymentLinkUrl: text("razorpay_payment_link_url"),
  // timestamps
  failedAt: integer("failed_at").notNull(), // unix seconds
  createdAt: integer("created_at").notNull().default(0),
  updatedAt: integer("updated_at").notNull().default(0),
  resolvedAt: integer("resolved_at"),
  // batch membership
  batchId: text("batch_id"),
  isNaiveRun: integer("is_naive_run", { mode: "boolean" }).notNull().default(false),
});

// ─── Audit log ───────────────────────────────────────────────────────────────
export const auditLog = sqliteTable("audit_log", {
  id: text("id").primaryKey(),
  caseId: text("case_id").notNull(),
  ts: integer("ts").notNull(), // unix seconds
  actor: text("actor").notNull(), // "agent" | "policy" | "stop_rule" | "executor" | "webhook" | "naive"
  event: text("event").notNull(), // machine-readable event name
  detail: text("detail"), // human-readable explanation
  llmUsed: integer("llm_used", { mode: "boolean" }).notNull().default(false),
  llmFallback: integer("llm_fallback", { mode: "boolean" }).notNull().default(false),
  policyOverride: integer("policy_override", { mode: "boolean" }).notNull().default(false),
});

// ─── Batch runs ──────────────────────────────────────────────────────────────
export const batchRuns = sqliteTable("batch_runs", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  strategy: text("strategy").notNull(), // "triage" | "naive"
  totalCases: integer("total_cases").notNull(),
  recovered: integer("recovered").notNull().default(0),
  amountAtRiskPaise: integer("amount_at_risk_paise").notNull().default(0),
  amountRecoveredPaise: integer("amount_recovered_paise").notNull().default(0),
  touchesSent: integer("touches_sent").notNull().default(0),
  stopRuleHits: integer("stop_rule_hits").notNull().default(0),
  illegalRetries: integer("illegal_retries").notNull().default(0),
  dndViolations: integer("dnd_violations").notNull().default(0),
  llmFallbacks: integer("llm_fallbacks").notNull().default(0),
  policyOverrides: integer("policy_overrides").notNull().default(0),
  createdAt: integer("created_at").notNull(),
  completedAt: integer("completed_at"),
  metricsJson: text("metrics_json"),
});
