import type { Metadata } from "next";
import laborJson from "../../../public/data/labor.json";
import nowcastJson from "../../../public/data/nowcast_latest.json";
import nfpJson from "../../../public/data/accountability_nfp.json";
import { KpiCard } from "@/components/KpiCard";
import { LaborMonthlyChart, LaborClaimsChart } from "@/components/LaborCharts";
import { fmtSigned, fmtMonth, fmtPct } from "@/lib/format";
import realWagesJson from "../../../public/data/real_wages.json";
import pulse from "../../../public/data/pulse.json";
import compare from "../../../public/data/compare.json";
import { Section } from "@/components/Section";
import { RaiseCalculator } from "@/components/RaiseCalculator";
import { WageChart } from "@/components/WageChart";
import type { Labor, Nowcast } from "@/lib/types";
import { StaleBanner } from "@/components/StaleBanner";
import { LinesChart } from "@/components/LinesChart";
import { C } from "@/lib/chartTheme";
import Link from "next/link";

const d = laborJson as Labor;
// real-wage panel (was /real-wages, folded 2026-10-08); the construction
// trades series is optional on older real_wages.json files
const rw = realWagesJson as typeof realWagesJson & { series: { construction_ahe_yoy_pct?: (number | null)[] } };
const real = (wagePct: number, inflPct: number) => ((1 + wagePct / 100) / (1 + inflPct / 100) - 1) * 100;
function lastOf(months: string[], xs: (number | null)[] | undefined) {
  if (!xs) return null;
  for (let i = xs.length - 1; i >= 0; i--) if (xs[i] != null) return { v: xs[i] as number, month: months[i] };
  return null;
}
const nowcast = nowcastJson as Nowcast;
// accountability_nfp.graded is an array of graded prints (error = forecast −
// actual, thousands); empty until the first NFP print grades after 2026-07.
const nfp = nfpJson as {
  graded: { reference_period: string; forecast: number; actual: number | null; error: number | null }[];
};

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
  const graded = nfp.graded.filter((g) => g.error != null);
  const mae = graded.length
    ? graded.reduce((s, g) => s + Math.abs(g.error as number), 0) / graded.length
    : null;
  const bias = graded.length
    ? graded.reduce((s, g) => s + (g.error as number), 0) / graded.length
    : null;
  return (
    <div>
      <StaleBanner publishedAt={laborJson.published_at} />
      <h1>
        Labor Market <span className="subtitle">the jobs market, in receipts</span>
      </h1>
      <p className="lede">
        Nonfarm payrolls, unemployment, jobless claims and wage growth — the series the pipeline
        already collects, now in one place, with our next-jobs-report nowcast graded against the
        print.
      </p>

      <ConstructionBand />

      <div className="kpi-row">
        <KpiCard label="Payrolls (MoM)" value={signedK(d.payrolls.mom_change_k)}
          context={`${k(d.payrolls.level_k)}k total · ${d.payrolls.as_of ? fmtMonth(d.payrolls.as_of) : "—"}`} accent="sky" />
        <KpiCard label="Unemployment" value={d.unemployment.rate == null ? "—" : `${d.unemployment.rate.toFixed(1)}%`}
          context={`${d.unemployment.delta_1y_pp == null ? "—" : `${d.unemployment.delta_1y_pp > 0 ? "+" : ""}${d.unemployment.delta_1y_pp.toFixed(1)}pp`} vs 1y ago`} accent="amber" />
        <KpiCard label="Initial claims" value={k(d.claims.initial)}
          context={`${k(d.claims.initial_4wk_avg)} 4-wk avg · continued ${k(d.claims.continued)} · ${d.claims.as_of ? fmtMonth(d.claims.as_of) : "—"}`} accent="violet" />
        <KpiCard label="Wage growth" value={d.wages.atlanta_wgt_pct == null ? "—" : `${d.wages.atlanta_wgt_pct.toFixed(1)}%`}
          context={`Atlanta Fed tracker · AHE ${fmtSigned(d.wages.ahe_yoy_pct)}`} accent="emerald" />
      </div>

      <div className="chart-card" style={{ padding: "12px 8px 4px" }}>
        <LaborMonthlyChart months={m.months} payrollsYoy={m.payrolls_yoy_pct} unemploymentRate={m.unemployment_rate} />
      </div>

      <div className="chart-card" style={{ padding: "12px 8px 4px" }}>
        <LaborClaimsChart dates={w.dates} initialClaims={w.initial_claims} />
      </div>

      <RealWagePanel />

      <div className="section">
        <h2 style={{ fontSize: 18, margin: "0 0 4px" }}>Next jobs report</h2>
        <div className="kpi-row">
          <KpiCard label="NFP nowcast" value={nfpNow ? `${signedK(nfpNow.change_thousands)}` : "—"}
            context={nfpNow ? `reference ${fmtMonth(nfpNow.reference_month)}` : "awaiting sufficient history"} accent="sky" />
          <KpiCard label="Grading receipts"
            value={mae == null ? "—" : `${Math.round(mae)}k MAE`}
            context={graded.length === 0
              ? "no graded prints yet — accruing"
              : `${graded.length} print${graded.length === 1 ? "" : "s"} · bias ${bias! > 0 ? "+" : bias! < 0 ? "−" : ""}${Math.abs(Math.round(bias!))}k (forecast − actual)`}
            accent="emerald" />
        </div>
        <p className="method">
          Our nonfarm-payroll nowcast for the next report, graded in public after each print — the
          receipts card fills in as prints land (see the Forecast Scoreboard for the full
          per-print history). Payrolls, claims and wages: BLS/DOL/FRED, monthly and weekly.
          Unemployment shows the percentage-point change vs a year ago, not a percent change.
        </p>
      </div>
    </div>
  );
}

