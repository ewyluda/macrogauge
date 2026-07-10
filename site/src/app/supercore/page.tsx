import type { Metadata } from "next";
import gaugeDaily from "../../../public/data/gauge_daily.json";
import pulse from "../../../public/data/pulse.json";
import { KpiCard } from "@/components/KpiCard";
import { Section } from "@/components/Section";
import { StepChart } from "@/components/StepChart";
import { fmtPct, fmtPp } from "@/lib/format";

export const metadata: Metadata = { title: "Supercore Services — macrogauge" };

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
          context="supercore minus headline — sticky-services pressure"
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
            refLine={2}
            refLabel="Fed 2% (core PCE target)"
          />
        </div>
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
