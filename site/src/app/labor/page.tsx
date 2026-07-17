import type { Metadata } from "next";
import laborJson from "../../../public/data/labor.json";
import nowcastJson from "../../../public/data/nowcast_latest.json";
import nfpJson from "../../../public/data/accountability_nfp.json";
import { KpiCard } from "@/components/KpiCard";
import { LaborMonthlyChart, LaborClaimsChart } from "@/components/LaborCharts";
import { fmtSigned, fmtMonth } from "@/lib/format";
import type { Labor, Nowcast } from "@/lib/types";

const d = laborJson as Labor;
const nowcast = nowcastJson as Nowcast;
const nfp = nfpJson as { graded: { mae?: number; bias?: number } | Record<string, unknown> };

export const metadata: Metadata = {
  title: "Labor Market — payrolls, unemployment, claims, wages",
  description:
    "The US jobs market in one dashboard: nonfarm payrolls, unemployment, jobless claims and wage growth, with our NFP nowcast graded in public.",
};

const k = (v: number | null) => (v == null ? "—" : Math.round(v).toLocaleString("en-US"));
const signedK = (v: number | null) =>
  v == null ? "—" : `${v > 0 ? "+" : v < 0 ? "−" : ""}${Math.abs(Math.round(v)).toLocaleString("en-US")}k`;

export default function LaborPage() {
  const m = d.history.monthly;
  const w = d.history.weekly;
  const nfpNow = nowcast.nfp;
  return (
    <div>
      <h1>
        Labor Market <span className="subtitle">the jobs market, in receipts</span>
      </h1>
      <p className="lede">
        Nonfarm payrolls, unemployment, jobless claims and wage growth — the series the pipeline
        already collects, now in one place, with our next-jobs-report nowcast graded against the
        print.
      </p>

      <div className="kpi-row">
        <KpiCard label="Payrolls (MoM)" value={signedK(d.payrolls.mom_change_k)}
          context={`${k(d.payrolls.level_k)}k total · ${d.payrolls.as_of ? fmtMonth(d.payrolls.as_of) : "—"}`} accent="sky" />
        <KpiCard label="Unemployment" value={d.unemployment.rate == null ? "—" : `${d.unemployment.rate.toFixed(1)}%`}
          context={`${d.unemployment.delta_1y_pp == null ? "—" : `${d.unemployment.delta_1y_pp > 0 ? "+" : ""}${d.unemployment.delta_1y_pp.toFixed(1)}pp`} vs 1y ago`} accent="amber" />
        <KpiCard label="Initial claims" value={k(d.claims.initial)}
          context={`${k(d.claims.initial_4wk_avg)} 4-wk avg · ${d.claims.as_of ? fmtMonth(d.claims.as_of) : "—"}`} accent="violet" />
        <KpiCard label="Wage growth" value={d.wages.atlanta_wgt_pct == null ? "—" : `${d.wages.atlanta_wgt_pct.toFixed(1)}%`}
          context={`Atlanta Fed tracker · AHE ${fmtSigned(d.wages.ahe_yoy_pct)}`} accent="emerald" />
      </div>

      <div className="chart-card" style={{ padding: "12px 8px 4px" }}>
        <LaborMonthlyChart months={m.months} payrollsYoy={m.payrolls_yoy_pct} unemploymentRate={m.unemployment_rate} />
      </div>

      <div className="chart-card" style={{ padding: "12px 8px 4px" }}>
        <LaborClaimsChart dates={w.dates} initialClaims={w.initial_claims} />
      </div>

      <div className="section">
        <h2 style={{ fontSize: 18, margin: "0 0 4px" }}>Next jobs report</h2>
        <div className="kpi-row">
          <KpiCard label="NFP nowcast" value={nfpNow ? `${signedK(nfpNow.change_thousands)}` : "—"}
            context={nfpNow ? `reference ${fmtMonth(nfpNow.reference_month)}` : "awaiting sufficient history"} accent="sky" />
        </div>
        <p className="method">
          Our nonfarm-payroll nowcast for the next report, graded in public after each print
          (see the Forecast Scoreboard). Payrolls, claims and wages: BLS/DOL/FRED, monthly and
          weekly. Unemployment shows the percentage-point change vs a year ago, not a percent change.
        </p>
      </div>
    </div>
  );
}
