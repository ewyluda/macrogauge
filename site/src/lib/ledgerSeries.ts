// /as-of ("Index Ledger"): the series a reader can chart as published vs
// today's history. DC Build leads — the series a claim or change order cites.
import type { LedgerRow } from "./types";

export type LedgerKey = "dc_build" | "dc_hardware" | "dc_ops" | "gauge";

type NumField = "dc_build_yoy_pct" | "dc_hardware_yoy_pct" | "dc_ops_yoy_pct" | "gauge_yoy_pct";
type DateField = "dc_build_as_of" | "dc_hardware_as_of" | "dc_ops_as_of" | "gauge_as_of";

export const LEDGER_SERIES: { key: LedgerKey; label: string; value: NumField; asOf: DateField }[] = [
  { key: "dc_build", label: "DC Build", value: "dc_build_yoy_pct", asOf: "dc_build_as_of" },
  { key: "dc_hardware", label: "DC Hardware", value: "dc_hardware_yoy_pct", asOf: "dc_hardware_as_of" },
  { key: "dc_ops", label: "DC Ops", value: "dc_ops_yoy_pct", asOf: "dc_ops_as_of" },
  { key: "gauge", label: "Macrogauge CPI", value: "gauge_yoy_pct", asOf: "gauge_as_of" },
];

/** Today's history read at each publish's own reference date (the row's
 *  `as_of` for that series, else its publish date): what the current data
 *  says for the same day the ledger row describes. Null where today's
 *  history has no reading that day. */
export function todayAtPublishes(rows: LedgerRow[], asOf: DateField,
                                 dates: string[], yoy: (number | null)[]): (number | null)[] {
  const idx = new Map(dates.map((d, i) => [d, i]));
  return rows.map((r) => {
    const i = idx.get(r[asOf] ?? r.date);
    return i == null ? null : yoy[i] ?? null;
  });
}

/** config/ledger_provenance.json: the rows backfilled on 2026-09-03 (published
 *  before the ledger file existed), each mapped to the commit that originally
 *  published its artifacts, plus the one commit that appended them all. */
export type LedgerProvenance = { appended_commit: string; appended_at: string; sources: Record<string, string> };

export type RowVerify = { href: string; label: string; backfilled: boolean };

/** Where a reader verifies a row. A backfilled row links the exact commit
 *  that published its reading (pulse.json, gaptable.json, datacenter.json in
 *  that commit carry the numbers); the ledger append weeks later is a
 *  different commit, so a publish-day filter would find nothing. A live row is
 *  appended by its own publish commit, which it cannot name (the row is
 *  written first), so it links the ledger file's history from its publish day
 *  through the next two, wide enough for a commit that lands past midnight UTC. */
export function rowVerify(repo: string, publishedAt: string, prov: LedgerProvenance): RowVerify {
  const src = prov.sources[publishedAt];
  if (src) {
    return { href: `https://github.com/${repo}/commit/${src}`, backfilled: true,
             label: "Verify: the commit that published this reading" };
  }
  const d = new Date(publishedAt);
  const day = (x: Date) => x.toISOString().slice(0, 10);
  const until = new Date(d.getTime() + 2 * 864e5);
  return { href: `https://github.com/${repo}/commits/main/store/ledger/pulse.jsonl?since=${day(d)}&until=${day(until)}`,
           backfilled: false, label: "Verify: the commit that appended this row" };
}
