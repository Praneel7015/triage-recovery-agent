import { CAUSE_LABELS } from "@/engine/taxonomy";
import { ACTION_LABELS } from "@/engine/policy";

export function rupees(paise: number, opts?: { compact?: boolean }) {
  const n = paise / 100;
  if (opts?.compact && Math.abs(n) >= 100_000) {
    return "₹" + (n / 100_000).toFixed(1) + "L";
  }
  return "₹" + n.toLocaleString("en-IN", { maximumFractionDigits: 0 });
}

export function pct(num: number, den: number) {
  if (!den) return "—";
  return ((num / den) * 100).toFixed(1) + "%";
}

export function pp(n: number) {
  return (n >= 0 ? "+" : "") + n.toFixed(1) + " pp";
}

export function labelCause(cause: string | null) {
  if (!cause) return "Unknown";
  return CAUSE_LABELS[cause as keyof typeof CAUSE_LABELS] ?? cause.replace(/_/g, " ");
}

export function labelAction(action: string | null) {
  if (!action) return "—";
  return ACTION_LABELS[action as keyof typeof ACTION_LABELS] ?? action.replace(/_/g, " ");
}

export function labelStatus(status: string) {
  return status.replace(/_/g, " ");
}
