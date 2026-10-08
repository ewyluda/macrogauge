"use client";
import { useMemo } from "react";
import { KpiCard } from "./KpiCard";
import { Citation } from "./Citation";
import { CopyLink } from "./CopyLink";
import { LinesChart } from "./LinesChart";
import { C } from "@/lib/chartTheme";
import { fmtPct, fmtPp, fmtSigned, fmtStamp } from "@/lib/format";
import { codecs } from "@/lib/urlState";
import { useUrlState } from "@/lib/useUrlState";
import { LEDGER_SERIES, ledgerCommitsUrl, type LedgerKey } from "@/lib/ledgerSeries";
import { SegmentedControl } from "./SegmentedControl";
import type { LedgerRow } from "@/lib/types";

const num = (v: number | null | undefined) => (v == null ? "—" : fmtSigned(v));

/** Pick a publish date and read exactly what the site said that day; pick a
 *  series (DC Build by default) to chart it as published against today's
 *  history. Both live in the URL so a reading can be cited by link. */
export function AsOfClient({ rows, today, repo }: {
  rows: LedgerRow[];
  /** each series' value in TODAY's history at every publish's reference date */
  today: Record<LedgerKey, (number | null)[]>;
  repo: string;
}) {
  const latest = rows[rows.length - 1];
  const [date, setDate] = useUrlState("date", latest.date, codecs.date());
  const [key, setKey] = useUrlState<LedgerKey>("series", "dc_build",
    codecs.enumOf(LEDGER_SERIES.map((s) => s.key)));
  const series = LEDGER_SERIES.find((s) => s.key === key)!;
  const row = useMemo(() => {
    // exact date, else the last publish on or before it; null when the date
    // precedes the ledger (a ?date= link can go below the picker's min) —
    // falling back to rows[0] showed a publish AFTER the date under copy
    // saying "the last one before it"
    const exact = rows.filter((r) => r.date === date);
    if (exact.length) return exact[exact.length - 1];
    const before = rows.filter((r) => r.date < date);
    return before.length ? before[before.length - 1] : null;
  }, [rows, date]);
  const asPublished = rows.map((r) => r[series.value] ?? null);
  const dates = rows.map((r) => r.date);
  const options = LEDGER_SERIES.map((s) => ({ key: s.key, label: s.label }));
  return (
    <div>
      <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap", margin: "12px 0" }}>
        <label style={{ fontSize: 12, color: "var(--muted)" }}>
          AS OF{" "}
          <input type="date" min={rows[0].date} max={latest.date} value={date} onChange={(e) => e.target.value && setDate(e.target.value)}
            style={{ background: "var(--bg)", color: "var(--text)", border: "1px solid var(--border)", borderRadius: 6, padding: "6px 10px" }} />
        </label>
        <span style={{ fontSize: 12, color: "var(--muted)" }} data-testid="asof-status">
          {row == null
            ? `no publish on or before ${date}; the earliest is ${rows[0].date}`
            : row.date === date ? `publish ${fmtStamp(row.published_at)}` : `no publish on ${date} — showing the last one before it, ${fmtStamp(row.published_at)}`}
        </span>
        <CopyLink />
        {row && (
          <a className="asof-verify" href={ledgerCommitsUrl(repo, row.published_at)} data-testid="asof-commit"
            target="_blank" rel="noreferrer">Verify: the commit that appended this row ↗</a>
        )}
      </div>
      {row == null ? (
        <p className="method" role="status" data-testid="asof-empty">
          No publish on or before {date} — the ledger&apos;s earliest publish is {rows[0].date}.{" "}
          <button type="button" className="tool-btn" onClick={() => setDate(rows[0].date)}>Show {rows[0].date}</button>
        </p>
      ) : (
      <>
      <div className="kpi-row">
        <KpiCard label="DC Build · YoY" value={num(row.dc_build_yoy_pct)} context={row.dc_build_as_of ? `as of ${row.dc_build_as_of}` : "DC index not yet published that day"} accent="sky" />
        <KpiCard label="DC Hardware · YoY" value={num(row.dc_hardware_yoy_pct)} context={row.dc_hardware_as_of ? `as of ${row.dc_hardware_as_of} · ops ${num(row.dc_ops_yoy_pct)}` : "—"} accent="amber" />
        <KpiCard label="Macrogauge · YoY" value={row.gauge_yoy_pct == null ? "—" : fmtPct(row.gauge_yoy_pct)} context={`as of ${row.gauge_as_of ?? "—"} · coverage ${row.coverage_pct == null ? "—" : `${row.coverage_pct.toFixed(0)}%`}`} accent="violet" />
        <KpiCard label="Official CPI · YoY" value={row.official_yoy_pct == null ? "—" : fmtPct(row.official_yoy_pct)} context={`${row.official_month ? row.official_month.slice(0, 7) : "—"} print, as known then · tracker gap ${row.tracker_yoy_pct != null && row.official_yoy_pct != null ? fmtPp(row.tracker_yoy_pct - row.official_yoy_pct) : "—"}`} accent="emerald" />
      </div>
      <Citation live series={`${series.label} YoY as published`} asOf={row.date} rebase="2018-01=100"
        value={row[series.value] == null ? "—" : fmtPct(row[series.value]!)} path="/as-of" />
      <div className="table-card" style={{ marginTop: 14 }}>
        <table className="data-table">
          <thead><tr><th style={{ textAlign: "left" }}>Reading as published {row.date}</th><th>Value</th><th>As of</th></tr></thead>
          <tbody>
            {([["Macrogauge (CPI-comparable)", row.gauge_yoy_pct, row.gauge_as_of], ["CPI-Tracker", row.tracker_yoy_pct, row.tracker_as_of],
               ["Cost of Living", row.col_yoy_pct, row.col_as_of], ["Supercore", row.supercore_yoy_pct, row.supercore_as_of], ["PCE-weighted", row.pce_yoy_pct, row.pce_as_of],
               ["Official CPI", row.official_yoy_pct, row.official_month], ["DC Build", row.dc_build_yoy_pct, row.dc_build_as_of], ["DC Ops", row.dc_ops_yoy_pct, row.dc_ops_as_of], ["DC Hardware", row.dc_hardware_yoy_pct, row.dc_hardware_as_of]] as [string, number | null | undefined, string | null | undefined][]).map(([l, v, a]) => (
              <tr key={l}><td style={{ textAlign: "left" }}>{l}</td><td>{num(v)}</td><td style={{ color: "var(--muted)" }}>{a ?? "—"}</td></tr>
            ))}
          </tbody>
        </table>
      </div>
      </>
      )}
      <div className="asof-chart-head">
        <h2 data-testid="asof-chart-title">{series.label} YoY as published each day, against today&apos;s history</h2>
        <SegmentedControl options={options} value={key} onChange={setKey} />
      </div>
      <div className="chart-card">
        <LinesChart height={300} fitY recessions={false} ariaTitle={`${series.label} YoY as published vs today's history`}
          series={[
            { name: `${series.label} YoY as published`, x: dates, y: asPublished, color: C.sky, step: true },
            { name: "Same dates in today's history", x: dates, y: today[key], color: C.muted, dashed: true },
          ]} />
      </div>
      <p className="method">
        The solid line is the headline exactly as each day&apos;s publish stated it — this ledger is append-only and never
        rewritten. The dashed line is what today&apos;s history says for the same dates. Where they differ is the honest
        revision footprint of a live-data gauge: a late print, a re-published source value, a splice moving. Nothing on
        this page is recomputed; a row is read back verbatim.
      </p>
    </div>
  );
}
