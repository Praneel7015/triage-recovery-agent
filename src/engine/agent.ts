import { classifyCause } from "./taxonomy";
import { selectAction } from "./policy";
import { checkStops } from "./stops";
import type { FailureCause, RecoveryAction, StopCode } from "@/db/schema";

export interface CaseInput {
  id: string;
  customerId: string;
  customerName: string;
  customerPhone?: string | null;
  customerEmail?: string | null;
  amountPaise: number;
  currency: string;
  paymentMethod: string;
  subscriptionId?: string | null;
  subscriptionState?: string | null;
  errorCode?: string | null;
  errorReason?: string | null;
  errorSource?: string | null;
  errorStep?: string | null;
  errorDescription?: string | null;
  retryCount: number;
  touchCount: number;
  isDnd: boolean;
  hasConsented: boolean;
  alreadyPaid?: boolean;
  bankOutageActive?: boolean;
  promiseToPay?: string | null;
  salaryWindowHint?: string | null;
}

export interface AuditEntry {
  actor: "agent" | "policy" | "stop_rule" | "executor" | "llm";
  event: string;
  detail: string;
  llmUsed?: boolean;
  llmFallback?: boolean;
  policyOverride?: boolean;
}

export interface AgentResult {
  cause: FailureCause;
  diagnosisNarrative: string;
  action: RecoveryAction;
  blocked: boolean;
  stopCode?: StopCode;
  stopReason?: string;
  confidenceScore: number;
  llmUsed: boolean;
  llmFallback: boolean;
  policyOverride: boolean;
  outreachCopy?: string;
  auditTrail: AuditEntry[];
}

// Lazy import so LLM module is only loaded if keys are configured
async function tryLLM(c: CaseInput, taxonomyCause: FailureCause): Promise<{
  cause: FailureCause;
  narrative: string;
  outreachCopy: string;
  confidence: number;
  fallback: boolean;
} | null> {
  try {
    const { refineCause } = await import("@/adapters/llm");
    return await refineCause(c, taxonomyCause);
  } catch {
    return null;
  }
}

/**
 * Core agent loop: one case in, one AgentResult out.
 * The LLM only refines copy and clarifies unknown causes.
 * Policy selects the action. Stops can veto it.
 * If policy and LLM disagree, policy wins.
 */
export async function runAgent(c: CaseInput): Promise<AgentResult> {
  const audit: AuditEntry[] = [];
  let llmUsed      = false;
  let llmFallback  = false;
  let policyOverride = false;

  // ── Step 1: Taxonomy classification ─────────────────────────────────────
  const taxonomyCause = classifyCause({
    errorCode: c.errorCode,
    errorReason: c.errorReason,
    errorSource: c.errorSource,
    errorStep: c.errorStep,
    errorDescription: c.errorDescription,
    bankOutageActive: c.bankOutageActive ?? false,
    subscriptionState: c.subscriptionState,
    paymentMethod: c.paymentMethod,
  });

  audit.push({
    actor: "agent",
    event: "taxonomy_classified",
    detail: `Taxonomy mapped error to cause: ${taxonomyCause}`,
  });

  // ── Step 2: LLM refinement (only for ambiguous cases) ───────────────────
  let cause: FailureCause = taxonomyCause;
  let diagnosisNarrative  = `Cause classified as "${taxonomyCause}" by deterministic taxonomy.`;
  let outreachCopy        = "";
  let confidenceScore     = 1.0;

  const needsLLM = taxonomyCause === "unknown";

  if (needsLLM) {
    const llmResult = await tryLLM(c, taxonomyCause);
    if (llmResult) {
      llmUsed     = true;
      llmFallback = llmResult.fallback;
      confidenceScore = llmResult.confidence;

      if (!llmResult.fallback) {
        // Check if LLM disagrees with a deterministic cause
        if (llmResult.cause !== taxonomyCause && taxonomyCause !== "unknown") {
          policyOverride = true;
          audit.push({
            actor: "agent",
            event: "policy_override",
            detail: `LLM suggested "${llmResult.cause}", but taxonomy determined "${taxonomyCause}". Policy wins.`,
            llmUsed: true,
            policyOverride: true,
          });
        } else {
          cause = llmResult.cause;
        }
      } else {
        llmFallback = true;
        audit.push({
          actor: "agent",
          event: "llm_fallback",
          detail: "LLM unavailable or timed out. Falling back to taxonomy result.",
          llmUsed: true,
          llmFallback: true,
        });
      }
      diagnosisNarrative = llmResult.narrative || diagnosisNarrative;
      outreachCopy       = llmResult.outreachCopy || "";
    } else {
      audit.push({
        actor: "agent",
        event: "llm_fallback",
        detail: "LLM not configured. Using taxonomy-only result.",
        llmFallback: true,
      });
      llmFallback = true;
    }
  }

  // ── Step 3: Policy selects action ────────────────────────────────────────
  const action = selectAction({
    cause,
    subscriptionState: c.subscriptionState,
    retryCount: c.retryCount,
    amountPaise: c.amountPaise,
    paymentMethod: c.paymentMethod,
  });

  audit.push({
    actor: "policy",
    event: "action_selected",
    detail: `Policy selected action: ${action}`,
    policyOverride,
  });

  // ── Step 4: Stop rules veto check ────────────────────────────────────────
  const stopResult = checkStops({
    action,
    cause,
    retryCount: c.retryCount,
    touchCount: c.touchCount,
    isDnd: c.isDnd,
    hasConsented: c.hasConsented,
    alreadyPaid: c.alreadyPaid ?? false,
    bankOutageActive: c.bankOutageActive ?? false,
    mandateRevoked: cause === "mandate_revoked",
    promiseToPay: c.promiseToPay,
    amountPaise: c.amountPaise,
    confidenceScore,
  });

  if (stopResult.blocked) {
    audit.push({
      actor: "stop_rule",
      event: "action_blocked",
      detail: `Stop rule "${stopResult.stopCode}": ${stopResult.reason}`,
    });
  } else {
    audit.push({
      actor: "executor",
      event: "action_allowed",
      detail: `Action "${action}" cleared all stop rules.`,
    });
  }

  return {
    cause,
    diagnosisNarrative,
    action,
    blocked: stopResult.blocked,
    stopCode: stopResult.stopCode,
    stopReason: stopResult.reason,
    confidenceScore,
    llmUsed,
    llmFallback,
    policyOverride,
    outreachCopy,
    auditTrail: audit,
  };
}
