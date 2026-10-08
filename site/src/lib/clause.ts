/** Price-adjustment clause math for /escalation/clause — settles on the
 *  agency's OWN index (a BLS PPI / CES series), never a MacroGauge composite,
 *  on a stated vintage. Pure; unit-tested.
 *
 *  change   = I(adjustment month) / I(base month) − 1                    (%)
 *  excess   = deadband mode "excess": sign(change)·max(|change| − band, 0)
 *             deadband mode "full":   change if |change| > band, else 0
 *  adjusted = clamp(share · excess, −floor, +cap)                         (%)
 *  dollars  = contract value · escalable share · adjusted
 */
export type ClauseSeries = {
  basket: "build" | "ops" | "reference"; code: string; label: string; series: string; source_id: string;
  months: string[]; latest: number[]; first_print: (number | null)[]; first_release: (string | null)[];
};
export type Vintage = "first_print" | "latest";
export type ClauseTerms = {
  baseMonth: string; adjMonth: string; vintage: Vintage;
  bandPct: number; bandMode: "excess" | "full"; sharePct: number;
  capPct: number | null; floorPct: number | null;
  contractValue: number; escalablePct: number;
};
export type ClauseResult =
  | { ok: false; error: string }
  | { ok: true; baseIndex: number; adjIndex: number; changePct: number; excessPct: number;
      adjustedPct: number; capped: "cap" | "floor" | null; dollars: number;
      baseRelease: string | null; adjRelease: string | null };

function indexAt(s: ClauseSeries, month: string, v: Vintage): { value: number | null; release: string | null } {
  const i = s.months.indexOf(month);
  if (i < 0) return { value: null, release: null };
  return v === "latest"
    ? { value: s.latest[i], release: null }
    : { value: s.first_print[i], release: s.first_release[i] };
}

export function settle(s: ClauseSeries, t: ClauseTerms): ClauseResult {
  if (!(t.adjMonth > t.baseMonth)) return { ok: false, error: "The adjustment month must be after the base month." };
  if (t.bandPct < 0 || t.sharePct < 0 || t.sharePct > 100) return { ok: false, error: "Deadband must be ≥ 0 and share between 0 and 100%." };
  if (t.escalablePct < 0 || t.escalablePct > 100) return { ok: false, error: "Escalable share must be between 0 and 100%." };
  const b = indexAt(s, t.baseMonth, t.vintage);
  const a = indexAt(s, t.adjMonth, t.vintage);
  if (b.value == null || a.value == null) {
    return { ok: false, error: `${s.source_id} has no ${t.vintage === "first_print" ? "first-print " : ""}value for ${b.value == null ? t.baseMonth : t.adjMonth}.` };
  }
  const change = (a.value / b.value - 1) * 100;
  const mag = Math.abs(change);
  const excess = t.bandMode === "excess"
    ? Math.sign(change) * Math.max(mag - t.bandPct, 0)
    : (mag > t.bandPct ? change : 0);
  let adjusted = (t.sharePct / 100) * excess;
  let capped: "cap" | "floor" | null = null;
  if (t.capPct != null && adjusted > t.capPct) { adjusted = t.capPct; capped = "cap"; }
  if (t.floorPct != null && adjusted < -t.floorPct) { adjusted = -t.floorPct; capped = "floor"; }
  return { ok: true, baseIndex: b.value, adjIndex: a.value, changePct: change, excessPct: excess,
    adjustedPct: adjusted, capped, dollars: t.contractValue * (t.escalablePct / 100) * (adjusted / 100),
    baseRelease: b.release, adjRelease: a.release };
}

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const monthName = (ym: string) => `${MONTHS[Number(ym.slice(5, 7)) - 1]} ${ym.slice(0, 4)}`;

export function clauseText(s: ClauseSeries, t: ClauseTerms): string {
  const vint = t.vintage === "first_print"
    ? "as first published by the U.S. Bureau of Labor Statistics, disregarding later revisions"
    : "as most recently published by the U.S. Bureau of Labor Statistics at the time of adjustment";
  const band = t.bandPct > 0
    ? (t.bandMode === "excess"
        ? ` No adjustment shall be made for a change of ${t.bandPct}% or less; for a larger change, only the portion exceeding ${t.bandPct}% shall be taken into account.`
        : ` No adjustment shall be made unless the change exceeds ${t.bandPct}%, in which case the entire change shall be taken into account.`)
    : "";
  const share = t.sharePct === 100 ? "" : ` The Buyer shall bear ${t.sharePct}% of the resulting change and the Seller ${100 - t.sharePct}%.`;
  const limits = [t.capPct != null ? `an increase of ${t.capPct}%` : null, t.floorPct != null ? `a decrease of ${t.floorPct}%` : null].filter(Boolean);
  const lim = limits.length ? ` The adjustment shall not exceed ${limits.join(" or ")} of the escalable portion.` : "";
  return `Price adjustment. The ${t.escalablePct}% of the Contract Price designated as escalable shall be adjusted in proportion to the change in ${s.label} (${s.source_id}), ${vint}, comparing the index for ${monthName(t.adjMonth)} with the index for ${monthName(t.baseMonth)} (the base month).${band}${share}${lim}`;
}
