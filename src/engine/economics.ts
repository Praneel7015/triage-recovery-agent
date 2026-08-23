import type { RecoveryAction } from "@/db/schema";

/**
 * Outreach unit economics.
 *
 * Every customer touch costs real money. Gross recovery is a vanity metric —
 * a campaign that recovers ₹100 by spending ₹120 destroyed value.
 * Triage optimises NET recovery, so the cost of a touch is first-class.
 *
 * Costs are in paise and reflect Indian market rates (2026).
 */

export type Channel =
  | "none"          // no customer contact
  | "retry"         // silent gateway retry, no contact
  | "email"
  | "sms"
  | "whatsapp"
  | "voice"         // automated TTS / IVR call
  | "human";        // live agent

/** Cost per outbound touch, in paise. */
export const CHANNEL_COST_PAISE: Record<Channel, number> = {
  none:      0,
  retry:     0,      // gateway retry is free to the merchant
  email:     2,      // ₹0.02
  sms:       15,     // ₹0.15  (transactional SMS)
  whatsapp:  35,     // ₹0.35  (WhatsApp Business template message)
  voice:     250,    // ₹2.50  (TTS call, ~45s at typical Indian telephony rates)
  human:     4500,   // ₹45.00 (agent ~5 min at a ₹540/hr fully-loaded cost)
};

/** Which channel each action uses. Determines what it costs to execute. */
export const ACTION_CHANNEL: Record<RecoveryAction, Channel> = {
  silent_retry_at_window:     "retry",
  send_method_update_link:    "whatsapp",
  send_one_time_payment_link: "whatsapp",
  offer_pause:                "whatsapp",
  hinglish_voice_script:      "voice",
  escalate_human:             "human",
  do_nothing:                 "none",
};

export function channelForAction(action: RecoveryAction): Channel {
  return ACTION_CHANNEL[action] ?? "none";
}

export function costOfAction(action: RecoveryAction): number {
  return CHANNEL_COST_PAISE[channelForAction(action)];
}

/**
 * Is this action worth executing on this amount?
 *
 * We refuse to spend more than `maxCostRatio` of the amount at risk on a single
 * touch. Chasing ₹50 with a ₹45 human call is value-destructive even if it works.
 */
export function isEconomicallySane(
  action: RecoveryAction,
  amountPaise: number,
  alreadySpentPaise = 0,
  maxCostRatio = 0.15,
): { sane: boolean; reason?: string } {
  const cost = costOfAction(action);
  if (cost === 0) return { sane: true };

  const totalSpend = alreadySpentPaise + cost;
  const ratio = totalSpend / amountPaise;

  if (ratio > maxCostRatio) {
    return {
      sane: false,
      reason:
        `Touch costs ₹${(cost / 100).toFixed(2)}; total spend ₹${(totalSpend / 100).toFixed(2)} ` +
        `would be ${(ratio * 100).toFixed(0)}% of the ₹${(amountPaise / 100).toFixed(0)} at risk ` +
        `(cap ${(maxCostRatio * 100).toFixed(0)}%).`,
    };
  }
  return { sane: true };
}

// ─── Aggregate reporting ─────────────────────────────────────────────────────

export interface EconomicsInput {
  grossRecoveredPaise: number;
  outreachCostPaise: number;
  amountAtRiskPaise: number;
  casesTouched: number;
}

export interface EconomicsReport {
  grossRecoveredPaise: number;
  outreachCostPaise: number;
  netRecoveredPaise: number;
  /** Paise spent per rupee recovered. Lower is better. */
  costPerRupeeRecovered: number;
  /** Gross recovered per rupee spent. Higher is better. */
  roi: number;
  avgCostPerTouchedCasePaise: number;
  /** Net recovery as a share of everything that was at risk. */
  netRecoveryRate: number;
}

export function report(input: EconomicsInput): EconomicsReport {
  const { grossRecoveredPaise, outreachCostPaise, amountAtRiskPaise, casesTouched } = input;
  const net = grossRecoveredPaise - outreachCostPaise;

  return {
    grossRecoveredPaise,
    outreachCostPaise,
    netRecoveredPaise: net,
    costPerRupeeRecovered: grossRecoveredPaise > 0 ? outreachCostPaise / grossRecoveredPaise : 0,
    roi: outreachCostPaise > 0 ? grossRecoveredPaise / outreachCostPaise : 0,
    avgCostPerTouchedCasePaise: casesTouched > 0 ? outreachCostPaise / casesTouched : 0,
    netRecoveryRate: amountAtRiskPaise > 0 ? net / amountAtRiskPaise : 0,
  };
}

export function formatRupees(paise: number): string {
  const sign = paise < 0 ? "-" : "";
  return sign + "₹" + Math.abs(paise / 100).toLocaleString("en-IN", { maximumFractionDigits: 2 });
}
