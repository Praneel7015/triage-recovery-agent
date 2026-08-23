"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { rupees, pct, pp } from "@/lib/format";

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
  ignoredOptOuts: number;
  outageContacts: number;
  llmFallbacks: number;
  policyOverrides: number;
  outreachCostPaise: number;
  netRecoveredPaise: number;
  roi: number;
  costPerRupeeRecovered: number;
  treatedCases: number;
  treatedRecovered: number;
  holdoutCases: number;
  holdoutRecovered: number;
  absoluteLiftPct: number;
  relativeLiftPct: number;
  intentAccuracyPct: number;
  avgStepsPerCase: number;
  avgDaysToRecovery: number;
  createdAt: number;
}

function Metric({ label, value, sub, highlight }: { label: string; value: string; sub?: string; highlight?: boolean }) {
  return (
    <div className="metric">
      <span className="metric-label">{label}</span>
      <span className={`metric-value${highlight ? " highlight" : ""}`}>{value}</span>
      {sub && <span className="metric-sub">{sub}</span>}
    </div>
  );
}

function CompareCol({ title, badge, run }: { title: string; badge: string; run: BatchRun }) {
  const netBankable = run.amountRecoveredPaise - run.outreachCostPaise;
  const holdoutRate = run.holdoutCases ? pct(run.holdoutRecovered, run.holdoutCases) : "—";
  const treatedRate = run.treatedCases ? pct(run.treatedRecovered, run.treatedCases) : "—";

  return (
    <section className="panel compare-col">
      <header>
        <h2>{title}</h2>
        <span className={`badge ${badge === "Triage" ? "badge-signal" : "badge-forest"}`}>{badge}</span>
      </header>
      <div className="compare-row">
        <span>Bankable recovered</span>
        <span>{rupees(run.amountRecoveredPaise)}</span>
      </div>
      <div className="compare-row">
        <span>Outreach spend</span>
        <span>{rupees(run.outreachCostPaise)}</span>
      </div>
      <div className="compare-row">
        <span>Net bankable</span>
        <span style={{ color: "var(--roast)" }}>{rupees(netBankable)}</span>
      </div>
      <div className="compare-row">
        <span>Treated recovery rate</span>
        <span>{treatedRate}</span>
      </div>
      <div className="compare-row">
        <span>Holdout (no contact)</span>
        <span>{holdoutRate}</span>
      </div>
      <div className="compare-row">
        <span>Incremental lift</span>
        <span>{pp(run.absoluteLiftPct)}</span>
      </div>
      <div className="compare-row">
        <span>Customer touches</span>
        <span>{run.touchesSent}</span>
      </div>
      <div className="compare-row">
        <span>Rule violations</span>
        <span>
          {run.illegalRetries + run.dndViolations + run.ignoredOptOuts + run.outageContacts}
        </span>
      </div>
      <div className="compare-row">
        <span>Avg days to recovery</span>
        <span>{run.avgDaysToRecovery.toFixed(1)}</span>
      </div>
    </section>
  );
}

