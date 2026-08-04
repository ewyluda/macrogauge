// Client math for /markets. Kept out of the .tsx because vitest collects
// only src/**/*.test.ts in the node env — logic inside a component is
// untestable except through Playwright.
import type { MarketRow } from "./types";

export type SortKey = "name" | "wage" | "wageYoy" | "emp" | "empYoy" | "mw";

const VALUE: Record<SortKey, (r: MarketRow) => number | string | null> = {
  name: (r) => r.name,
  wage: (r) => r.wage,
  wageYoy: (r) => r.wage_yoy_pct,
  // Deliberately emp_cur_total, NOT the like-for-like `emp`: the panel
  // displays emp_cur_total (a market's true current size, independent of
  // whether a county was disclosed a year ago), so the sort key must match
  // what's on screen. Sorting on `emp` would let Northern Virginia read
  // smaller than it is whenever Loudoun is base-suppressed.
  emp: (r) => r.emp_cur_total,
  empYoy: (r) => r.emp_yoy_pct,
  // Same rule as `emp` above, extended to this column: the panel displays
  // mw_construction (MarketsClient.tsx, "MW under constr."), NOT
  // mw_disclosed (the all-status total across operating/construction/
  // planned/secured sites), so the sort key must match what's on screen.
  // Sorting on mw_disclosed would rank a fully-built, zero-construction
  // market (e.g. New Carlisle, 1,725 MW operational) above a market with
  // real construction underway (e.g. Richland Parish, 1,440 MW under
  // construction) -- inverting the column's whole purpose.
  // A zero with undisclosed-MW sites is an unknown, not a measured zero
  // (Northern Virginia tracks a site with no stated figure) -- it sorts as
  // null and sinks with the other unknowns, mirroring the "—" the panel
  // renders for it. A zero with all sites disclosed is a real zero and
  // still sorts as 0.
  mw: (r) =>
    r.mw_construction === 0 && r.sites_mw_undisclosed > 0
      ? null
      : r.mw_construction,
};

/** Sort a copy. Unavailable markets always sink to the bottom — a suppressed
 *  row has null metrics and must never sort as if it were a zero. */
export function sortMarkets(rows: MarketRow[], key: SortKey, desc: boolean): MarketRow[] {
  const get = VALUE[key];
  return [...rows].sort((a, b) => {
    if (a.available !== b.available) return a.available ? -1 : 1;
    const av = get(a);
    const bv = get(b);
    // Both null must compare equal (0), not "a after b" from both sides —
    // returning 1 for both cmp(a,b) and cmp(b,a) violates the antisymmetry
    // Array.prototype.sort requires and is undefined behavior. This regime
    // is real: an available market can have a null wageYoy/empYoy when no
    // county cleared the like-for-like bar (pipeline/engine/dcmarkets.py).
    if (av === null && bv === null) return 0;
    if (av === null) return 1;
    if (bv === null) return -1;
    const cmp = typeof av === "string" && typeof bv === "string"
      ? av.localeCompare(bv)
      : (av as number) - (bv as number);
    return desc ? -cmp : cmp;
  });
}

/** Labour tightness relative to the NATIONAL rate, not the raw rate: +6%
 *  wage growth is slack when the country is running +5.1%. Returns "na"
 *  whenever there is no spread to key off — an unavailable market, or one
 *  with no YoY basis (wage_spread_pp is null in both cases). */
export function tightness(r: MarketRow): "hot" | "warm" | "neutral" | "slack" | "na" {
  const score = tightnessScore(r);
  if (score === null) return "na";
  if (score >= 10) return "hot";
  if (score >= 3) return "warm";
  if (score > -3) return "neutral";
  return "slack";
}

/** The composite behind the tightness badge, exported so the page's
 *  "Tightest market" KPI ranks by the SAME metric the table badges with —
 *  ranking by wage spread alone can crown a different market. */
export function tightnessScore(r: MarketRow): number | null {
  if (!r.available || r.wage_spread_pp === null) return null;
  return r.wage_spread_pp + (r.emp_spread_pp ?? 0) / 2;
}

export function fmtSpread(pp: number | null): string {
  if (pp === null) return "—";
  const sign = pp < 0 ? "−" : "+";
  return `${sign}${Math.abs(pp).toFixed(1)}pp`;
}
