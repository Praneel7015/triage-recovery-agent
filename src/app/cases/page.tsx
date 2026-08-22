"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

interface Case {
  id: string;
  customerName: string;
  amountPaise: number;
  cause: string | null;
  actionTaken: string | null;
  stopCode: string | null;
  status: string;
  errorReason: string | null;
  paymentMethod: string;
  isDnd: boolean;
  isNaiveRun: boolean;
  touchCount: number;
  retryCount: number;
  updatedAt: number;
}

const STATUS_COLOR: Record<string, string> = {
  recovered:    "text-emerald-400",
  stopped:      "text-amber-400",
  in_progress:  "text-blue-400",
  escalated:    "text-purple-400",
  unrecoverable:"text-red-400",
  open:         "text-zinc-400",
};

const ACTION_COLOR: Record<string, string> = {
  do_nothing:                 "text-zinc-500",
  silent_retry_at_window:     "text-blue-400",
  send_one_time_payment_link: "text-emerald-400",
  send_method_update_link:    "text-cyan-400",
  offer_pause:                "text-purple-400",
  hinglish_voice_script:      "text-orange-400",
  escalate_human:             "text-red-400",
};

export default function CasesPage() {
  const [allCases, setAllCases] = useState<Case[]>([]);
  const [filter, setFilter] = useState<"triage" | "naive">("triage");
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    fetch(`/api/cases?strategy=${filter}`)
      .then(r => r.json())
      .then(data => { setAllCases(Array.isArray(data) ? data : []); setLoading(false); })
      .catch(() => setLoading(false));
  }, [filter]);

  const visible = allCases.filter(c =>
    !search ||
    c.customerName.toLowerCase().includes(search.toLowerCase()) ||
    c.cause?.includes(search) ||
    c.id.includes(search)
  );

  return (
    <div className="max-w-6xl mx-auto space-y-4">
      <div className="flex items-center gap-4 flex-wrap">
        <h1 className="text-lg font-bold text-zinc-100">Cases</h1>
        <div className="flex gap-2">
          {(["triage","naive"] as const).map(s => (
            <button key={s} onClick={() => setFilter(s)}
              className={`text-xs px-3 py-1 rounded ${filter === s ? "bg-zinc-700 text-zinc-100" : "text-zinc-500 hover:text-zinc-300"}`}
            >{s}</button>
          ))}
        </div>
        <input
          placeholder="Search name / cause / id…"
          value={search} onChange={e => setSearch(e.target.value)}
          className="ml-auto text-xs bg-zinc-900 border border-zinc-700 rounded px-3 py-1 w-64 focus:outline-none focus:border-zinc-500"
        />
        <Link href="/" className="text-xs text-zinc-500 hover:text-zinc-300">← Scoreboard</Link>
      </div>

      {loading && <div className="text-xs text-zinc-500">Loading…</div>}

      <div className="rounded border border-zinc-800 overflow-hidden">
        <table className="w-full text-xs">
          <thead className="bg-zinc-900 text-zinc-400">
            <tr>
              <th className="px-3 py-2 text-left">Customer</th>
              <th className="px-3 py-2 text-right">Amount</th>
              <th className="px-3 py-2 text-left">Cause</th>
              <th className="px-3 py-2 text-left">Action</th>
              <th className="px-3 py-2 text-left">Stop</th>
              <th className="px-3 py-2 text-left">Status</th>
              <th className="px-3 py-2 text-center">DND</th>
              <th className="px-3 py-2 text-right">Retries</th>
              <th className="px-3 py-2"></th>
            </tr>
          </thead>
          <tbody>
            {visible.map((c, i) => (
              <tr key={c.id} className={`border-t border-zinc-800 hover:bg-zinc-900/50 ${i % 2 === 0 ? "" : "bg-zinc-900/20"}`}>
                <td className="px-3 py-2">{c.customerName}</td>
                <td className="px-3 py-2 text-right">₹{(c.amountPaise/100).toLocaleString("en-IN")}</td>
                <td className="px-3 py-2 text-amber-400">{c.cause ?? c.errorReason ?? "—"}</td>
                <td className={`px-3 py-2 ${ACTION_COLOR[c.actionTaken ?? ""] ?? "text-zinc-400"}`}>{c.actionTaken ?? "—"}</td>
                <td className="px-3 py-2 text-zinc-500">{c.stopCode ?? "—"}</td>
                <td className={`px-3 py-2 font-semibold ${STATUS_COLOR[c.status] ?? "text-zinc-400"}`}>{c.status}</td>
                <td className="px-3 py-2 text-center">{c.isDnd ? <span className="text-red-400">✗</span> : <span className="text-zinc-600">—</span>}</td>
                <td className="px-3 py-2 text-right">{c.retryCount}</td>
                <td className="px-3 py-2">
                  <Link href={`/cases/${c.id}`} className="text-emerald-500 hover:text-emerald-300">→</Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {!loading && visible.length === 0 && (
          <div className="text-center py-8 text-zinc-500 text-xs">No cases found. Run batch eval first.</div>
        )}
      </div>
    </div>
  );
}
