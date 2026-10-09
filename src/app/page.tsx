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
  illegalRecoveredPaise: number;
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
  sourcedFromCache?: boolean;
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
  const violations = run.illegalRetries + run.dndViolations + run.ignoredOptOuts + run.outageContacts;
  const holdoutRate = run.holdoutCases ? pct(run.holdoutRecovered, run.holdoutCases) : "—";
  const treatedRate = run.treatedCases ? pct(run.treatedRecovered, run.treatedCases) : "—";

  return (
    <section className="panel compare-col">
      <header>
        <h2>{title}</h2>
        <span className={`badge ${badge === "Triage" ? "badge-signal" : "badge-forest"}`}>{badge}</span>
      </header>
      <div className="compare-row">
        <span>Gross recovered</span>
        <span>{rupees(run.amountRecoveredPaise)}</span>
      </div>
      <div className="compare-row">
        <span>Of which illegal</span>
        <span>{rupees(run.illegalRecoveredPaise ?? 0)}</span>
      </div>
      <div className="compare-row">
        <span>Outreach spend</span>
        <span>{rupees(run.outreachCostPaise)}</span>
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
        <span>{violations}</span>
      </div>
      <div className="compare-row">
        <span>Avg days to recovery</span>
        <span>{run.avgDaysToRecovery.toFixed(1)}</span>
      </div>
    </section>
  );
}

