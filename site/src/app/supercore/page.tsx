import type { Metadata } from "next";
import Link from "next/link";
import gaugeDaily from "../../../public/data/gauge_daily.json";
import compare from "../../../public/data/compare.json";
import { LinesChart } from "@/components/LinesChart";
import { BreadthPanel } from "@/components/BreadthPanel";
import { DownloadData } from "@/components/DownloadData";
import { columnsToRows } from "@/lib/csv";
import { C } from "@/lib/chartTheme";
import pulse from "../../../public/data/pulse.json";
import { KpiCard } from "@/components/KpiCard";
import { Section } from "@/components/Section";
import { StepChart } from "@/components/StepChart";
import { fmtPct, fmtPp } from "@/lib/format";

export const metadata: Metadata = {
  title: "Supercore Services",
  description: "Services inflation ex-shelter — the Fed's favorite cut, tracked daily.",
};

export default function Supercore() {
  const sc = gaugeDaily.variants.supercore;
  // latest non-null supercore YoY and its own date — never the raw grid end
  let last = sc.yoy_pct.length - 1;
  while (last >= 0 && sc.yoy_pct[last] === null) last--;
  const scYoy = sc.yoy_pct[last] as number;
  const scAsOf = sc.dates[last];
  const spread = scYoy - pulse.gauge.yoy_pct;

  // chart from 2019: the original's window; earlier months render tightly anyway
  const from = sc.dates.findIndex((d) => d >= "2019-01-01");
  return (
    <div>
      <h1 style={{ fontSize: 26, fontWeight: 700, margin: "24px 0 0" }}>
        Supercore Services{" "}
        <span style={{ color: "var(--muted)", fontWeight: 400, fontSize: 16 }}>
          the Fed&apos;s favorite cut — services inflation ex-shelter, tracked daily
        </span>
      </h1>

      <div style={{ display: "flex", gap: 16, flexWrap: "wrap", marginTop: 24 }}>
        <KpiCard
          label="Supercore YoY (today)"
          value={fmtPct(scYoy)}
          context={`as of ${scAsOf}`}
          accent="amber"
        />
        <KpiCard
          label="Headline macrogauge"
          value={fmtPct(pulse.gauge.yoy_pct)}
          context={`the full-basket gauge · as of ${pulse.gauge.as_of}`}
          accent="sky"
        />
        <KpiCard
          label="Spread"
          value={fmtPp(spread)}
          context={`supercore minus headline — sticky-services pressure · supercore ${scAsOf} vs gauge ${pulse.gauge.as_of}`}
          accent={spread > 0 ? "red" : "emerald"}
        />
      </div>

      <Section title="Supercore YoY — daily, since 2019">
        <div
          style={{
            background: "var(--card)",
            border: "1px solid var(--border)",
            borderRadius: 10,
            padding: "12px 8px 4px",
          }}
        >
          <StepChart
            dates={sc.dates.slice(from)}
            values={sc.yoy_pct.slice(from)}
            index={sc.index.slice(from)}
            refLine={2}
            refLabel="Fed 2% (core PCE target)"
          />
        </div>
      </Section>

      <Section title="Breadth across the whole basket">
        <BreadthPanel compact />
        <p className="method">Latest-month breadth over all 14 components (full charts on the <Link href="/">homepage</Link>) — context for whether services stickiness is broad or narrow.</p>
      </Section>

      <Section title="Supercore vs core CPI — monthly, full history">
        <div className="section-tools">
          <DownloadData filename="macrogauge-supercore-monthly" json="compare.json"
            citation={`MacroGauge supercore vs core CPI, monthly, ${compare.validation.supercore.window}`}
            rows={columnsToRows({ name: "month", values: compare.months }, [
              { name: "supercore_yoy_pct", values: compare.supercore_yoy_pct },
              { name: "official_core_yoy_pct", values: compare.official_core_yoy_pct },
            ])} />
        </div>
        <div className="chart-card">
          <LinesChart
            series={[
              { name: "Supercore (ours)", x: compare.months, y: compare.supercore_yoy_pct, color: C.amber },
              { name: "Official core CPI", x: compare.months, y: compare.official_core_yoy_pct, color: C.muted, dashed: true, step: true },
            ]}
            refLine={2}
            refLabel="2%"
          />
        </div>
        <p className="method">
          Month-end sampling of the daily series against the official core CPI print — the series supercore is
          graded on. Correlation {compare.validation.supercore.corr ?? "—"}, mean absolute gap{" "}
          {compare.validation.supercore.mean_abs_gap_pp ?? "—"}pp over {compare.validation.supercore.window}. A
          four-component services cut will not track a 200-item core index tightly; the gap is the point, not a defect.
        </p>
      </Section>

      <Section title="Methodology">
        <div style={{ fontSize: 13, color: "var(--muted)", lineHeight: 1.6 }}>
          Weighted average of our service components — medical care, education &amp;
          communication, recreation, and other goods &amp; services — with weights
          renormalized; excludes shelter, goods, food-at-home, energy and vehicles
          (config: supercore_components in basket.json). Why it matters: goods prices
          swing with supply chains and energy with OPEC — supercore is the wage-driven
          core the Fed watches to judge whether inflation is entrenched. Grades against
          core CPI; see <a href="/methodology" style={{ color: "var(--accent-sky)" }}>
          methodology</a> for validation stats.
        </div>
      </Section>
    </div>
  );
}
