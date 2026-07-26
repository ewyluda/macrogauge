/** Contingency bases for the DC escalation calculator.
 *
 *  This module makes NO forecast. Every value is an annualized ratio of the
 *  published DC Build index over a stated historical window — a claim about
 *  what has already happened, which the reader can re-derive by hand from
 *  datacenter.json. That is what lets /escalation project a delivery window
 *  without asserting which regime will obtain.
 *
 *  A basis is defined as an annualized INDEX RATIO, never a median or mean of
 *  YoY prints. The distinction is load-bearing: on the live grid the trailing
 *  3yr median of YoY readings is +3.45% while the annualized ratio is +4.76%,
 *  and only the ratio decomposes additively into per-component contributions
 *  (see bridgeWindow in dcEscalation.ts).
 */
import { monthDiff, monthIndexAtOrBefore } from "./dcEscalation";

export type BasisKind = "rolling" | "absolute";

export type BasisDef = {
  key: string;
  label: string;
  kind: BasisKind;
  /** rolling only: months back from the anchor; null means "from the first month". */
  lookbackMonths?: number | null;
  /** absolute only: a fixed historical episode. */
  startMonth?: string;
  endMonth?: string;
  note: string;
};

export type Basis = {
  key: string;
  label: string;
  kind: BasisKind;
  note: string;
  startMonth: string;
  endMonth: string;
  months: number;
  cumulativePct: number;
  annualizedPct: number;
};

/** The two absolute windows are hand-set to observed episodes and are stated
 *  on-page with their bounds. They are not derived by a rule, and their values
 *  must not move between publishes — pinned in dcContingency.test.ts. */
export const BASES: BasisDef[] = [
  {
    key: "longrun",
    label: "Long-run",
    kind: "rolling",
    lookbackMonths: null,
    note: "every month in the sample",
  },
  {
    key: "gfc",
    label: "Downturn regime (GFC)",
    kind: "absolute",
    startMonth: "2008-12",
    endMonth: "2011-12",
    note: "the post-crisis construction downturn",
  },
  {
    key: "trailing3y",
    label: "Trailing 3yr",
    kind: "rolling",
    lookbackMonths: 36,
    note: "the last three complete years",
  },
  {
    key: "momentum",
    label: "Current momentum",
    kind: "rolling",
    lookbackMonths: 12,
    note: "carry the latest 12-month rate — the naive answer",
  },
  {
    key: "covid",
    label: "Peak regime (COVID)",
    kind: "absolute",
    startMonth: "2021-04",
    endMonth: "2023-12",
    note: "the 2021–23 spike",
  },
];

/** The last month every component actually covers.
 *
 *  NOT months[months.length - 1]. The published grid's trailing month is a
 *  partial stub: dcindex takes max() over component end dates, so the grid
 *  runs past the last date most of the basket had data, and only the two
 *  live-proxy components (8.5% of weight) move in it. Anchoring a RATE there
 *  reads a two-component move as a basket move.
 *
 *  min(components[].last_obs) is exactly right: the PPI backbones sit at the
 *  last monthly print while copper/aluminium run daily, so the min tracks the
 *  monthly cadence and advances only when a real print lands. */
export function lastCompleteMonth(
  months: string[],
  componentLastObs: string[]
): string | null {
  if (!months.length || !componentLastObs.length) return null;
  const cap = componentLastObs
    .reduce((a, b) => (a < b ? a : b))
    .slice(0, 7);
  const i = monthIndexAtOrBefore(months, cap);
  return i < 0 ? null : months[i];
}

function resolve(
  def: BasisDef,
  months: string[],
  anchorMonth: string
): { start: string; end: string } | null {
  if (def.kind === "absolute") {
    if (!def.startMonth || !def.endMonth) return null;
    return { start: def.startMonth, end: def.endMonth };
  }
  if (def.lookbackMonths == null) return { start: months[0], end: anchorMonth };
  const anchorIdx = monthIndexAtOrBefore(months, anchorMonth);
  const startIdx = anchorIdx - def.lookbackMonths;
  if (anchorIdx < 0 || startIdx < 0) return null;
  return { start: months[startIdx], end: months[anchorIdx] };
}

/** Resolve every basis against the grid. A basis whose window is not fully
 *  inside the sample is OMITTED, never clamped — a "trailing 3yr" computed
 *  over 14 available months would be a different statistic wearing the same
 *  label. */
export function bases(
  months: string[],
  index: number[],
  anchorMonth: string
): Basis[] {
  const out: Basis[] = [];
  for (const def of BASES) {
    const w = resolve(def, months, anchorMonth);
    if (!w) continue;
    const i = monthIndexAtOrBefore(months, w.start);
    const j = monthIndexAtOrBefore(months, w.end);
    if (i < 0 || j < 0 || j <= i) continue;
    if (months[i] !== w.start && def.kind === "absolute") continue;
    if (months[j] > anchorMonth) continue;
    const ratio = index[j] / index[i];
    const n = monthDiff(months[i], months[j]);
    out.push({
      key: def.key,
      label: def.label,
      kind: def.kind,
      note: def.note,
      startMonth: months[i],
      endMonth: months[j],
      months: n,
      cumulativePct: (ratio - 1) * 100,
      annualizedPct: (Math.pow(ratio, 12 / n) - 1) * 100,
    });
  }
  return out;
}

