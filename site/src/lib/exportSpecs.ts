import type { CsvSpec } from "./csv";

/** Lazy CSV recipes (lib/csv CsvSpec) for the exports whose rows used to be
 *  inlined into the page HTML. Kept here, not in the pages, so a vitest can
 *  pin each recipe to the exact rows the inline construction produced. */

/** /rates — Treasury curve snapshot (rows = rates.json curve[] verbatim). */
export const RATES_CURVE_CSV: CsvSpec = { kind: "rows", path: "curve" };

/** /rates — daily history on the DGS10 business-day grid. */
export const RATES_HISTORY_CSV: CsvSpec = {
  kind: "columns",
  key: { name: "date", path: "history.dates" },
  series: ["dgs3mo", "dgs2", "dgs10", "t5yie", "t10yie", "hy_oas", "dollar", "spread_2s10s", "spread_3m10y", "real_10y"]
    .map((k) => ({ name: k, path: `history.${k}` })),
};

/** /rates — weekly Fed liquidity ($bn). */
export const RATES_LIQUIDITY_CSV: CsvSpec = {
  kind: "columns",
  key: { name: "date", path: "liquidity.history.dates" },
  series: ["walcl_bn", "tga_bn", "rrp_bn", "net_bn"].map((k) => ({ name: k, path: `liquidity.history.${k}` })),
};

/** Home hero — gauge / tracker / col daily YoY from gauge_daily.json over
 *  the hero window (dates ≥ `from`). */
export function heroCsvSpec(from: string | undefined): CsvSpec {
  return {
    kind: "columns",
    key: { name: "date", path: "variants.gauge.dates" },
    series: [
      { name: "gauge_yoy_pct", path: "variants.gauge.yoy_pct" },
      { name: "tracker_yoy_pct", path: "variants.tracker.yoy_pct" },
      { name: "col_yoy_pct", path: "variants.col.yoy_pct" },
    ],
    ...(from ? { from } : {}),
  };
}

/** /dc-scoreboard — every grading anchor, flattened. */
export const DC_ANCHORS_CSV: CsvSpec = { kind: "rows", path: "anchors", flatten: true };
