import type { Metadata } from "next";
import realWages from "../../../public/data/real_wages.json";
import pulse from "../../../public/data/pulse.json";
import compare from "../../../public/data/compare.json";
import { KpiCard } from "@/components/KpiCard";
import { Section } from "@/components/Section";
import { RaiseCalculator } from "@/components/RaiseCalculator";
import { WageChart } from "@/components/WageChart";
import { fmtMonth, fmtPct } from "@/lib/format";

export const metadata: Metadata = {
  title: "Real Wage Tracker",
  description: "Wage growth minus inflation, live — is your raise real?",
};

export default function RealWages() {
  const k = realWages.kpis;
  return (
    <div>
      <h1 style={{ fontSize: 26, fontWeight: 700, margin: "24px 0 0" }}>
        Real Wage Tracker{" "}
        <span style={{ color: "var(--muted)", fontWeight: 400, fontSize: 16 }}>
          wage growth vs the daily inflation gauge — and a calculator for your own raise
        </span>
      </h1>

      <div style={{ display: "flex", gap: 16, flexWrap: "wrap", marginTop: 24 }}>
        <KpiCard
          label="Wage growth (Atlanta Fed)"
          value={k.wage_growth_pct === null ? "—" : fmtPct(k.wage_growth_pct)}
          context={`median, 3mo MA · as of ${k.wage_as_of ? fmtMonth(k.wage_as_of) : "—"}`}
          accent="emerald"
        />
        <KpiCard
          label="Inflation right now"
          value={fmtPct(pulse.gauge.yoy_pct)}
          context={`macrogauge, daily · as of ${pulse.gauge.as_of}`}
          accent="amber"
        />
        <KpiCard
          label="Real wage growth"
          value={k.real_wage_growth_pct === null ? "—" : fmtPct(k.real_wage_growth_pct)}
          context={`typical wage growth minus today's inflation · wage ${
            k.wage_as_of ? fmtMonth(k.wage_as_of) : "—"
          } vs gauge ${pulse.gauge.as_of}`}
          accent={
            k.real_wage_growth_pct !== null && k.real_wage_growth_pct < 0
              ? "red"
              : "emerald"
          }
        />
      </div>

      <Section title="Your raise, in real terms">
        <RaiseCalculator
          gaugeYoy={pulse.gauge.yoy_pct}
          officialYoy={pulse.official.yoy_pct}
          officialMonth={pulse.official.month}
        />
      </Section>

      <Section title="Wages vs inflation — when green is above amber, paychecks are winning">
        <div
          style={{
            background: "var(--card)",
            border: "1px solid var(--border)",
            borderRadius: 10,
            padding: "12px 8px 4px",
          }}
        >
          <WageChart
            months={realWages.series.months}
            wgt={realWages.series.atlanta_wgt_yoy_pct}
            ahe={realWages.series.ahe_yoy_pct}
            gaugeMonths={compare.months}
            gaugeYoy={compare.gauge_yoy_pct}
          />
        </div>
      </Section>

      <Section title="Methodology">
        <div style={{ fontSize: 13, color: "var(--muted)", lineHeight: 1.6 }}>
          Sources: Atlanta Fed Wage Growth Tracker (unweighted median, 3-month moving
          average, same-person wages; FRED FRBATLWGT3MMAUMHWGO), BLS Average Hourly
          Earnings, total private (YoY computed in the pipeline; FRED CES0500000003),
          and the macrogauge daily gauge. Real change = (1 + raise) ÷ (1 + inflation) − 1.
          The original site&apos;s second wage line (Indeed posted wages) is not publicly
          feedable — AHE stands in until Phase 4&apos;s labor.json.
        </div>
      </Section>
    </div>
  );
}