/** Band horizons. The cap is applied to the delivery-date INPUT, not just the
 *  band, so every basis and band the reader sees covers the same window.
 *
 *  48 is NOT the horizon where independent draws first fall under 3.
 *  indep(h) = (anchorIdx - h + 1) / h is monotonically decreasing in h, and
 *  the horizon where it crosses 3 drifts later every month the sample grows
 *  (anchorIdx grows ~1/month) — on the grid as of the 2026-07 backfill it was
 *  h=56 (indep 2.98), not 48 (indep 3.65, ~175 windows). A hardcoded
 *  crossover month would silently go stale the next time the sample grows,
 *  which is why one is not asserted here or on the page.
 *
 *  48 is chosen because the sample is ALREADY thin there (~3.6 independent
 *  draws currently — see band()'s live `independentDraws` output, which is
 *  what the page renders rather than this comment's snapshot) and keeps
 *  thinning as h grows, and because it covers this tool's intended 12-36
 *  month use case plus a mid-2026 base carried to a 2029-2030 energization. */
export const MIN_HORIZON_MONTHS = 12;
export const MAX_HORIZON_MONTHS = 48;

/** The 2021-23 escalation spike, as a stated constant. Published alongside every
 *  band so the reader knows how much of the sample is one episode. */
export const SPIKE_START = "2021-04";
export const SPIKE_END = "2022-12";

export type Band = {
  horizonMonths: number;
  windows: number;
  /** (windows / horizon) — how many NON-overlapping windows the sample could
   *  have supported. Published because overlapping windows make a small sample
   *  look like a large one. */
  independentDraws: number;
  spikeOverlapPct: number;
  p10: number;
  p25: number;
  p50: number;
  p75: number;
  p90: number;
  sampleStartMonth: string;
  sampleEndMonth: string;
};

/** Linear-interpolated percentile on (n-1), matching numpy's default and
 *  Python's statistics.quantiles(method="inclusive") — the method used to
 *  produce the reference figures in the measurements doc. */
function percentile(sorted: number[], p: number): number {
  if (sorted.length === 1) return sorted[0];
  const pos = (p / 100) * (sorted.length - 1);
  const lo = Math.floor(pos);
  const hi = Math.min(lo + 1, sorted.length - 1);
  return lo === hi ? sorted[lo] : sorted[lo] + (pos - lo) * (sorted[hi] - sorted[lo]);
}

/** Empirical distribution of realized annualized escalation over windows of
 *  exactly `horizonMonths`, ending at or before `anchorMonth`.
 *
 *  ASSUMES A CONTIGUOUS MONTHLY GRID — one entry per calendar month, no gaps —
 *  because it steps by array position (`index[i + horizonMonths]`) rather than
 *  by calendar arithmetic. That holds by construction: dcindex builds the
 *  monthly grid by bucketing every day of the daily index into its month
 *  (pipeline/engine/dcindex.py:99-108), so every month between the first and
 *  last has exactly one entry. `bases()`'s rolling lookback relies on the same
 *  property.
 *
 *  Horizon-matched deliberately: it is a literal statement the reader can
 *  check ("of the N realized 36-month windows since 2007-12, the median was
 *  X"), and it imposes no distributional assumption. The cost is that n falls
 *  as the horizon grows, which is why `windows` and `independentDraws` are
 *  part of the return value rather than an implementation detail. */
export function band(
  months: string[],
  index: number[],
  horizonMonths: number,
  anchorMonth: string
): Band | null {
  const anchorIdx = monthIndexAtOrBefore(months, anchorMonth);
  if (anchorIdx < 0 || horizonMonths <= 0) return null;
  const rates: number[] = [];
  let overlap = 0;
  for (let i = 0; i + horizonMonths <= anchorIdx; i++) {
    const j = i + horizonMonths;
    rates.push((Math.pow(index[j] / index[i], 12 / horizonMonths) - 1) * 100);
    if (months[i] <= SPIKE_END && months[j] >= SPIKE_START) overlap++;
  }
  if (rates.length < 2) return null;
  const sorted = [...rates].sort((a, b) => a - b);
  return {
    horizonMonths,
    windows: rates.length,
    independentDraws: rates.length / horizonMonths,
    spikeOverlapPct: (100 * overlap) / rates.length,
    p10: percentile(sorted, 10),
    p25: percentile(sorted, 25),
    p50: percentile(sorted, 50),
    p75: percentile(sorted, 75),
    p90: percentile(sorted, 90),
    sampleStartMonth: months[0],
    sampleEndMonth: months[anchorIdx],
  };
}
