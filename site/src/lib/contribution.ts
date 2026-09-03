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
 *  summing to the headline with no residual (to the artifact's 2dp). */
export type ReplayComponent = {
  code: string;
  label: string;
  weight: number;
  yoy: (number | null)[];
  bls_yoy: (number | null)[];
};

export type ContribSide = "ours" | "bls";

/** Contribution (pp) of each component at daily position i; null when any
 *  component's YoY is null there (the headline itself is null then). */
export function contributionsAt(
  comps: ReplayComponent[],
  side: ContribSide,
  i: number,
): { code: string; pp: number }[] | null {
  const total = comps.reduce((s, c) => s + c.weight, 0);
  if (total <= 0) return null;
  const out: { code: string; pp: number }[] = [];
  for (const c of comps) {
    const v = (side === "ours" ? c.yoy : c.bls_yoy)[i];
    if (v == null) return null;
    out.push({ code: c.code, pp: (c.weight / total) * v });
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
    const a = mode === "bls" ? null : contributionsAt(comps, "ours", e.i);
    const b = mode === "ours" ? null : contributionsAt(comps, "bls", e.i);
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
