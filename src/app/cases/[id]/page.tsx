"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { use } from "react";

interface AuditEntry {
  id: string;
  ts: number;
  actor: string;
  event: string;
  detail: string;
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
  hasConsented: boolean;
  bankOutageActive: boolean;
  promiseToPay: string | null;
  salaryWindowHint: string | null;
  razorpayPaymentLinkUrl: string | null;
  isNaiveRun: boolean;
  failedAt: number;
  auditTrail: AuditEntry[];
}

const ACTOR_COLOR: Record<string, string> = {
  agent:      "bg-zinc-700 text-zinc-200",
  policy:     "bg-blue-900 text-blue-200",
  stop_rule:  "bg-amber-900 text-amber-200",
  executor:   "bg-emerald-900 text-emerald-200",
  webhook:    "bg-purple-900 text-purple-200",
  llm:        "bg-violet-900 text-violet-200",
  naive:      "bg-zinc-800 text-zinc-400",
};

export default function CaseDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [c, setC] = useState<CaseDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [livePending, setLivePending] = useState(false);
  const [liveResult, setLiveResult] = useState<any>(null);

  useEffect(() => {
    fetch(`/api/cases/${id}`)
      .then(r => r.json())
      .then(d => { setC(d); setLoading(false); })
      .catch(() => setLoading(false));
  }, [id]);

  const createLiveLink = async () => {
    setLivePending(true);
    try {
      const r = await fetch("/api/live", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ caseId: id }),
      });
      const data = await r.json();
      setLiveResult(data);
      // Refresh case
      const updated = await fetch(`/api/cases/${id}`);
      setC(await updated.json());
    } catch (e: any) {
      setLiveResult({ ok: false, error: e.message });
    }
    setLivePending(false);
  };

  if (loading) return <div className="text-xs text-zinc-500 p-6">Loading…</div>;
  if (!c || (c as any).error) return <div className="text-xs text-red-400 p-6">Case not found.</div>;

  const amountRupees = (c.amountPaise / 100).toLocaleString("en-IN");

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      {/* Breadcrumb */}
      <div className="text-xs text-zinc-500">
        <Link href="/" className="hover:text-zinc-300">Scoreboard</Link>
        <span className="mx-2">›</span>
        <Link href="/cases" className="hover:text-zinc-300">Cases</Link>
        <span className="mx-2">›</span>
        <span className="text-zinc-300">{c.id}</span>
      </div>

      {/* Case header */}
      <div className="rounded border border-zinc-800 bg-zinc-900 p-5 space-y-3">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-lg font-bold text-zinc-100">{c.customerName}</h1>
            <div className="text-xs text-zinc-500 mt-1">{c.customerEmail} · {c.customerPhone} · {c.paymentMethod.toUpperCase()}</div>
          </div>
          <div className="text-right">
            <div className="text-2xl font-bold text-zinc-100">₹{amountRupees}</div>
            <div className={`text-xs mt-1 font-semibold ${c.status === "recovered" ? "text-emerald-400" : c.status === "stopped" ? "text-amber-400" : "text-zinc-400"}`}>
              {c.status.toUpperCase()}
            </div>
          </div>
        </div>

        <div className="grid grid-cols-3 gap-3 text-xs">
          <div className="bg-zinc-800 rounded p-2">
            <div className="text-zinc-400">Cause</div>
            <div className="text-amber-400 font-semibold mt-0.5">{c.cause ?? "—"}</div>
          </div>
          <div className="bg-zinc-800 rounded p-2">
            <div className="text-zinc-400">Action</div>
            <div className="text-blue-400 font-semibold mt-0.5">{c.actionTaken ?? "—"}</div>
          </div>
          <div className="bg-zinc-800 rounded p-2">
            <div className="text-zinc-400">Stop Rule</div>
            <div className="text-amber-400 font-semibold mt-0.5">{c.stopCode ?? "none"}</div>
          </div>
        </div>

        {/* Flags */}
        <div className="flex gap-2 flex-wrap text-xs">
          {c.isDnd         && <span className="px-2 py-0.5 rounded bg-red-900 text-red-300">DND</span>}
          {c.bankOutageActive && <span className="px-2 py-0.5 rounded bg-orange-900 text-orange-300">BANK OUTAGE</span>}
          {c.promiseToPay  && <span className="px-2 py-0.5 rounded bg-purple-900 text-purple-300">PTP {c.promiseToPay}</span>}
          {c.salaryWindowHint && <span className="px-2 py-0.5 rounded bg-zinc-700 text-zinc-300">Salary: {c.salaryWindowHint}</span>}
          {c.isNaiveRun    && <span className="px-2 py-0.5 rounded bg-zinc-800 text-zinc-400">NAIVE RUN</span>}
          {!c.hasConsented && <span className="px-2 py-0.5 rounded bg-red-900 text-red-300">NO CONSENT</span>}
        </div>

        {/* Diagnosis */}
        {c.diagnosisNarrative && (
          <div className="text-xs text-zinc-300 border-t border-zinc-800 pt-3">
            <span className="text-zinc-500">Diagnosis: </span>{c.diagnosisNarrative}
          </div>
        )}

        {/* Error fields */}
        <div className="text-xs text-zinc-500 border-t border-zinc-800 pt-3 grid grid-cols-2 gap-1">
          <div><span className="text-zinc-600">error_reason:</span> <span className="text-zinc-300">{c.errorReason ?? "—"}</span></div>
          <div><span className="text-zinc-600">error_source:</span> <span className="text-zinc-300">{c.errorSource ?? "—"}</span></div>
          <div><span className="text-zinc-600">subscription_state:</span> <span className="text-zinc-300">{c.subscriptionState ?? "—"}</span></div>
          <div><span className="text-zinc-600">retries:</span> <span className="text-zinc-300">{c.retryCount} · touches: {c.touchCount}</span></div>
        </div>
      </div>

      {/* Live Razorpay action */}
      {!c.isNaiveRun && (
        <div className="rounded border border-zinc-700 bg-zinc-900 p-4 space-y-3">
          <div className="text-sm font-semibold text-zinc-200">Live Test-Mode Action</div>
          <div className="text-xs text-zinc-400">Create a real Razorpay test Payment Link for this case. Requires <code>RAZORPAY_KEY_ID</code> in <code>.env</code>.</div>
          {c.razorpayPaymentLinkUrl ? (
            <div className="text-xs">
              <span className="text-zinc-400">Payment Link: </span>
              <a href={c.razorpayPaymentLinkUrl} target="_blank" rel="noreferrer" className="text-emerald-400 hover:underline break-all">
                {c.razorpayPaymentLinkUrl}
              </a>
            </div>
          ) : (
            <button onClick={createLiveLink} disabled={livePending}
              className="px-4 py-2 text-xs bg-blue-700 hover:bg-blue-600 disabled:opacity-50 rounded text-white font-semibold"
            >
              {livePending ? "Creating…" : "⚡ Create Payment Link (test mode)"}
            </button>
          )}
          {liveResult && !liveResult.ok && (
            <div className="text-xs text-red-400 rounded bg-red-950 p-2">
              {liveResult.error} {liveResult.escalated && "· Escalated to human (graceful fallback ✓)"}
            </div>
          )}
          {liveResult?.paymentLink && (
            <div className="text-xs text-emerald-400">
              Created: <a href={liveResult.paymentLink.short_url} target="_blank" rel="noreferrer" className="underline">{liveResult.paymentLink.short_url}</a>
            </div>
          )}
        </div>
      )}

      {/* Audit timeline */}
      <div className="space-y-2">
        <h2 className="text-sm font-semibold text-zinc-300">Audit Trail</h2>
        <div className="space-y-2">
          {c.auditTrail.map((entry) => (
            <div key={entry.id} className="flex gap-3 text-xs">
              <div className="text-zinc-600 w-24 shrink-0 pt-0.5">{new Date(entry.ts * 1000).toLocaleTimeString()}</div>
              <div className="w-20 shrink-0">
                <span className={`px-1.5 py-0.5 rounded text-[10px] font-semibold ${ACTOR_COLOR[entry.actor] ?? "bg-zinc-800 text-zinc-400"}`}>
                  {entry.actor}
                </span>
              </div>
              <div className="flex-1">
                <span className="text-zinc-300 font-semibold">{entry.event}</span>
                <span className="text-zinc-500 ml-2">{entry.detail}</span>
                <span className="ml-2 space-x-1">
                  {entry.llmUsed     && <span className="text-violet-400">[LLM]</span>}
                  {entry.llmFallback && <span className="text-amber-400">[fallback]</span>}
                  {entry.policyOverride && <span className="text-red-400">[policy override]</span>}
                </span>
              </div>
            </div>
          ))}
          {c.auditTrail.length === 0 && (
            <div className="text-xs text-zinc-600">No audit entries. Run batch eval first.</div>
          )}
        </div>
      </div>
    </div>
  );
}
