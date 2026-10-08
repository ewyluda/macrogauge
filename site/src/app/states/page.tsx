import type { Metadata } from "next";
import Link from "next/link";
import geoJson from "../../../public/data/geo.json";
import { KpiCard } from "@/components/KpiCard";
import { DownloadData } from "@/components/DownloadData";
import { flattenRow } from "@/lib/csv";
import { StatesExplorer } from "@/components/StatesExplorer";
import { fmtSigned, fmtMonth } from "@/lib/format";
import { siteCostsHeadline } from "@/lib/siteCosts";
import { artifact } from "@/lib/artifact";
import type { Geo } from "@/lib/types";

const data = artifact<"geo", Geo>("geo", geoJson);
const wageBlank = data.states.filter((s) => s.wage_weekly.value == null).length;
const nat = data.national;
const headline = siteCostsHeadline(data.states, nat);
const quarter = (d: string | null) => (d ? `Q${Math.ceil(Number(d.slice(5, 7)) / 3)} ${d.slice(0, 4)}` : "—");

export const metadata: Metadata = {
  title: `Site Costs: ${headline ?? "industrial power, construction wages and more by state"}`,
  description:
    "Data-center site costs by state: industrial and residential electricity, private construction wages, pump prices and unemployment for all 50 states and DC — the state series behind the data-center cost index.",
};

const price = (v: number | null, unit: "$gal" | "cents" | "$wk") => {
  if (v == null) return "—";
  switch (unit) {
    case "$gal": return `$${v.toFixed(3)}`;
    case "cents": return `${v.toFixed(2)}¢`;
    case "$wk": return `$${Math.round(v).toLocaleString("en-US")}`;
  }
};

export default function States() {
  return (
    <div>
      <div className="research-eyebrow">AI infrastructure · Site costs</div>
      <h1>{headline ?? "Site Costs"}</h1>
      <p className="lede">
        What it costs to build and run a data center, state by state: the industrial power price a
        large load pays, the private construction wage its crews earn, and the residential power,
        pump-price and jobless context around them. These are the state series behind the{" "}
        <Link href="/datacenter#dc-parity">data-center cost index&apos;s parity table</Link>. Pick a metric to
        recolor the map and re-rank the table.
      </p>

      <div className="section-tools">
        <DownloadData filename="macrogauge-states" json="geo.json"
          citation={`MacroGauge state site costs, published ${data.published_at}`}
          rows={data.states.map((s) => flattenRow(s))} />
      </div>
      <div className="kpi-row">
        <KpiCard
          label="US industrial power"
          value={price(nat.elec_ind_cents.value, "cents")}
          context={`${fmtSigned(nat.elec_ind_cents.yoy_pct)} YoY · per kWh · ${nat.elec_ind_cents.as_of ? fmtMonth(nat.elec_ind_cents.as_of) : "—"}`}
          accent="sky"
        />
        <KpiCard
          label="US construction wage"
          value={price(nat.wage_weekly.value, "$wk")}
          context={`per week · ${quarter(nat.wage_weekly.as_of)} — QCEW publishes about 7 months after the quarter`}
          accent="violet"
        />
        <KpiCard
          label="US residential power"
          value={price(nat.elec_res_cents.value, "cents")}
          context={`${fmtSigned(nat.elec_res_cents.yoy_pct)} YoY · per kWh`}
          accent="amber"
        />
        <KpiCard
          label="US gas (regular)"
          value={price(nat.gas_regular.value, "$gal")}
          context={`per gallon · ${nat.gas_regular.as_of ? fmtMonth(nat.gas_regular.as_of) : "—"}`}
          accent="emerald"
        />
      </div>

      <StatesExplorer states={data.states} national={nat} />

      <p className="method">
        Sources: AAA (daily state pump prices), EIA (state residential &amp;
        industrial electricity, monthly), BLS QCEW (private construction average
        weekly wage, quarterly), FRED (state unemployment rate). Electricity
        year-over-year is each state&apos;s own latest month vs. a year earlier;
        unemployment shows the percentage-point change, not a percent change.
        Construction wages use one shared quarter: the latest quarter in the
        national QCEW series. A state missing that quarter is blank rather than
        silently showing an older, non-comparable wage
        ({wageBlank} {wageBlank === 1 ? "state is" : "states are"} blank this quarter — some are
        structurally suppressed by BLS, others are temporary state-quarter gaps). Gas year-over-year is blank until a year of daily
        state history accrues.
      </p>
    </div>
  );
}