// the shared NBER_RECESSIONS starts at 2020 (site charts open in 2018); the
// non-craft share runs from 1990, so it shades its own
const RECESSIONS_SINCE_1990 = [["1990-07-01", "1991-03-31"], ["2001-03-01", "2001-11-30"],
  ["2007-12-01", "2009-06-30"], ["2020-02-01", "2020-04-30"]].map(([from, to]) => ({ from, to, label: "" }));

function ConstructionBand() {
  const c = d.construction;
  if (!c) return null;
  const m = d.history.monthly;
  const mix = d.construction_mix?.as_of ? d.construction_mix : null;
  const shareChg = mix?.noncraft_share_pct != null && mix.share_1y_ago_pct != null ? mix.noncraft_share_pct - mix.share_1y_ago_pct : null;
  const premium = c.ahe_yoy_pct != null && c.private_ahe_yoy_pct != null ? c.ahe_yoy_pct - c.private_ahe_yoy_pct : null;
  return (
    <Section title="Construction labour — the trades a data-center build competes for" id="construction">
      <div className="kpi-row" data-testid="construction-band">
        <KpiCard label="Construction jobs" value={c.employment_k == null ? "—" : `${k(c.employment_k)}k`}
          context={`${signedK(c.mom_change_k)} on the month · ${fmtSigned(c.employment_yoy_pct)} YoY · ${c.employment_as_of ? fmtMonth(c.employment_as_of) : "—"}`} accent="sky" />
        <KpiCard label="Construction pay" value={c.ahe == null ? "—" : `$${c.ahe.toFixed(2)}/hr`}
          context={`${fmtSigned(c.ahe_yoy_pct)} YoY vs ${fmtSigned(c.private_ahe_yoy_pct)} all private${premium == null ? "" : ` (${premium >= 0 ? "+" : "−"}${Math.abs(premium).toFixed(1)}pp)`} · ${c.ahe_as_of ? fmtMonth(c.ahe_as_of) : "—"}`} accent="amber" />
        <KpiCard label="Construction openings" value={c.openings_k == null ? "—" : `${k(c.openings_k)}k`}
          context={`${c.openings_rate == null ? "—" : `${c.openings_rate.toFixed(1)}%`} openings rate · ${c.openings_1y_ago_k == null ? "—" : `${k(c.openings_1y_ago_k)}k`} a year earlier · ${c.openings_as_of ? fmtMonth(c.openings_as_of) : "—"}`} accent="violet" />
      </div>
      {m.construction_yoy_pct && m.construction_yoy_pct.some((v) => v != null) && (
        <div className="chart-card" style={{ padding: "12px 8px 4px" }}>
          <LinesChart height={240} recessions={false} ariaTitle="Construction jobs vs all payrolls, year over year"
            series={[
              { name: "Construction jobs YoY", x: m.months, y: m.construction_yoy_pct, color: C.sky },
              { name: "All payrolls YoY", x: m.months, y: m.payrolls_yoy_pct, color: C.muted },
            ]} />
        </div>
      )}
      {mix && (
        <div className="kpi-row" data-testid="noncraft-kpis">
          <KpiCard label="Non-craft share of jobs" value={mix.noncraft_share_pct == null ? "—" : `${mix.noncraft_share_pct.toFixed(1)}%`}
            context={`${mix.noncraft_per_100_craft == null ? "—" : mix.noncraft_per_100_craft.toFixed(1)} per 100 craft workers · ${shareChg == null ? "—" : `${shareChg >= 0 ? "+" : "−"}${Math.abs(shareChg).toFixed(1)}pp`} on the year · ${fmtMonth(mix.as_of as string)}`} accent="emerald" />
          {mix.payroll_as_of && (
            <KpiCard label="Non-craft share of payroll" value={mix.noncraft_payroll_share_pct == null ? "—" : `${mix.noncraft_payroll_share_pct.toFixed(1)}%`}
              context={`non-craft staff earn ${mix.noncraft_pay_ratio == null ? "—" : `${mix.noncraft_pay_ratio.toFixed(2)}×`} craft weekly pay · ${fmtMonth(mix.payroll_as_of)}`} accent="violet" />
          )}
        </div>
      )}
      {mix && mix.history.months.length > 0 && (
        <div className="chart-card" style={{ padding: "12px 8px 4px" }} data-testid="noncraft-share">
          <LinesChart height={260} fitY recessions={false} bands={RECESSIONS_SINCE_1990}
            ariaTitle="Non-craft staff as a share of construction jobs since 1990 and of construction payroll since 2006"
            series={[
              { name: "Share of jobs", x: mix.history.months, y: mix.history.noncraft_share_pct, color: C.emerald },
              { name: "Share of payroll", x: mix.history.months, y: mix.history.noncraft_payroll_share_pct, color: C.violet },
            ]} />
        </div>
      )}
      <p className="method">
        BLS construction employment (USCONS) and average hourly earnings (CES2000000003), the latter set against all
        private workers in the same month; JOLTS construction job openings and openings rate (JTS2300JOL, JTS2300JOR),
        which publish about two months behind. National totals: county-level construction headcount and wages for 20
        data-center markets are on <Link href="/markets">Markets</Link>. Non-craft staff are all construction employees
        less production and nonsupervisory employees (CES2000000006: trades, laborers and working foremen), which leaves
        managers, project managers, estimators, engineers and office staff. A rising share means more of that indirect
        headcount per craft worker, a cost owners pay per unit of work put in place that no wage or materials index
        shows. Headcount alone cannot say whether the extra staff is overhead or scope that projects now require.
        The payroll share prices each group at its average weekly earnings (CES2000000011 for all employees, which
        starts in March 2006; CES2000000030 for craft): when it rises more slowly than the jobs share, the added
        non-craft staff are paid less, relative to craft, than before. Shaded: NBER recessions.
      </p>
    </Section>
  );
}

