"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

interface BatchRun {
  id: string;
  name: string;
  strategy: string;
  totalCases: number;
  recovered: number;
  amountAtRiskPaise: number;
  amountRecoveredPaise: number;
  touchesSent: number;
  stopRuleHits: number;
  illegalRetries: number;
  dndViolations: number;
  llmFallbacks: number;
  policyOverrides: number;
  createdAt: number;
}

function fmt(paise: number) {
  return "₹" + (paise / 100).toLocaleString("en-IN", { maximumFractionDigits: 0 });
}

function pct(num: number, den: number) {
  if (!den) return "—";
  return ((num / den) * 100).toFixed(1) + "%";
}

function StatCard({ label, value, sub, highlight }: { label: string; value: string; sub?: string; highlight?: boolean }) {
  return (
    <div className={`rounded border p-4 ${highlight ? "border-emerald-700 bg-emerald-950/40" : "border-zinc-800 bg-zinc-900"}`}>
      <div className="text-xs text-zinc-400 mb-1">{label}</div>
      <div className={`text-2xl font-bold ${highlight ? "text-emerald-300" : "text-zinc-100"}`}>{value}</div>
      {sub && <div className="text-xs text-zinc-500 mt-1">{sub}</div>}
    </div>
  );
}

function Badge({ label, color }: { label: string; color: string }) {
  return <span className={`text-xs px-2 py-0.5 rounded font-semibold ${color}`}>{label}</span>;
}

