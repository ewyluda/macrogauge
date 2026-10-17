import { fmtDay, fmtMonth, fmtSigned } from "./format";
import type { DcTradeGroup, DcTradeRow } from "./types";

/** The four kinds of measure in labor.json's dc_trades block, in page order,
 *  each with the scope a reader needs before comparing it with the others. */
export const TRADE_GROUPS: { group: DcTradeGroup; title: string; scope: string }[] = [
  { group: "earnings", title: "Contractor earnings",
    scope: "Average hourly earnings of every employee at contractor firms, office and supervisory staff " +
      "included, national, residential and nonresidential work together. They move with the job mix and " +
      "overtime, so they are not a trade's wage rate." },
  { group: "jobs", title: "Construction jobs",
    scope: "Jobs actually filled, not unmet demand. Nonresidential covers far more than data centers. ADP " +
      "is benchmarked to the same QCEW census, so its agreement is not fully independent." },
  { group: "eci", title: "Fixed-mix wage indexes",
    scope: "The ECI holds the mix of jobs fixed, so it does not move when the workforce shifts. Wages only, " +
      "not what contractors charge; both groups are broad." },
  { group: "postings", title: "Hiring signals",
    scope: "Advertised openings, not filled jobs or available workers. Electrical engineering is engineers " +
      "(design, controls), not electricians; installation and maintenance spans every industry." },
];

const thousands = (v: number) => `${Math.round(v).toLocaleString("en-US")}k`;

/** $43.61/hr · 2,940k · 174.6 · — */
export function tradeLevel(r: DcTradeRow): string {
  if (r.value == null) return "—";
  if (r.unit === "usd_per_hour") return `$${r.value.toFixed(2)}/hr`;
  if (r.unit === "thousands") return thousands(r.value);
  return r.value.toFixed(1);
}

/** Oct 9, 2026 (daily) · Q2 2026 (quarterly, dated at the quarter's first month) · Aug 2026 */
export function tradeAsOf(r: DcTradeRow): string {
  if (r.as_of == null) return "—";
  if (r.cadence === "daily") return fmtDay(r.as_of);
  if (r.cadence === "quarterly") return `Q${Math.floor((Number(r.as_of.slice(5, 7)) - 1) / 3) + 1} ${r.as_of.slice(0, 4)}`;
  return fmtMonth(r.as_of);
}

/** "+2.1pp over all construction (+4.2%)" · — (sign from the rounded value, as fmtSigned) */
export function tradeVs(r: DcTradeRow): string {
  if (r.spread_pp == null) return "—";
  return `${fmtSigned(r.spread_pp).replace("%", "pp")} over ${r.vs_label} (${fmtSigned(r.vs_yoy_pct)})`;
}

/** Rows bucketed by group in TRADE_GROUPS order; empty groups dropped. */
export function groupTrades(rows: DcTradeRow[]) {
  return TRADE_GROUPS
    .map((g) => ({ ...g, rows: rows.filter((r) => r.group === g.group) }))
    .filter((g) => g.rows.length > 0);
}
