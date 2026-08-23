"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { use } from "react";
import { CampaignTimeline, type CampaignStepRow } from "@/components/CampaignTimeline";
import { VoicePlayer } from "@/components/VoicePlayer";
import { rupees, labelCause, labelAction, labelStatus } from "@/lib/format";

interface AuditEntry {
  id: string;
  ts: number;
  actor: string;
  event: string;
  detail: string;
  day: number | null;
  llmUsed: boolean;
  llmFallback: boolean;
  policyOverride: boolean;
}

interface CaseDetail {
  id: string;
  customerName: string;
  customerEmail: string | null;
  customerPhone: string | null;
  amountPaise: number;
  paymentMethod: string;
  segment: string;
  subscriptionState: string | null;
  errorReason: string | null;
  errorSource: string | null;
  errorDescription: string | null;
  cause: string | null;
  diagnosisNarrative: string | null;
  actionTaken: string | null;
  stopCode: string | null;
  status: string;
  retryCount: number;
  touchCount: number;
  isDnd: boolean;
  isHoldout: boolean;
  hasConsented: boolean;
  bankOutageActive: boolean;
  promiseToPay: string | null;
  salaryWindowHint: string | null;
  razorpayPaymentLinkUrl: string | null;
  isNaiveRun: boolean;
  totalCostPaise: number;
  recoveredAmountPaise: number;
  recoveredOnDay: number | null;
  stepCount: number;
  confidenceScore: number | null;
  llmCalls: number;
  optedOut: boolean;
  disputed: boolean;
  auditTrail: AuditEntry[];
  campaignSteps: CampaignStepRow[];
}

const ACTOR_LABEL: Record<string, string> = {
  agent: "Agent",
  policy: "Policy",
  stop_rule: "Stop rule",
  executor: "Executor",
  webhook: "Webhook",
  llm: "LLM",
  customer: "Customer",
  naive: "Naive",
};

