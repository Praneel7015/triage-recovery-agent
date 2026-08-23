import "dotenv/config";
import { readFileSync } from "fs";
import { runCampaign, type CampaignResult, type CampaignStep } from "@/engine/sequencer";
import { MAX_CAMPAIGN_DAYS, MAX_TOUCHES, NPCI_MAX_RETRIES, AMOUNT_FLOOR_PAISE } from "@/engine/stops";
import { MAX_STEPS } from "@/engine/sequencer";
import type { CaseInput } from "@/engine/agent";

/**
 * Compliance as code.
 *
 * These are invariants, not metrics. A recovery agent that is 99% compliant is
 * not 99% good — it is a regulatory incident with good averages. Each property
 * below is asserted against every campaign in the batch, and any single breach
 * fails the run, so a policy regression cannot be shipped quietly.
 */

interface Violation {
  property: string;
  caseId: string;
  detail: string;
}

type Property = {
  id: string;
  statement: string;
  /** Returns a violation detail string, or null when the case is compliant. */
  check: (r: CampaignResult, c: CaseInput) => string | null;
};

const CONTACT_CHANNELS = new Set(["email", "sms", "whatsapp", "voice", "human"]);
const executed = (r: CampaignResult) => r.steps.filter(s => !s.blocked);
const contacts = (r: CampaignResult) => executed(r).filter(s => CONTACT_CHANNELS.has(s.channel));

const PROPERTIES: Property[] = [
  {
    id: "P1",
    statement: "A customer on DND is never contacted on any channel.",
    check: (r, c) => {
      if (!c.isDnd) return null;
      const bad = contacts(r);
      return bad.length ? `${bad.length} contact(s) despite DND: ${bad.map(s => `day ${s.day} ${s.channel}`).join(", ")}` : null;
    },
  },
  {
    id: "P2",
    statement: "Once a customer opts out, no further contact is ever made.",
    check: (r) => {
      const optOutStep = r.steps.findIndex(s => s.intent?.intent === "opt_out");
      if (optOutStep === -1) return null;
      const after = r.steps.slice(optOutStep + 1).filter(s => !s.blocked && CONTACT_CHANNELS.has(s.channel));
      return after.length ? `${after.length} contact(s) after the opt-out on day ${r.steps[optOutStep].day}` : null;
    },
  },
  {
    id: "P3",
    statement: "A revoked mandate is never retried for auto-debit.",
    check: (r) => {
      if (r.cause !== "mandate_revoked") return null;
      const bad = executed(r).filter(s => s.action === "silent_retry_at_window");
      return bad.length ? `${bad.length} auto-debit retry against a revoked mandate` : null;
    },
  },
  {
    id: "P4",
    statement: `Auto-debit retries never exceed the NPCI cap of ${NPCI_MAX_RETRIES}.`,
    check: (r, c) => {
      const retries = executed(r).filter(s => s.action === "silent_retry_at_window").length + (c.retryCount ?? 0);
      return retries > NPCI_MAX_RETRIES ? `${retries} total retries exceeds the cap of ${NPCI_MAX_RETRIES}` : null;
    },
  },
  {
    id: "P5",
    statement: `No campaign makes more than ${MAX_TOUCHES} outreach contacts.`,
    check: (r, c) => {
      const total = contacts(r).length + (c.touchCount ?? 0);
      return total > MAX_TOUCHES ? `${total} outreach contacts exceeds the cap of ${MAX_TOUCHES}` : null;
    },
  },
  {
    id: "P6",
    statement: "No customer is contacted before a promise-to-pay date they gave.",
    check: (r) => {
      let promiseDay: number | null = null;
      for (const s of r.steps) {
        if (promiseDay !== null && !s.blocked && CONTACT_CHANNELS.has(s.channel) && s.day < promiseDay) {
          return `contacted on day ${s.day} despite a promise covering day ${promiseDay}`;
        }
        if (s.intent?.intent === "promise_to_pay" && s.intent.promiseDate) {
          const d = new Date(s.intent.promiseDate);
          if (!isNaN(d.getTime())) {
            promiseDay = s.day + Math.max(0, Math.round((d.getTime() - Date.now()) / 86400_000) - s.day);
            promiseDay = Math.max(s.day, Math.round((d.getTime() - Date.now()) / 86400_000));
          }
        }
      }
      return null;
    },
  },
  {
    id: "P7",
    statement: "Voice calls are only placed to customers who consented to voice.",
    check: (r, c) => {
      if (c.hasConsented) return null;
      const bad = executed(r).filter(s => s.channel === "voice");
      return bad.length ? `${bad.length} voice call(s) without consent` : null;
    },
  },
  {
    id: "P8",
    statement: "Customers are not contacted while a bank or PSP outage is live.",
    check: (r, c) => {
      if (!c.bankOutageActive) return null;
      // Step 0 is the only step where the outage is still assumed live.
      const bad = executed(r).filter(s => s.stepIndex === 0 && CONTACT_CHANNELS.has(s.channel));
      return bad.length ? `contacted on day ${bad[0].day} while the outage was live` : null;
    },
  },
  {
    id: "P9",
    statement: `Campaigns never run past their ${MAX_CAMPAIGN_DAYS}-day bound.`,
    check: (r) => {
      const over = executed(r).filter(s => s.day > MAX_CAMPAIGN_DAYS);
      return over.length ? `step executed on day ${over[0].day}` : null;
    },
  },
  {
    id: "P10",
    statement: `Campaigns never exceed ${MAX_STEPS} ladder steps.`,
    check: (r) => (r.steps.length > MAX_STEPS ? `${r.steps.length} steps` : null),
  },
  {
    id: "P11",
    statement: "Amounts below the pursuit floor incur no outreach spend.",
    check: (r, c) => {
      if (c.amountPaise >= AMOUNT_FLOOR_PAISE) return null;
      return r.totalCostPaise > 0 ? `spent ${r.totalCostPaise} paise on a sub-floor amount` : null;
    },
  },
  {
    id: "P12",
    statement: "Outreach spend never exceeds 15% of the amount at risk.",
    check: (r) => {
      const ratio = r.totalCostPaise / r.amountPaise;
      return ratio > 0.15 ? `spent ${(ratio * 100).toFixed(1)}% of the amount at risk` : null;
    },
  },
  {
    id: "P13",
    statement: "Holdout cases are never contacted and never incur cost.",
    check: (r) => {
      if (!r.isHoldout) return null;
      if (r.steps.length > 0) return `holdout case executed ${r.steps.length} step(s)`;
      return r.totalCostPaise > 0 ? `holdout case incurred ${r.totalCostPaise} paise of spend` : null;
    },
  },
  {
    id: "P14",
    statement: "A disputed charge ends collection immediately.",
    check: (r) => {
      const idx = r.steps.findIndex(s => s.intent?.intent === "dispute");
      if (idx === -1) return null;
      const after = r.steps.slice(idx + 1).filter(s => !s.blocked && CONTACT_CHANNELS.has(s.channel));
      return after.length ? `${after.length} contact(s) after a dispute` : null;
    },
  },
  {
    id: "P15",
    statement: "Every executed step has a recorded rationale and an audit entry.",
    check: (r) => {
      const noReason = executed(r).filter(s => !s.rationale || s.rationale.trim() === "");
      if (noReason.length) return `${noReason.length} step(s) with no rationale`;
      return r.auditTrail.length === 0 ? "campaign produced no audit trail" : null;
    },
  },
];