function RealWagePanel() {
  const k = rw.kpis;
  const constr = lastOf(rw.series.months, rw.series.construction_ahe_yoy_pct);
  const constrReal = constr ? real(constr.v, pulse.gauge.yoy_pct) : null;
  return (
    <Section title="Real wages — pay against inflation" id="real-wages">
      <div className="kpi-row">
        <KpiCard label="Wage growth (Atlanta Fed)" value={k.wage_growth_pct == null ? "—" : fmtPct(k.wage_growth_pct)}
          context={`median, 3mo MA · ${k.wage_as_of ? fmtMonth(k.wage_as_of) : "—"}`} accent="emerald" />
        <KpiCard label="Inflation right now" value={fmtPct(pulse.gauge.yoy_pct)}
          context={`macrogauge, daily · ${pulse.gauge.as_of}`} accent="amber" />
        <KpiCard label="Real wage growth" value={k.real_wage_growth_pct == null ? "—" : fmtPct(k.real_wage_growth_pct)}
          context={`${k.wage_as_of ? fmtMonth(k.wage_as_of) : "—"} wages deflated by ${pulse.gauge.as_of} inflation — mixed periods`}
          accent={k.real_wage_growth_pct != null && k.real_wage_growth_pct < 0 ? "red" : "emerald"} />
        {constr && constrReal != null && (
          <KpiCard label="Construction trades, real" value={fmtPct(constrReal)}
            context={`hourly earnings ${fmtSigned(constr.v)} YoY (${fmtMonth(constr.month)}) against ${fmtPct(pulse.gauge.yoy_pct)} inflation`}
            accent={constrReal < 0 ? "red" : "sky"} />
        )}
      </div>
      <div className="chart-card" style={{ padding: "12px 8px 4px" }}>
        <WageChart months={rw.series.months} wgt={rw.series.atlanta_wgt_yoy_pct} ahe={rw.series.ahe_yoy_pct}
          construction={rw.series.construction_ahe_yoy_pct} gaugeMonths={compare.months} gaugeYoy={compare.gauge_yoy_pct} />
      </div>
      <details className="inv-details" data-testid="raise-calculator">
        <summary>Check your own raise, in real terms</summary>
        <RaiseCalculator gaugeYoy={pulse.gauge.yoy_pct} officialYoy={pulse.official.yoy_pct} officialMonth={pulse.official.month} />
      </details>
      <p className="method">
        When a wage line sits above the amber gauge, pay is beating prices. Atlanta Fed Wage Growth Tracker (unweighted
        median, 3-month moving average, same-person wages); BLS average hourly earnings for all private workers and for
        construction (CES2000000003), the trades the data-center build-out competes for. Real change = (1 + wage growth)
        ÷ (1 + inflation) − 1, mixing each wage series&apos; latest month with today&apos;s gauge.
      </p>
    </Section>
  );
}

