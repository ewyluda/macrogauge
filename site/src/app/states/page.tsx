import type { Metadata } from "next";
import geoJson from "../../../public/data/geo.json";
import { KpiCard } from "@/components/KpiCard";
import { GeoStateMap } from "@/components/GeoStateMap";
import { fmtSigned, fmtMonth, yoyColor } from "@/lib/format";
import type { Geo } from "@/lib/types";

const data = geoJson as Geo;

export const metadata: Metadata = {
  title: "State Cost Map — gas, electricity, wages, unemployment",
  description:
    "A 50-state map of pump prices, residential and industrial electricity, construction wages, and unemployment — every series the pipeline already collects for the data-center index, unlocked.",
};

const nat = data.national;

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
const signedPp1 = (pp: number, suffix = ""): string => {
  const r = Number(pp.toFixed(1));
  const s = r > 0 ? "+" : r < 0 ? "−" : "";
  return `${s}${Math.abs(r).toFixed(1)}${suffix}`;
};

export default function States() {
  // geo.json states are published alphabetical by full name already
  const rows = data.states;
  return (
    <div>
      <h1>
        State Cost Map{" "}
        <span className="subtitle">gas, power, wages &amp; jobs by state</span>
      </h1>
      <p className="lede">
        Every series here is already collected for the data-center cost index —
        pump prices, residential and industrial electricity, private construction
        wages, and unemployment — now unlocked as a 50-state view. Pick a metric to
        recolor the map.
      </p>

      <div className="kpi-row">
        <KpiCard
          label="US gas (regular)"
          value={price(nat.gas_regular.value, "$gal")}
          context={`per gallon · ${
            nat.gas_regular.as_of ? fmtMonth(nat.gas_regular.as_of) : "—"
          }`}
          accent="amber"
        />
        <KpiCard
          label="US residential power"
          value={price(nat.elec_res_cents.value, "cents")}
          context={`${fmtSigned(nat.elec_res_cents.yoy_pct)} YoY · per kWh`}
          accent="sky"
        />
        <KpiCard
          label="US construction wage"
          value={price(nat.wage_weekly.value, "$wk")}
          context={`per week · ${
            nat.wage_weekly.as_of ? fmtMonth(nat.wage_weekly.as_of) : "—"
          }`}
          accent="violet"
        />
        <KpiCard
          label="US unemployment"
          value={price(nat.unemployment_pct.value, "pct")}
          context={`${
            nat.unemployment_pct.delta_1y_pp == null
              ? "—"
              : signedPp1(nat.unemployment_pct.delta_1y_pp, "pp")
          } vs 1y ago`}
          accent="emerald"
        />
      </div>

      <GeoStateMap states={data.states} national={nat} />

      <div className="table-card">
        <table className="data-table">
          <thead>
            <tr>
              <th>State</th>
              <th>Gas /gal</th>
              <th>Elec res</th>
              <th>Res YoY</th>
              <th>Elec ind</th>
              <th>Wage /wk</th>
              <th>Unemp</th>
              <th>Δ 1y</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((s) => (
              <tr key={s.state}>
                <td>{s.name}</td>
                <td>{price(s.gas_regular.value, "$gal")}</td>
                <td>{price(s.elec_res_cents.value, "cents")}</td>
                <td style={{ color: yoyColor(s.elec_res_cents.yoy_pct) }}>
                  {fmtSigned(s.elec_res_cents.yoy_pct)}
                </td>
                <td>{price(s.elec_ind_cents.value, "cents")}</td>
                <td>{price(s.wage_weekly.value, "$wk")}</td>
                <td>{price(s.unemployment_pct.value, "pct")}</td>
                <td>
                  {s.unemployment_pct.delta_1y_pp == null
                    ? "—"
                    : signedPp1(s.unemployment_pct.delta_1y_pp)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="method">
        Sources: AAA (daily state pump prices), EIA (state residential &amp;
        industrial electricity, monthly), BLS QCEW (private construction average
        weekly wage, quarterly), FRED (state unemployment rate). Electricity
        year-over-year is each state&apos;s own latest month vs. a year earlier;
        unemployment shows the percentage-point change, not a percent change.
        Seven states have no QCEW construction wage — BLS suppresses those
        small-cell figures. Gas year-over-year is blank until a year of daily
        state history accrues.
      </p>
    </div>
  );
}