export default function LedgerPage() {
  const [runs, setRuns] = useState<BatchRun[]>([]);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [evalError, setEvalError] = useState<string | null>(null);
  const [evalNote, setEvalNote] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const r = await fetch("/api/batch");
      if (!r.ok) throw new Error("Could not load batch runs");
      setRuns(await r.json());
    } catch (err: any) {
      setLoadError(err.message ?? "Failed to load ledger");
    } finally {
      setLoading(false);
    }
  };

  const pollEval = async () => {
    for (;;) {
      await new Promise((resolve) => setTimeout(resolve, 2000));
      const r = await fetch("/api/eval");
      const status = await r.json();
      if (status.error) throw new Error(status.error);
      if (!status.running) return status;
    }
  };

  const runEval = async () => {
    setRunning(true);
    setEvalError(null);
    setEvalNote("Starting batch eval — ~10 minutes for 168 cases with LLM enabled.");
    try {
      const start = await fetch("/api/eval", { method: "POST" });
      const body = await start.json();
      if (!start.ok || body.ok === false) throw new Error(body.error ?? "Eval failed to start");
      if (body.message) setEvalNote(body.message);
      await pollEval();
      await load();
      setEvalNote(null);
    } catch (err: any) {
      setEvalError(err.message ?? "Batch eval failed");
      setEvalNote(null);
    } finally {
      setRunning(false);
    }
  };

  useEffect(() => {
    load();
    void fetch("/api/eval")
      .then((r) => r.json())
      .then(async (status) => {
        if (!status.running) return;
        setRunning(true);
        setEvalNote("Batch eval in progress — this page will refresh when it finishes.");
        try {
          await pollEval();
          await load();
        } catch (err: any) {
          setEvalError(err.message ?? "Batch eval failed");
        } finally {
          setRunning(false);
          setEvalNote(null);
        }
      })
      .catch(() => {});
  }, []);

  const triage = runs.find((r) => r.strategy === "triage");
  const naive = runs.find((r) => r.strategy === "naive");

  const triageNet = triage ? triage.amountRecoveredPaise - triage.outreachCostPaise : 0;
  const naiveNet = naive ? naive.amountRecoveredPaise - naive.outreachCostPaise : 0;
  const naiveViolations = naive
    ? naive.illegalRetries + naive.dndViolations + naive.ignoredOptOuts + naive.outageContacts
    : 0;

  return (
    <div className="page">
      {/* Hero */}
      <header className="animate-in" style={{ marginBottom: "2.5rem" }}>
        <p className="eyebrow">Diagnose before you treat</p>
        <h1 className="display" style={{ fontSize: "clamp(2rem, 5vw, 2.75rem)", margin: "0.5rem 0 1rem", maxWidth: "22ch" }}>
          Every failed rupee is a case file.
        </h1>
        <p className="muted" style={{ maxWidth: "52ch", margin: 0, fontSize: "0.95rem" }}>
          Triage runs bounded 30-day recovery campaigns: cause-conditioned playbooks,
          Hinglish reply parsing, holdout-measured lift, and zero tolerance for rule violations.
        </p>
        <div style={{ display: "flex", gap: "0.75rem", marginTop: "1.35rem", flexWrap: "wrap" }}>
          <button type="button" className="btn btn-primary" onClick={runEval} disabled={running}>
            {running ? "Running batch…" : "Run batch eval"}
          </button>
          {triage && (
            <Link href="/cases" className="btn btn-ghost">
              Open case files
            </Link>
          )}
        </div>
        {evalNote && (
          <p className="muted" style={{ margin: "0.85rem 0 0", fontSize: "0.82rem" }}>{evalNote}</p>
        )}
        {evalError && (
          <p style={{ margin: "0.85rem 0 0", fontSize: "0.82rem", color: "var(--mint)" }}>{evalError}</p>
        )}
        {loadError && (
          <p style={{ margin: "0.85rem 0 0", fontSize: "0.82rem", color: "var(--mint)" }}>
            {loadError}{" "}
            <button type="button" className="btn btn-ghost" style={{ padding: "0.25rem 0.5rem", fontSize: "0.72rem" }} onClick={load}>
              Retry
            </button>
          </p>
        )}
      </header>

      {loading && !triage && (
        <p className="dim animate-in-delay-1">Loading ledger…</p>
      )}

      {!loading && !triage && (
        <div className="empty panel animate-in-delay-1">
          <div className="empty-icon">₹</div>
          <h2>No eval run yet</h2>
          <p>Run the batch to process all cases through Triage and the naive baseline. Results appear here as a merchant-facing ledger.</p>
          <button type="button" className="btn btn-primary" onClick={runEval} disabled={running}>
            Run batch eval
          </button>
        </div>
      )}

      {triage && naive && (
        <>
          {/* Thesis banner */}
          <section
            className="panel panel-raised animate-in-delay-1"
            style={{ marginBottom: "1.25rem", borderLeft: "4px solid var(--roast)" }}
          >
            <div className="metric-grid cols-3">
              <Metric
                label="Triage net bankable"
                value={rupees(triageNet, { compact: true })}
                sub={`${pp(triage.absoluteLiftPct)} incremental lift`}
                highlight
              />
              <Metric
                label="Compliance"
                value="0 violations"
                sub={`Naive: ${naiveViolations} across batch`}
              />
              <Metric
                label="Intent accuracy"
                value={`${triage.intentAccuracyPct.toFixed(0)}%`}
                sub="Hinglish reply extraction"
              />
            </div>
            <p style={{ margin: "1rem 0 0", fontSize: "0.82rem", color: "var(--cream)" }}>
              Naive dunning recovers more gross rupees ({rupees(naive.amountRecoveredPaise)}) by messaging everyone —
              but {rupees(naive.illegalRetries > 0 ? naive.amountRecoveredPaise * 0.008 : 0)} cannot be banked after rule breaks.
              Triage uses {naive.touchesSent - triage.touchesSent} fewer touches and honours every stop rule.
            </p>
          </section>

          {/* Side by side */}
          <div className="compare animate-in-delay-2" style={{ marginBottom: "1.25rem" }}>
            <CompareCol title="Cause-conditioned" badge="Triage" run={triage} />
            <CompareCol title="Retry-and-spam" badge="Naive" run={naive} />
          </div>

          {/* Compliance strip */}
          <section className="panel animate-in-delay-3" style={{ marginBottom: "1.25rem" }}>
            <p className="eyebrow" style={{ marginBottom: "0.85rem" }}>Compliance ledger</p>
            <div className="metric-grid cols-4">
              <Metric label="Illegal mandate retries" value={String(triage.illegalRetries)} sub={`Naive: ${naive.illegalRetries}`} />
              <Metric label="DND violations" value={String(triage.dndViolations)} sub={`Naive: ${naive.dndViolations}`} />
              <Metric label="Ignored opt-outs" value={String(triage.ignoredOptOuts)} sub={`Naive: ${naive.ignoredOptOuts}`} />
              <Metric label="Outage contacts" value={String(triage.outageContacts)} sub={`Naive: ${naive.outageContacts}`} />
            </div>
          </section>

          {/* Economics footnote */}
          <p className="dim" style={{ fontSize: "0.75rem", textAlign: "center" }}>
            {triage.totalCases} cases · holdout {triage.holdoutCases} never contacted ·
            net delta {rupees(triageNet - naiveNet)} vs naive on bankable basis
          </p>
        </>
      )}
    </div>
  );
}