async function main() {
  const batchPath = process.argv[2] ?? "./data/batch.json";
  const batch: CaseInput[] = JSON.parse(readFileSync(batchPath, "utf-8"));

  console.log("\n" + "═".repeat(70));
  console.log("  COMPLIANCE PROPERTIES — asserted over every campaign in the batch");
  console.log("═".repeat(70) + "\n");

  const runs: Array<{ r: CampaignResult; c: CaseInput }> = [];
  process.stdout.write("  Running campaigns");
  for (let i = 0; i < batch.length; i++) {
    runs.push({ r: await runCampaign(batch[i]), c: batch[i] });
    if (i % 20 === 0) process.stdout.write(".");
  }
  process.stdout.write(` ${runs.length} done\n\n`);

  const violations: Violation[] = [];

  for (const p of PROPERTIES) {
    let checked = 0;
    let failed = 0;
    for (const { r, c } of runs) {
      const detail = p.check(r, c);
      checked++;
      if (detail) {
        failed++;
        violations.push({ property: p.id, caseId: r.caseId, detail });
      }
    }
    const mark = failed === 0 ? "PASS" : "FAIL";
    console.log(`  [${mark}] ${p.id.padEnd(4)} ${p.statement}`);
    if (failed > 0) {
      console.log(`         ${failed} of ${checked} campaigns violated this.`);
    }
  }

  console.log("\n" + "─".repeat(70));
  if (violations.length === 0) {
    console.log(`  All ${PROPERTIES.length} properties hold across all ${runs.length} campaigns.`);
    console.log("─".repeat(70) + "\n");
    process.exit(0);
  }

  console.log(`  ${violations.length} violation(s) found:\n`);
  for (const v of violations.slice(0, 25)) {
    console.log(`    ${v.property}  ${v.caseId}  ${v.detail}`);
  }
  if (violations.length > 25) console.log(`    ... and ${violations.length - 25} more`);
  console.log("─".repeat(70) + "\n");
  process.exit(1);
}

main().catch(e => { console.error(e); process.exit(1); });
