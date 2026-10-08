import { fmtDay, fmtMonth } from "./format";
import type { NextPrint } from "./types";

/** /cpi-preview's lead sentence: the call, the spread across forecasters and
 *  the release date, in one line. Null when nothing is live. */
export function previewTakeaway(np: NextPrint): string | null {
  const live = np.forecasters.filter((f) => Number.isFinite(f.value));
  const ens = np.ensemble.value;
  if (ens == null || live.length === 0 || !np.reference_month) return null;
  const month = fmtMonth(`${np.reference_month}-01`);
  const when = np.release_date ? `, out ${fmtDay(np.release_date)}` : "";
  const sorted = [...live].sort((a, b) => a.value - b.value);
  const pct = (v: number) => `${v >= 0 ? "+" : "−"}${Math.abs(v).toFixed(2)}%`;
  const range = sorted.length > 1
    ? `, from ${sorted[0].name}'s ${pct(sorted[0].value)} to ${sorted[sorted.length - 1].name}'s ${pct(sorted[sorted.length - 1].value)}`
    : "";
  return `${month} CPI${when}: the forecasters average ${pct(ens)} on the month${np.basis ? ` (${np.basis})` : ""}${range}.`;
}

/** a shared x-domain for the forecaster dot rows: every value plus the
 *  ensemble, padded and widened to at least `minSpan` so two close calls do
 *  not look far apart */
export function dotDomain(values: number[], minSpan = 0.3): [number, number] {
  const lo = Math.min(...values);
  const hi = Math.max(...values);
  const mid = (lo + hi) / 2;
  const half = Math.max(hi - lo, minSpan) / 2 + 0.05;
  return [mid - half, mid + half];
}
