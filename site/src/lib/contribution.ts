/** Exact contribution-to-YoY from replay.json.
 *
 *  The engine's headline YoY is NOT an index ratio: it is the weighted mean
 *  of each component's OWN like-month YoY (aggregate.weighted_yoy — lagging
 *  series compare like month to like month, see CLAUDE.md), and is null on
 *  any day a component's YoY is null. replay.json publishes exactly those
 *  per-component series (`yoy`, and `bls_yoy` for the 14-component BLS
 *  reconstruction the gap table grades against). Hence
 *      headline YoY(t) = Σ_i w_i · yoy_i(t)          (Σ w_i = 1)
 *  and w_i · yoy_i(t) is component i's contribution in percentage points,
 *  summing to the headline with no residual (to the artifact's 2dp).
 *
 *  Since 2026-09-28 the weights are TIME-VARYING (backlog #4): the engine
 *  applies, at date t, BLS relative importance price-updated to t's own YoY
 *  base month (t − 365 days), published per component as
 *  `weights_by_month`. weightAt() reads the one in force at a date and falls
 *  back to the fixed `weight` (older artifacts carry no per-month map). */
export type ReplayComponent = {
  code: string;
  label: string;
  weight: number;
  yoy: (number | null)[];
  bls_yoy: (number | null)[];
  /** YYYY-MM (YoY base month) → weight the headline used at dates with that base */
  weights_by_month?: Record<string, number>;
};

const DAY_MS = 86_400_000;

/** YYYY-MM of the 365-day YoY base of an ISO date — mirrors the engine's
 *  aggregate.base_month exactly (a leap-year Feb 29 maps to Mar 1 of the
 *  prior year, like the 365-day YoY itself). */
export function baseMonth(date: string): string {
  const t = Date.parse(`${date}T00:00:00Z`) - 365 * DAY_MS;
  return new Date(t).toISOString().slice(0, 7);
}

/** The weight component `c` carried in the headline on `date`; the fixed
 *  `weight` when no date is given or the artifact has no per-month map. */
export function weightAt(c: { weight: number; weights_by_month?: Record<string, number> }, date?: string): number {
  if (!date || !c.weights_by_month) return c.weight;
  return c.weights_by_month[baseMonth(date)] ?? c.weight;
}

export type ContribSide = "ours" | "bls";

/** Contribution (pp) of each component at daily position i; null when any
 *  component's YoY is null there (the headline itself is null then). Pass
 *  the position's `date` so the weights are the ones in force that day. */
export function contributionsAt(
  comps: ReplayComponent[],
  side: ContribSide,
  i: number,
  date?: string,
): { code: string; pp: number }[] | null {
  const ws = comps.map((c) => weightAt(c, date));
  const total = ws.reduce((s, w) => s + w, 0);
  if (total <= 0) return null;
  const out: { code: string; pp: number }[] = [];
  for (let k = 0; k < comps.length; k++) {
    const c = comps[k];
    const v = (side === "ours" ? c.yoy : c.bls_yoy)[i];
    if (v == null) return null;
    out.push({ code: c.code, pp: (ws[k] / total) * v });
  }
  return out;
}

/** Last daily position of each month, in order. */
export function monthEnds(dates: string[]): { month: string; i: number }[] {
  const out: { month: string; i: number }[] = [];
  dates.forEach((d, i) => {
    const m = d.slice(0, 7);
    if (out.length && out[out.length - 1].month === m) out[out.length - 1].i = i;
    else out.push({ month: m, i });
  });
  return out;
}

export type ContribMode = ContribSide | "gap";

export type ContribGrid = {
  months: string[];
  /** code → pp per month (null where undefined) */
  byCode: Record<string, (number | null)[]>;
  /** Σ contributions per month = headline YoY (or ours − BLS in gap mode) */
  total: (number | null)[];
};

/** Month-end contribution grid for one side, or the ours−BLS gap. */
export function contributionGrid(
  dates: string[],
  comps: ReplayComponent[],
  mode: ContribMode,
  windowMonths?: number,
): ContribGrid {
  let ends = monthEnds(dates);
  if (windowMonths) ends = ends.slice(-windowMonths);
  const byCode: Record<string, (number | null)[]> = Object.fromEntries(comps.map((c) => [c.code, []]));
  const total: (number | null)[] = [];
  for (const e of ends) {
    const a = mode === "bls" ? null : contributionsAt(comps, "ours", e.i, dates[e.i]);
    const b = mode === "ours" ? null : contributionsAt(comps, "bls", e.i, dates[e.i]);
    const ok = mode === "ours" ? !!a : mode === "bls" ? !!b : !!a && !!b;
    let sum = 0;
    comps.forEach((c, k) => {
      if (!ok) { byCode[c.code].push(null); return; }
      const v = mode === "ours" ? a![k].pp : mode === "bls" ? b![k].pp : a![k].pp - b![k].pp;
      byCode[c.code].push(v);
      sum += v;
    });
    total.push(ok ? sum : null);
  }
  return { months: ends.map((e) => e.month), byCode, total };
}
