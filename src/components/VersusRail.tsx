"use client";

import Link from "next/link";
import { labelAction, labelStatus } from "@/lib/format";

export interface Counterpart {
  id: string;
  isNaiveRun: boolean;
  actionTaken: string | null;
  status: string;
  stopCode: string | null;
  cause: string | null;
  recoveredAmountPaise: number;
  violationCount: number;
  campaignSteps: Array<{
    day: number;
    action: string;
    blocked: boolean;
    outcomeReason: string | null;
  }>;
}

function firstAction(c: { actionTaken: string | null; campaignSteps: Counterpart["campaignSteps"] }) {
  return c.campaignSteps[0]?.action ?? c.actionTaken;
}

export function VersusRail({
  selfIsNaive,
  selfAction,
  selfStatus,
  selfViolations,
  cause,
  counterpart,
}: {
  selfIsNaive: boolean;
  selfAction: string | null;
  selfStatus: string;
  selfViolations: number;
  cause: string | null;
  counterpart: Counterpart;
}) {
  const triage = selfIsNaive
    ? { action: firstAction(counterpart), status: counterpart.status, violations: counterpart.violationCount, href: `/cases/${counterpart.id}` }
    : { action: selfAction, status: selfStatus, violations: selfViolations, href: null };
  const naive = selfIsNaive
    ? { action: selfAction, status: selfStatus, violations: selfViolations, href: null }
    : { action: firstAction(counterpart), status: counterpart.status, violations: counterpart.violationCount, href: `/cases/${counterpart.id}` };

  const mandate = cause === "mandate_revoked";

  return (
    <section className="panel versus-rail">
      <p className="eyebrow" style={{ marginBottom: "0.75rem" }}>Same failure · two interventions</p>
      {mandate && (
        <p style={{ margin: "0 0 0.85rem", fontSize: "0.82rem", color: "var(--cream)" }}>
          Mandate is dead. Naive silent-retries it (illegal). Triage sends a one-time Payment Link.
        </p>
      )}
      <div className="versus-grid">
        <div>
          <p className="versus-label">Triage</p>
          <p className="versus-action">{labelAction(triage.action)}</p>
          <p className="muted" style={{ margin: "0.25rem 0 0", fontSize: "0.75rem" }}>
            {labelStatus(triage.status)} · {triage.violations} violations
          </p>
          {triage.href && (
            <Link href={triage.href} className="btn-open" style={{ marginTop: "0.5rem", display: "inline-block" }}>
              Open Triage →
            </Link>
          )}
        </div>
        <div>
          <p className="versus-label">Naive</p>
          <p className="versus-action">{labelAction(naive.action)}</p>
          <p className="muted" style={{ margin: "0.25rem 0 0", fontSize: "0.75rem" }}>
            {labelStatus(naive.status)} · {naive.violations} violations
          </p>
          {naive.href && (
            <Link href={naive.href} className="btn-open" style={{ marginTop: "0.5rem", display: "inline-block" }}>
              Open Naive →
            </Link>
          )}
        </div>
      </div>
    </section>
  );
}
