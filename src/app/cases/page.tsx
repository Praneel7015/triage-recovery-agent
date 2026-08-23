"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { rupees, labelCause, labelAction, labelStatus } from "@/lib/format";

interface CaseRow {
  id: string;
  customerName: string;
  amountPaise: number;
  cause: string | null;
  actionTaken: string | null;
  status: string;
  segment: string;
  isDnd: boolean;
  isHoldout: boolean;
  isNaiveRun: boolean;
  stepCount: number;
  recoveredOnDay: number | null;
  totalCostPaise: number;
}

export default function CasesPage() {
  const [cases, setCases] = useState<CaseRow[]>([]);
  const [filter, setFilter] = useState<"triage" | "naive">("triage");
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    setLoadError(null);
    fetch(`/api/cases?strategy=${filter}`)
      .then((r) => {
        if (!r.ok) throw new Error("Could not load cases");
        return r.json();
      })
      .then((d) => { setCases(Array.isArray(d) ? d : []); setLoading(false); })
      .catch((err) => { setLoadError(err.message ?? "Failed to load"); setLoading(false); });
  }, [filter]);

  const visible = cases.filter(
    (c) =>
      !search ||
      c.customerName.toLowerCase().includes(search.toLowerCase()) ||
      c.cause?.includes(search) ||
      c.id.includes(search),
  );

  return (
    <div className="page">
      <header style={{ marginBottom: "1.75rem" }}>
        <p className="eyebrow">Case registry</p>
        <h1 className="display" style={{ fontSize: "1.85rem", margin: "0.35rem 0 0.5rem" }}>
          Revenue at risk
        </h1>
        <p className="muted" style={{ margin: 0, fontSize: "0.88rem" }}>
          Each row is an open case file — diagnosis, campaign steps, and audit trail inside.
        </p>
      </header>

      <div className="filters">
        <div className="filter-tabs" role="tablist">
          {(["triage", "naive"] as const).map((s) => (
            <button
              key={s}
              type="button"
              role="tab"
              aria-selected={filter === s}
              className={`filter-tab${filter === s ? " active" : ""}`}
              onClick={() => setFilter(s)}
            >
              {s}
            </button>
          ))}
        </div>
        <input
          type="search"
          className="search-input"
          placeholder="Search customer, cause, or case id…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          aria-label="Search cases"
        />
        <Link href="/" className="btn btn-ghost" style={{ padding: "0.5rem 0.85rem", fontSize: "0.75rem" }}>
          ← Ledger
        </Link>
      </div>

      <div className="panel" style={{ padding: 0, overflow: "hidden" }}>
        {loadError ? (
          <p className="dim" style={{ padding: "2rem" }}>{loadError}</p>
        ) : loading ? (
          <p className="dim" style={{ padding: "2rem" }}>Loading case files…</p>
        ) : visible.length === 0 ? (
          <div className="empty" style={{ padding: "2.5rem" }}>
            <h2>No cases yet</h2>
            <p>Run a batch eval from the ledger to populate the registry.</p>
            <Link href="/" className="btn btn-primary">Go to ledger</Link>
          </div>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table className="registry">
              <thead>
                <tr>
                  <th>Customer</th>
                  <th>Segment</th>
                  <th className="amount">Amount</th>
                  <th>Cause</th>
                  <th>Action</th>
                  <th>Status</th>
                  <th>Steps</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {visible.map((c) => (
                  <tr key={c.id}>
                    <td>
                      <strong>{c.customerName}</strong>
                      {c.isHoldout && <span className="badge badge-warn" style={{ marginLeft: "0.4rem" }}>holdout</span>}
                      {c.isDnd && <span className="badge badge-danger" style={{ marginLeft: "0.4rem" }}>dnd</span>}
                    </td>
                    <td><span className="badge badge-forest">{c.segment?.replace(/_/g, " ") ?? "—"}</span></td>
                    <td className="amount">{rupees(c.amountPaise)}</td>
                    <td className="muted">{labelCause(c.cause)}</td>
                    <td>{labelAction(c.actionTaken)}</td>
                    <td className={`status-${c.status}`}>{labelStatus(c.status)}</td>
                    <td className="data">{c.stepCount}</td>
                    <td>
                      <Link href={`/cases/${c.id}`} className="btn btn-ghost" style={{ padding: "0.35rem 0.65rem", fontSize: "0.72rem" }}>
                        Open
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
