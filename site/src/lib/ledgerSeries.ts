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

/** GitHub's history of the append-only ledger file, filtered to the days
 *  around a publish: it lists the commit that appended the row, with its SHA.
 *  A row cannot carry its own commit (it is written before that commit). */
export function ledgerCommitsUrl(repo: string, publishedAt: string): string {
  const d = new Date(publishedAt);
  const day = (x: Date) => x.toISOString().slice(0, 10);
  const until = new Date(d.getTime() + 864e5);
  return `https://github.com/${repo}/commits/main/store/ledger/pulse.jsonl?since=${day(d)}&until=${day(until)}`;
}
