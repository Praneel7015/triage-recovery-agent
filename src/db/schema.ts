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
  | "executor_failure"
  | "uneconomic"
  | "campaign_expired"
  | "customer_disputed"
  | "ladder_exhausted";

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
  // ── campaign + economics ──────────────────────────────────────────────────
  /** Control-group members are never contacted, so their outcome is the counterfactual. */
  isHoldout: integer("is_holdout", { mode: "boolean" }).notNull().default(false),
  segment: text("segment").notNull().default("subscription"), // subscription | checkout | b2b_invoice
  /** Total outreach spend on this case, in paise. */
  totalCostPaise: integer("total_cost_paise").notNull().default(0),
  recoveredAmountPaise: integer("recovered_amount_paise").notNull().default(0),
  recoveredOnDay: integer("recovered_on_day"),
  stepCount: integer("step_count").notNull().default(0),
  confidenceScore: real("confidence_score"),
  llmCalls: integer("llm_calls").notNull().default(0),
  llmFallbacks: integer("llm_fallbacks").notNull().default(0),
  policyOverrides: integer("policy_overrides").notNull().default(0),
  optedOut: integer("opted_out", { mode: "boolean" }).notNull().default(false),
  disputed: integer("disputed", { mode: "boolean" }).notNull().default(false),
  // ── B2B receivables lane ──────────────────────────────────────────────────
  invoiceId: text("invoice_id"),
  invoiceDueDate: text("invoice_due_date"),
  agingDays: integer("aging_days"),
});

// ─── Campaign steps ──────────────────────────────────────────────────────────
// One row per rung of the escalation ladder, so a campaign can be replayed
// day by day and every rupee of spend traced to the step that incurred it.
export const campaignSteps = sqliteTable("campaign_steps", {
  id: text("id").primaryKey(),
  caseId: text("case_id").notNull(),
  batchId: text("batch_id"),
  day: integer("day").notNull(),
  stepIndex: integer("step_index").notNull(),
  action: text("action").notNull() as any,
  channel: text("channel").notNull(),
  costPaise: integer("cost_paise").notNull().default(0),
  rationale: text("rationale"),
  blocked: integer("blocked", { mode: "boolean" }).notNull().default(false),
  stopCode: text("stop_code") as any,
  stopReason: text("stop_reason"),
  outcome: text("outcome").notNull(),
  outcomeReason: text("outcome_reason"),
  // inbound reply, if the customer answered this touch
  replyText: text("reply_text"),
  replyGroundTruth: text("reply_ground_truth"),
  intent: text("intent"),
  intentConfidence: real("intent_confidence"),
  intentMethod: text("intent_method"), // llm | keyword
  promiseDate: text("promise_date"),
  voiceScript: text("voice_script"),
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
  /** Campaign day this entry belongs to, so a trail can be read as a timeline. */
  day: integer("day"),
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
  // ── economics ─────────────────────────────────────────────────────────────
  outreachCostPaise: integer("outreach_cost_paise").notNull().default(0),
  netRecoveredPaise: integer("net_recovered_paise").notNull().default(0),
  roi: real("roi").notNull().default(0),
  costPerRupeeRecovered: real("cost_per_rupee_recovered").notNull().default(0),
  // ── holdout + lift ────────────────────────────────────────────────────────
  treatedCases: integer("treated_cases").notNull().default(0),
  treatedRecovered: integer("treated_recovered").notNull().default(0),
  holdoutCases: integer("holdout_cases").notNull().default(0),
  holdoutRecovered: integer("holdout_recovered").notNull().default(0),
  absoluteLiftPct: real("absolute_lift_pct").notNull().default(0),
  relativeLiftPct: real("relative_lift_pct").notNull().default(0),
  // ── additional compliance counters ────────────────────────────────────────
  ignoredOptOuts: integer("ignored_opt_outs").notNull().default(0),
  outageContacts: integer("outage_contacts").notNull().default(0),
  // ── conversation + campaign shape ─────────────────────────────────────────
  repliesReceived: integer("replies_received").notNull().default(0),
  intentExtractions: integer("intent_extractions").notNull().default(0),
  intentAccuracyPct: real("intent_accuracy_pct").notNull().default(0),
  avgStepsPerCase: real("avg_steps_per_case").notNull().default(0),
  avgDaysToRecovery: real("avg_days_to_recovery").notNull().default(0),
});
