"use client";
import { useState } from "react";
import Link from "next/link";
import { GeoStateMap, fmtFull } from "./GeoStateMap";
import { useUrlState } from "@/lib/useUrlState";
import { codecs } from "@/lib/urlState";
import { stateSlug } from "@/lib/longtail";
import { fmtSigned, yoyColor } from "@/lib/format";
import { METRICS, sortByMetric, valueOf, type MetricKey } from "@/lib/siteCosts";
import type { GeoPanel, GeoStateRow } from "@/lib/types";

const EDGE = 10;

const QUARTER = (d: string | null) => (d ? `Q${Math.ceil(Number(d.slice(5, 7)) / 3)} ${d.slice(0, 4)}` : "—");

const price = (v: number | null, unit: "$gal" | "cents" | "$wk" | "pct") => {
  if (v == null) return "—";
  switch (unit) {
    case "$gal": return `$${v.toFixed(3)}`;
    case "cents": return `${v.toFixed(2)}¢`;
    case "$wk": return `$${Math.round(v).toLocaleString("en-US")}`;
    case "pct": return `${v.toFixed(1)}%`;
  }
};

// Δpp at 1dp — sign from the ROUNDED value (fmtSigned's rule) so +0.04
// renders "0.0", never "+0.0"
const signedPp1 = (pp: number): string => {
  const r = Number(pp.toFixed(1));
  return `${r > 0 ? "+" : r < 0 ? "−" : ""}${Math.abs(r).toFixed(1)}`;
};

/** The map and the table share one metric (in the URL, default industrial
 *  power): the table ranks every state by it, highest first, showing the
 *  ten at each end until the reader asks for the rest. */
export function StatesExplorer({ states, national }: { states: GeoStateRow[]; national: GeoPanel }) {
  const [metric, setMetric] = useUrlState<MetricKey>("metric", "elec_ind",
    codecs.enumOf(METRICS.map((m) => m.key)));
  const [all, setAll] = useState(false);
  const ranked = sortByMetric(states, metric);
  const priced = ranked.filter((s) => valueOf(s, metric) != null);
  const unpriced = ranked.filter((s) => valueOf(s, metric) == null);
  const hidden = !all && priced.length > 2 * EDGE ? priced.length - 2 * EDGE : 0;
  const wageQ = QUARTER(national.wage_weekly.as_of);
  // its own phrase, never label.toLowerCase(), which would turn kWh into kwh
  const active = METRICS.find((m) => m.key === metric)!.noun;
  const cls = (k: MetricKey) => (k === metric ? "st-active" : undefined);

  const row = (s: GeoStateRow, rank: number | null) => (
    <tr key={s.state}>
      <td className="num st-rank">{rank ?? "—"}</td>
      <td><Link href={`/states/${stateSlug(s.state)}`}>{s.name}</Link></td>
      <td className={cls("elec_ind")}>{price(s.elec_ind_cents.value, "cents")}</td>
      <td style={{ color: yoyColor(s.elec_ind_cents.yoy_pct) }}>{fmtSigned(s.elec_ind_cents.yoy_pct)}</td>
      <td className={cls("wage")}>{price(s.wage_weekly.value, "$wk")}</td>
      <td className={cls("elec_res")}>{price(s.elec_res_cents.value, "cents")}</td>
      <td className={cls("gas")}>{price(s.gas_regular.value, "$gal")}</td>
      <td className={cls("unemployment")}>{price(s.unemployment_pct.value, "pct")}</td>
      <td>{s.unemployment_pct.delta_1y_pp == null ? "—" : signedPp1(s.unemployment_pct.delta_1y_pp)}</td>
    </tr>
  );

  return (
    <>
      <GeoStateMap states={states} national={national} metric={metric} onMetric={(m) => { setMetric(m); setAll(false); }} />
      <h2 className="st-table-title">
        Every state, ranked by {active} <span className="subtitle">
          highest first · US average {fmtFull(valueOf(national, metric), metric)}</span>
      </h2>
      <div className="table-card">
        <table className="data-table st-table">
          <thead>
            <tr>
              <th className="num">#</th>
              <th>State</th>
              <th className={cls("elec_ind")}>Industrial ¢/kWh</th>
              <th>Ind YoY</th>
              <th className={cls("wage")}>Constr. wage /wk <small>{wageQ}</small></th>
              <th className={cls("elec_res")}>Residential ¢/kWh</th>
              <th className={cls("gas")}>Gas /gal</th>
              <th className={cls("unemployment")}>Unemp</th>
              <th>Δ 1y</th>
            </tr>
          </thead>
          <tbody>
            {hidden ? (
              <>
                {priced.slice(0, EDGE).map((s, i) => row(s, i + 1))}
                <tr className="st-more">
                  <td colSpan={9}>
                    <button type="button" className="tool-btn" onClick={() => setAll(true)}>
                      Show the {hidden} states in between
                    </button>
                  </td>
                </tr>
                {priced.slice(-EDGE).map((s, i) => row(s, priced.length - EDGE + i + 1))}
              </>
            ) : priced.map((s, i) => row(s, i + 1))}
            {unpriced.map((s) => row(s, null))}
          </tbody>
        </table>
      </div>
    </>
  );
}
