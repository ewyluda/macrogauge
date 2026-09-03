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
import type { LedgerRow } from "@/lib/types";

const num = (v: number | null | undefined) => (v == null ? "—" : fmtSigned(v));

/** Pick a publish date and read exactly what the site said that day. The
 *  date lives in the URL so a reading can be cited by link. */
export function AsOfClient({ rows, todayDates, todayGauge }: {
  rows: LedgerRow[];
  /** compare.json months + gauge YoY as published TODAY, for the restatement chart */
  todayDates: string[];
  todayGauge: (number | null)[];
}) {
  const latest = rows[rows.length - 1];
  const [date, setDate] = useUrlState("date", latest.date, codecs.date());
  const row = useMemo(() => {
    // exact date, else the last publish on or before it
    const exact = rows.filter((r) => r.date === date);
    if (exact.length) return exact[exact.length - 1];
    const before = rows.filter((r) => r.date < date);
    return before.length ? before[before.length - 1] : rows[0];
  }, [rows, date]);
  const asPublished = rows.map((r) => [r.date, r.gauge_yoy_pct ?? null] as [string, number | null]);
  return (
    <div>
      <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap", margin: "12px 0" }}>
        <label style={{ fontSize: 12, color: "var(--muted)" }}>
          AS OF{" "}
          <input type="date" min={rows[0].date} max={latest.date} value={date} onChange={(e) => e.target.value && setDate(e.target.value)}
            style={{ background: "var(--bg)", color: "var(--text)", border: "1px solid var(--border)", borderRadius: 6, padding: "6px 10px" }} />
        </label>
        <span style={{ fontSize: 12, color: "var(--muted)" }}>
          {row.date === date ? `publish ${fmtStamp(row.published_at)}` : `no publish on ${date} — showing the last one before it, ${fmtStamp(row.published_at)}`}
        </span>
        <CopyLink />
      </div>
      <div className="kpi-row">
        <KpiCard label="Macrogauge · YoY" value={row.gauge_yoy_pct == null ? "—" : fmtPct(row.gauge_yoy_pct)} context={`as of ${row.gauge_as_of ?? "—"} · coverage ${row.coverage_pct == null ? "—" : `${row.coverage_pct.toFixed(0)}%`}`} accent="sky" />
        <KpiCard label="Official CPI · YoY" value={row.official_yoy_pct == null ? "—" : fmtPct(row.official_yoy_pct)} context={`${row.official_month ? row.official_month.slice(0, 7) : "—"} print, as known then`} accent="amber" />
        <KpiCard label="CPI-Tracker" value={row.tracker_yoy_pct == null ? "—" : fmtPct(row.tracker_yoy_pct)} context={`gap vs official ${row.tracker_yoy_pct != null && row.official_yoy_pct != null ? fmtPp(row.tracker_yoy_pct - row.official_yoy_pct) : "—"}`} accent="violet" />
        <KpiCard label="DC Build · YoY" value={num(row.dc_build_yoy_pct)} context={row.dc_build_as_of ? `as of ${row.dc_build_as_of} · ops ${num(row.dc_ops_yoy_pct)} · hardware ${num(row.dc_hardware_yoy_pct)}` : "DC index not yet published that day"} accent="emerald" />
      </div>
      <Citation live series="Macrogauge (CPI-comparable) YoY as published" asOf={row.date} rebase="2018-01=100" value={row.gauge_yoy_pct == null ? "—" : `${fmtPct(row.gauge_yoy_pct)} vs official ${row.official_yoy_pct == null ? "—" : fmtPct(row.official_yoy_pct)}`} path="/as-of" />
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
      <div className="chart-card" style={{ marginTop: 14 }}>
        <LinesChart height={300}
          series={[
            { name: "Macrogauge YoY as published each day", x: asPublished.map((p) => p[0]), y: asPublished.map((p) => p[1]), color: C.sky, step: true },
            { name: "Same dates in today's history", x: todayDates, y: todayGauge, color: C.muted, dashed: true },
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
