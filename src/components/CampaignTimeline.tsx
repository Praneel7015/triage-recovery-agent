"use client";

import { labelAction } from "@/lib/format";

export interface CampaignStepRow {
  id: string;
  day: number;
  stepIndex: number;
  action: string;
  channel: string;
  costPaise: number;
  rationale: string | null;
  blocked: boolean;
  stopCode: string | null;
  stopReason: string | null;
  outcome: string;
  outcomeReason: string | null;
  replyText: string | null;
  intent: string | null;
  intentConfidence: number | null;
  intentMethod: string | null;
  promiseDate: string | null;
  voiceScript: string | null;
  outreachCopy: string | null;
}

export function CampaignTimeline({ steps }: { steps: CampaignStepRow[] }) {
  if (steps.length === 0) {
    return (
      <div className="panel-inset dim" style={{ fontSize: "0.85rem" }}>
        No campaign steps recorded. Run a batch eval to populate the timeline.
      </div>
    );
  }

  return (
    <div className="timeline" aria-label="Campaign timeline">
      {steps.map((s) => {
        const cls =
          s.outcome === "recovered"
            ? "timeline-step recovered"
            : s.blocked
              ? "timeline-step blocked"
              : "timeline-step";

        return (
          <article key={s.id} className={cls}>
            <div className="timeline-day">Day {s.day} · step {s.stepIndex + 1}</div>
            <div className="timeline-action">
              {labelAction(s.action)}
              <span className="badge badge-forest" style={{ marginLeft: "0.5rem" }}>
                {s.channel}
              </span>
              {s.blocked && (
                <span className="badge badge-warn" style={{ marginLeft: "0.35rem" }}>
                  blocked
                </span>
              )}
            </div>
            {s.rationale && <p className="timeline-rationale">{s.rationale}</p>}
            <p className="dim" style={{ fontSize: "0.75rem", margin: "0.35rem 0 0" }}>
              {s.outcomeReason}
              {s.costPaise > 0 && (
                <span className="data" style={{ marginLeft: "0.5rem" }}>
                  · ₹{(s.costPaise / 100).toFixed(2)} spend
                </span>
              )}
            </p>
            {s.replyText && (
              <blockquote className="timeline-reply">
                &ldquo;{s.replyText}&rdquo;
                {s.intent && (
                  <footer style={{ marginTop: "0.4rem", fontStyle: "normal", fontSize: "0.72rem" }}>
                    Intent: <strong>{s.intent.replace(/_/g, " ")}</strong>
                    {s.promiseDate && ` · pay by ${s.promiseDate}`}
                    {s.intentConfidence != null && ` · ${(s.intentConfidence * 100).toFixed(0)}%`}
                    {s.intentMethod && ` · via ${s.intentMethod}`}
                  </footer>
                )}
              </blockquote>
            )}
            {s.voiceScript && (
              <p className="panel-inset" style={{ marginTop: "0.65rem", fontSize: "0.82rem" }}>
                <span className="eyebrow" style={{ display: "block", marginBottom: "0.35rem" }}>
                  Voice script
                </span>
                {s.voiceScript}
              </p>
            )}
            {s.outreachCopy && (
              <p className="panel-inset" style={{ marginTop: "0.65rem", fontSize: "0.82rem" }}>
                <span className="eyebrow" style={{ display: "block", marginBottom: "0.35rem" }}>
                  AI outreach copy
                </span>
                {s.outreachCopy}
              </p>
            )}
          </article>
        );
      })}
    </div>
  );
}