export default function CaseFilePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [c, setC] = useState<CaseDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [livePending, setLivePending] = useState(false);
  const [liveError, setLiveError] = useState<string | null>(null);

  const reload = () =>
    fetch(`/api/cases/${id}`)
      .then((r) => r.json())
      .then((d) => { setC(d); setLoading(false); })
      .catch(() => setLoading(false));

  useEffect(() => { reload(); }, [id]);

  const createLiveLink = async () => {
    setLivePending(true);
    setLiveError(null);
    try {
      const r = await fetch("/api/live", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ caseId: id }),
      });
      const data = await r.json();
      if (!data.ok) setLiveError(data.error ?? "Payment link failed");
      await reload();
    } catch (e: any) {
      setLiveError(e.message);
    }
    setLivePending(false);
  };

  if (loading) {
    return (
      <div className="page">
        <p className="dim">Opening case file…</p>
      </div>
    );
  }

  if (!c || (c as any).error) {
    return (
      <div className="page">
        <div className="empty panel">
          <h2>Case not found</h2>
          <p>This case id does not exist. Run a batch eval first.</p>
          <Link href="/cases" className="btn btn-ghost">Back to registry</Link>
        </div>
      </div>
    );
  }

  const voiceScript = c.campaignSteps?.find((s) => s.voiceScript)?.voiceScript;

  return (
    <div className="page">
      <nav className="dim" style={{ fontSize: "0.75rem", marginBottom: "1.25rem" }}>
        <Link href="/" style={{ color: "var(--roast)" }}>Ledger</Link>
        <span style={{ margin: "0 0.4rem" }}>/</span>
        <Link href="/cases" style={{ color: "var(--roast)" }}>Case files</Link>
        <span style={{ margin: "0 0.4rem" }}>/</span>
        <span>{c.id}</span>
      </nav>

      {/* Case header */}
      <header className="panel panel-raised" style={{ marginBottom: "1.25rem" }}>
        <div style={{ display: "flex", flexWrap: "wrap", gap: "1rem", justifyContent: "space-between", alignItems: "flex-start" }}>
          <div>
            <p className="eyebrow">{c.segment.replace(/_/g, " ")} · {c.paymentMethod.toUpperCase()}</p>
            <h1 className="display" style={{ fontSize: "1.65rem", margin: "0.25rem 0" }}>{c.customerName}</h1>
            <p className="dim" style={{ margin: 0, fontSize: "0.8rem" }}>
              {c.customerEmail ?? "—"} · {c.customerPhone ?? "—"}
            </p>
          </div>
          <div style={{ textAlign: "right" }}>
            <div className="data highlight" style={{ fontSize: "1.75rem", color: "var(--ink)" }}>
              {rupees(c.amountPaise)}
            </div>
            <div className={`status-${c.status}`} style={{ fontSize: "0.75rem", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.08em" }}>
              {labelStatus(c.status)}
            </div>
          </div>
        </div>

        <div className="metric-grid cols-3" style={{ marginTop: "1.25rem", paddingTop: "1rem", borderTop: "1px solid var(--border)" }}>
          <div className="metric">
            <span className="metric-label">Cause</span>
            <span className="metric-value" style={{ fontSize: "1rem" }}>{labelCause(c.cause)}</span>
          </div>
          <div className="metric">
            <span className="metric-label">Primary action</span>
            <span className="metric-value" style={{ fontSize: "0.95rem" }}>{labelAction(c.actionTaken)}</span>
          </div>
          <div className="metric">
            <span className="metric-label">Stop rule</span>
            <span className="metric-value" style={{ fontSize: "0.95rem" }}>{c.stopCode?.replace(/_/g, " ") ?? "none"}</span>
          </div>
        </div>

        <div style={{ display: "flex", flexWrap: "wrap", gap: "0.4rem", marginTop: "0.85rem" }}>
          {c.isHoldout && <span className="badge badge-warn">Holdout — no contact</span>}
          {c.isDnd && <span className="badge badge-danger">DND</span>}
          {c.bankOutageActive && <span className="badge badge-warn">Bank outage</span>}
          {c.promiseToPay && <span className="badge badge-signal">PTP {c.promiseToPay}</span>}
          {c.salaryWindowHint && <span className="badge badge-forest">Salary {c.salaryWindowHint}</span>}
          {c.isNaiveRun && <span className="badge badge-forest">Naive run</span>}
          {c.optedOut && <span className="badge badge-danger">Opted out</span>}
          {c.disputed && <span className="badge badge-warn">Disputed</span>}
        </div>

        {c.diagnosisNarrative && (
          <p style={{ margin: "1rem 0 0", fontSize: "0.88rem", color: "var(--cream)", borderTop: "1px solid var(--border-on-roast)", paddingTop: "1rem" }}>
            {c.diagnosisNarrative}
          </p>
        )}
      </header>

      <div className="case-split" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1.25rem" }}>
        {/* Campaign timeline — signature */}
        <section className="panel">
          <p className="eyebrow" style={{ marginBottom: "1rem" }}>Campaign spine</p>
          <CampaignTimeline steps={c.campaignSteps ?? []} />
          {voiceScript && <VoicePlayer script={voiceScript} />}
        </section>

        {/* Audit + live */}
        <div style={{ display: "flex", flexDirection: "column", gap: "1.25rem" }}>
          {!c.isNaiveRun && (
            <section className="panel">
              <p className="eyebrow" style={{ marginBottom: "0.75rem" }}>Live test-mode</p>
              <p className="muted" style={{ fontSize: "0.82rem", margin: "0 0 0.85rem" }}>
                Create a real Razorpay Payment Link for this case.
              </p>
              {c.razorpayPaymentLinkUrl ? (
                <a
                  href={c.razorpayPaymentLinkUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="btn btn-primary"
                  style={{ display: "inline-flex", wordBreak: "break-all" }}
                >
                  Open payment link
                </a>
              ) : (
                <button type="button" className="btn btn-primary" onClick={createLiveLink} disabled={livePending}>
                  {livePending ? "Creating…" : "Create payment link"}
                </button>
              )}
              {liveError && (
                <p style={{ color: "var(--danger)", fontSize: "0.8rem", marginTop: "0.65rem" }}>{liveError}</p>
              )}
            </section>
          )}

          <section className="panel" style={{ flex: 1 }}>
            <p className="eyebrow" style={{ marginBottom: "0.85rem" }}>Audit trail</p>
            <div style={{ maxHeight: "420px", overflowY: "auto" }}>
              {c.auditTrail.length === 0 ? (
                <p className="dim" style={{ fontSize: "0.82rem" }}>No audit entries.</p>
              ) : (
                c.auditTrail.map((e) => (
                  <div
                    key={e.id}
                    style={{
                      padding: "0.55rem 0",
                      borderBottom: "1px solid var(--border)",
                      fontSize: "0.78rem",
                    }}
                  >
                    <div style={{ display: "flex", gap: "0.5rem", alignItems: "center", flexWrap: "wrap" }}>
                      <span className="badge badge-forest">{ACTOR_LABEL[e.actor] ?? e.actor}</span>
                      <strong>{e.event.replace(/_/g, " ")}</strong>
                      {e.day != null && <span className="dim">day {e.day}</span>}
                      {e.policyOverride && <span className="badge badge-warn">policy override</span>}
                      {e.llmFallback && <span className="badge badge-warn">fallback</span>}
                    </div>
                    <p className="muted" style={{ margin: "0.25rem 0 0" }}>{e.detail}</p>
                  </div>
                ))
              )}
            </div>
          </section>
        </div>
      </div>

      {/* Error context footer */}
      <footer className="panel-inset" style={{ marginTop: "1.25rem", fontSize: "0.75rem" }}>
        <span className="dim">error_reason</span> {c.errorReason ?? "—"} ·{" "}
        <span className="dim">source</span> {c.errorSource ?? "—"} ·{" "}
        <span className="dim">subscription</span> {c.subscriptionState ?? "—"} ·{" "}
        <span className="dim">spend</span> {rupees(c.totalCostPaise)} ·{" "}
        <span className="dim">steps</span> {c.stepCount}
      </footer>
    </div>
  );
}