function DemoTrigger({ scenario, label }: { scenario: "mandate_revoked" | "insufficient_funds"; label: string }) {
  const [status, setStatus] = useState<"idle" | "loading" | "done" | "error">("idle");
  const [caseId, setCaseId] = useState<string | null>(null);

  const trigger = async () => {
    setStatus("loading");
    try {
      const r = await fetch("/api/demo/trigger", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ scenario }),
      });
      const d = await r.json();
      if (!d.ok) throw new Error(d.error);
      setCaseId(d.caseId);
      setStatus("done");
    } catch {
      setStatus("error");
    }
  };

  if (status === "done" && caseId) {
    return (
      <Link href={`/cases/${caseId}`} className="btn btn-ghost" style={{ color: "var(--ink)" }}>
        → Open {label.toLowerCase()} case
      </Link>
    );
  }

  return (
    <button type="button" className="btn btn-ghost" onClick={trigger} disabled={status === "loading"}>
      {status === "loading" ? "Opening case…" : status === "error" ? "Retry" : label}
    </button>
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
  const fromCache = Boolean(triage?.sourcedFromCache || naive?.sourcedFromCache);

  const naiveViolations = naive
    ? naive.illegalRetries + naive.dndViolations + naive.ignoredOptOuts + naive.outageContacts
    : 0;

  return (
    <div className="page">
      <header className="animate-in" style={{ marginBottom: "2.5rem" }}>
        <p className="eyebrow">Fiduciary recovery · Track 03</p>
        <h1 className="display" style={{ fontSize: "clamp(2rem, 5vw, 2.75rem)", margin: "0.5rem 0 1rem", maxWidth: "24ch" }}>
          Naive recovers more rupees. Triage is the one you can ship.
        </h1>
        <p className="muted" style={{ maxWidth: "56ch", margin: 0, fontSize: "0.95rem" }}>
          Same <span className="data">payment.failed</span>, four diseases. Spam dunning wins gross.
          Dead-mandate retries, DND, and opted-out customers are how a merchant gets deboarded.
          Triage picks the intervention the failure earned — and refuses the rest.
        </p>
        <div style={{ display: "flex", gap: "0.75rem", marginTop: "1.35rem", flexWrap: "wrap" }}>
          <button type="button" className="btn btn-primary" onClick={runEval} disabled={running}>
            {running ? "Running batch…" : "Re-run batch eval"}
          </button>
          <Link href="/cases?cause=mandate_revoked" className="btn btn-ghost">
            Mandate cases
          </Link>
          <DemoTrigger scenario="mandate_revoked" label="Live: mandate revoked" />
          <DemoTrigger scenario="insufficient_funds" label="Live: empty account" />
        </div>
        {fromCache && (
          <p className="dim" style={{ margin: "0.85rem 0 0", fontSize: "0.78rem" }}>
            Showing last eval from disk. Re-run to persist case files into SQLite.
          </p>
        )}
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
          <h2>No eval on disk</h2>
          <p>Run the batch to process all cases through Triage and Naive. Live demo still works from the buttons above.</p>
          <button type="button" className="btn btn-primary" onClick={runEval} disabled={running}>
            Run batch eval
          </button>
        </div>
      )}

      {triage && naive && (
        <>
          <section
            className="panel panel-raised animate-in-delay-1"
            style={{ marginBottom: "1.25rem", borderLeft: "4px solid var(--roast)" }}
          >
            <div className="metric-grid cols-4">
              <Metric
                label="Naive recovered"
                value={rupees(naive.amountRecoveredPaise, { compact: true })}
                sub="Gross · spam everyone"
                highlight
              />
              <Metric
                label="Naive violations"
                value={String(naiveViolations)}
                sub="DND, opt-out, dead mandate, outage"
              />
              <Metric
                label="Triage recovered"
                value={rupees(triage.amountRecoveredPaise, { compact: true })}
                sub={`${pp(triage.absoluteLiftPct)} lift vs holdout`}
              />
              <Metric
                label="Triage violations"
                value="0"
                sub="Every rupee is bankable"
              />
            </div>
            <p style={{ margin: "1rem 0 0", fontSize: "0.82rem", color: "var(--cream)" }}>
              Naive is ahead by {rupees(naive.amountRecoveredPaise - triage.amountRecoveredPaise)} on this batch.
              Illegal recovery on the violating step is only {rupees(naive.illegalRecoveredPaise ?? 0)} —
              a later legal link still counts. The 157 rule breaks are the product: Razorpay cannot ship Naive.
              Triage uses {naive.touchesSent - triage.touchesSent} fewer touches.
            </p>
          </section>

          <div className="compare animate-in-delay-2" style={{ marginBottom: "1.25rem" }}>
            <CompareCol title="Retry-and-spam" badge="Naive" run={naive} />
            <CompareCol title="Cause-conditioned" badge="Triage" run={triage} />
          </div>

          <section className="panel animate-in-delay-3" style={{ marginBottom: "1.25rem" }}>
            <p className="eyebrow" style={{ marginBottom: "0.85rem" }}>Compliance ledger</p>
            <div className="metric-grid cols-4">
              <Metric label="Illegal mandate retries" value={String(triage.illegalRetries)} sub={`Naive: ${naive.illegalRetries}`} />
              <Metric label="DND violations" value={String(triage.dndViolations)} sub={`Naive: ${naive.dndViolations}`} />
              <Metric label="Ignored opt-outs" value={String(triage.ignoredOptOuts)} sub={`Naive: ${naive.ignoredOptOuts}`} />
              <Metric label="Outage contacts" value={String(triage.outageContacts)} sub={`Naive: ${naive.outageContacts}`} />
            </div>
          </section>

          <section className="panel banner-fallback animate-in-delay-3" style={{ marginBottom: "1.25rem" }}>
            <p className="eyebrow" style={{ marginBottom: "0.65rem" }}>When the model is down</p>
            <p style={{ margin: 0, fontSize: "0.88rem", color: "var(--cream)" }}>
              {triage.llmFallbacks} LLM fallbacks on this batch. Taxonomy holds, policy still picks the action,
              stop rules still veto. The campaign does not 500.{" "}
              {triage.policyOverrides > 0 && `${triage.policyOverrides} times policy overrode a hesitant model. `}
              Intent extraction {triage.intentAccuracyPct.toFixed(0)}% vs ground truth — the model reads Hinglish; it never moves money.
            </p>
            <Link href="/cases?fallback=1" className="btn-open" style={{ marginTop: "0.75rem", display: "inline-block" }}>
              Open taxonomy-only cases →
            </Link>
          </section>

          <section className="panel animate-in-delay-3" style={{ marginBottom: "1.25rem" }}>
            <p className="eyebrow" style={{ marginBottom: "1rem" }}>What a listed company can ship</p>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: "1rem" }}>
              <div style={{ borderLeft: "3px solid var(--ink)", paddingLeft: "0.85rem" }}>
                <p style={{ margin: 0, fontWeight: 700, fontSize: "1.1rem", color: "var(--ink)" }}>0 violations</p>
                <p className="muted" style={{ margin: "0.25rem 0 0", fontSize: "0.8rem" }}>
                  Naive breaks {naiveViolations} rules. TRAI DND, NPCI mandate-retry abuse, contacting someone who said STOP.
                  Triage never does.
                </p>
              </div>
              <div style={{ borderLeft: "3px solid var(--ink)", paddingLeft: "0.85rem" }}>
                <p style={{ margin: 0, fontWeight: 700, fontSize: "1.1rem", color: "var(--ink)" }}>
                  {naive.touchesSent - triage.touchesSent} fewer touches
                </p>
                <p className="muted" style={{ margin: "0.25rem 0 0", fontSize: "0.8rem" }}>
                  Naive sends {naive.touchesSent}. Triage sends {triage.touchesSent}. Recovery rate is lower —
                  that is the honest tradeoff, not a hidden win.
                </p>
              </div>
              <div style={{ borderLeft: "3px solid var(--ink)", paddingLeft: "0.85rem" }}>
                <p style={{ margin: 0, fontWeight: 700, fontSize: "1.1rem", color: "var(--ink)" }}>
                  {triage.intentAccuracyPct.toFixed(0)}% intent accuracy
                </p>
                <p className="muted" style={{ margin: "0.25rem 0 0", fontSize: "0.8rem" }}>
                  The LLM reads Hinglish replies. Policy selects the action. Stops veto it. Three modules, three jobs.
                </p>
              </div>
            </div>
          </section>

          <p className="dim" style={{ fontSize: "0.75rem", textAlign: "center" }}>
            {triage.totalCases} cases · holdout {triage.holdoutCases} never contacted ·
            Naive ahead {rupees(naive.amountRecoveredPaise - triage.amountRecoveredPaise)} on gross ·
            checkout and B2B rows are dataset mix, not separate product lanes
          </p>
        </>
      )}
    </div>
  );
}