export default function Scoreboard() {
  const [runs, setRuns] = useState<BatchRun[]>([]);
  const [loading, setLoading] = useState(false);
  const [running, setRunning] = useState(false);

  const fetchRuns = async () => {
    setLoading(true);
    const r = await fetch("/api/batch");
    if (r.ok) setRuns(await r.json());
    setLoading(false);
  };

  const triggerEval = async () => {
    setRunning(true);
    await fetch("/api/eval", { method: "POST" });
    await fetchRuns();
    setRunning(false);
  };

  useEffect(() => { fetchRuns(); }, []);

  const triage = runs.find(r => r.strategy === "triage");
  const naive  = runs.find(r => r.strategy === "naive");
  const deltaRupees = triage && naive ? (triage.amountRecoveredPaise - naive.amountRecoveredPaise) / 100 : null;

  return (
    <div className="max-w-6xl mx-auto space-y-8">
      {/* Header row */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-zinc-100">Revenue Recovery Scoreboard</h1>
          <p className="text-xs text-zinc-500 mt-1">100-case batch · UPI Autopay involuntary churn · Cause-conditioned playbook vs naive retry-and-spam</p>
        </div>
        <button
          onClick={triggerEval}
          disabled={running}
          className="px-4 py-2 text-xs bg-emerald-700 hover:bg-emerald-600 disabled:opacity-50 rounded font-semibold text-white"
        >
          {running ? "Running eval…" : "▶  Run Batch Eval"}
        </button>
      </div>

      {loading && <div className="text-xs text-zinc-500">Loading…</div>}

      {triage && naive && (
        <>
          {/* Delta banner */}
          <div className="rounded border border-emerald-700 bg-emerald-950/30 p-4 flex items-center gap-4">
            <span className="text-2xl font-bold text-emerald-300">+{deltaRupees ? "₹" + deltaRupees.toLocaleString("en-IN") : "—"}</span>
            <div>
              <div className="text-sm text-zinc-200">Triage recovers more than naive on the same 100 cases</div>
              <div className="text-xs text-zinc-400">
                {triage.illegalRetries === 0 ? "✓ Zero illegal retries" : `✗ ${triage.illegalRetries} illegal retries`}
                &nbsp;·&nbsp;
                {triage.dndViolations === 0 ? "✓ Zero DND violations" : `✗ ${triage.dndViolations} DND violations`}
                &nbsp;·&nbsp;
                {triage.stopRuleHits} stop-rule vetoes
              </div>
            </div>
          </div>

          {/* Side-by-side stats */}
          <div className="grid grid-cols-2 gap-6">
            {/* Triage column */}
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <h2 className="text-sm font-bold text-emerald-400">TRIAGE AGENT</h2>
                <Badge label="Cause-conditioned" color="bg-emerald-900 text-emerald-300" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <StatCard label="Amount Recovered" value={fmt(triage.amountRecoveredPaise)} sub={`of ${fmt(triage.amountAtRiskPaise)} at risk`} highlight />
                <StatCard label="Recovery Rate" value={pct(triage.amountRecoveredPaise, triage.amountAtRiskPaise)} highlight />
                <StatCard label="Touches Sent" value={String(triage.touchesSent)} sub="vs 77 for naive" />
                <StatCard label="Stop Rule Hits" value={String(triage.stopRuleHits)} sub="correctly blocked" />
                <StatCard label="Illegal Retries" value={String(triage.illegalRetries)} sub={triage.illegalRetries === 0 ? "✓ clean" : "✗ bug"} />
                <StatCard label="DND Violations" value={String(triage.dndViolations)} sub={triage.dndViolations === 0 ? "✓ clean" : "✗ violation"} />
              </div>
            </div>

            {/* Naive column */}
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <h2 className="text-sm font-bold text-zinc-400">NAIVE BASELINE</h2>
                <Badge label="Retry everyone" color="bg-zinc-800 text-zinc-300" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <StatCard label="Amount Recovered" value={fmt(naive.amountRecoveredPaise)} sub={`of ${fmt(naive.amountAtRiskPaise)} at risk`} />
                <StatCard label="Recovery Rate" value={pct(naive.amountRecoveredPaise, naive.amountAtRiskPaise)} />
                <StatCard label="Touches Sent" value={String(naive.touchesSent)} sub="unnecessary outreach" />
                <StatCard label="Stop Rule Hits" value="—" sub="no stop rules" />
                <StatCard label="Illegal Retries" value={String(naive.illegalRetries)} sub={naive.illegalRetries > 0 ? "✗ retried revoked mandates" : "clean"} />
                <StatCard label="DND Violations" value={String(naive.dndViolations)} sub={naive.dndViolations > 0 ? "✗ messaged DND customers" : "clean"} />
              </div>
            </div>
          </div>

          {/* Why thesis */}
          <div className="rounded border border-zinc-800 bg-zinc-900 p-4 text-xs text-zinc-400 space-y-1">
            <div className="text-zinc-200 font-semibold mb-2">Why Triage wins</div>
            <div>· <code className="text-amber-400">bank_outage</code> → do nothing. Naive sends a payment link during a live outage — it always fails.</div>
            <div>· <code className="text-amber-400">mandate_revoked</code> → one-time Payment Link, never Autopay retry. Naive retries the dead mandate (illegal).</div>
            <div>· <code className="text-amber-400">insufficient_funds</code> → wait for salary window. Naive retries immediately on the empty account.</div>
            <div>· <code className="text-amber-400">customer_cancelled</code> → do nothing. Naive spams the customer who already said no.</div>
            <div>· <strong className="text-zinc-200">Policy wins over LLM.</strong> The LLM writes copy and explains — it never selects the money move.</div>
          </div>
        </>
      )}

      {!triage && !loading && (
        <div className="text-center py-16 text-zinc-500">
          <div className="text-4xl mb-4">⚡</div>
          <div className="text-sm mb-4">No eval run yet. Click <strong className="text-zinc-300">Run Batch Eval</strong> to process all 100 cases.</div>
        </div>
      )}

      {/* Link to cases */}
      {triage && (
        <div className="text-center pt-2">
          <Link href="/cases" className="text-xs text-emerald-400 hover:text-emerald-300 underline">
            View all 100 cases with audit trails →
          </Link>
        </div>
      )}
    </div>
  );
}
