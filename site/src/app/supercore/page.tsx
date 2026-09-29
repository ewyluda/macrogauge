import type { Metadata } from "next";
import Link from "next/link";
import gaugeDaily from "../../../public/data/gauge_daily.json";
import compare from "../../../public/data/compare.json";
import gaptable from "../../../public/data/gaptable.json";
import { LinesChart } from "@/components/LinesChart";
import { BreadthPanel } from "@/components/BreadthPanel";
import { DownloadData } from "@/components/DownloadData";
import { columnsToRows } from "@/lib/csv";
import { C } from "@/lib/chartTheme";
import pulse from "../../../public/data/pulse.json";
import { KpiCard } from "@/components/KpiCard";
import { Section } from "@/components/Section";
import { StepChart } from "@/components/StepChart";
import { fmtMonth, fmtPct, fmtPp } from "@/lib/format";

// Only electricity and utility gas can ride live data (an EIA like-month
// tail past the last BLS print, which EIA rarely has), so the series is
// usually the BLS carry-forward and moves on a CPI release. Claim "daily"
// only while something rides live.
const LIVE = gaptable.variants.supercore.coverage_pct > 0;

// compare.json gained official_supercore_yoy_pct (BLS services less rent of
// shelter, supercore's reference) on 2026-09-28; older artifacts fall back to
// core CPI, the reference until then.
const SVC = (compare as typeof compare & { official_supercore_yoy_pct?: (number | null)[] })
  .official_supercore_yoy_pct;
const REF = SVC ?? compare.official_core_yoy_pct;
const REF_NAME = SVC ? "BLS services less rent of shelter (CUUR0000SASL2RS)" : "the official core CPI print";

export const metadata: Metadata = {
  title: "Supercore Services",
  description: LIVE
    ? "Services inflation ex-shelter — the Fed's favorite cut, tracked daily."
    : "Services inflation ex-shelter — the Fed's favorite cut, at the latest monthly BLS-derived reading.",
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
          the Fed&apos;s favorite cut — services inflation ex-shelter,{" "}
          {LIVE ? "tracked daily" : `latest monthly BLS-derived reading (${fmtMonth(scAsOf)})`}
        </span>
      </h1>

      <div style={{ display: "flex", gap: 16, flexWrap: "wrap", marginTop: 24 }}>
        <KpiCard
          label={LIVE ? "Supercore YoY (today)" : `Supercore YoY (${fmtMonth(scAsOf)} BLS)`}
          value={fmtPct(scYoy)}
          context={LIVE
            ? `as of ${scAsOf}`
            : `latest BLS month, as of ${scAsOf} · no live source (${gaptable.variants.supercore.coverage_pct.toFixed(0)}% coverage) — moves only on a CPI release`}
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

      <Section title={LIVE ? "Supercore YoY — daily, since 2019" : "Supercore YoY — since 2019, stepping with each BLS print"}>
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

      <Section title="Supercore vs its official reference — monthly, full history">
        <div className="section-tools">
          <DownloadData filename="macrogauge-supercore-monthly" json="compare.json"
            citation={`MacroGauge supercore vs ${REF_NAME}, monthly, ${compare.validation.supercore.window}`}
            rows={columnsToRows({ name: "month", values: compare.months }, [
              { name: "supercore_yoy_pct", values: compare.supercore_yoy_pct },
              { name: SVC ? "official_services_less_rent_of_shelter_yoy_pct" : "official_core_yoy_pct", values: REF },
            ])} />
        </div>
        <div className="chart-card">
          <LinesChart
            series={[
              { name: "Supercore (ours)", x: compare.months, y: compare.supercore_yoy_pct, color: C.amber },
              { name: SVC ? "BLS services less rent of shelter" : "Official core CPI", x: compare.months, y: REF, color: C.muted, dashed: true, step: true },
            ]}
            refLine={2}
            refLabel="2%"
          />
        </div>
        <p className="method">
          Month-end sampling of the daily series against {REF_NAME} — the series supercore is
          graded on. Correlation {compare.validation.supercore.corr ?? "—"}, mean absolute gap{" "}
          {compare.validation.supercore.mean_abs_gap_pp ?? "—"}pp over {compare.validation.supercore.window}. The six
          coarse components still carry goods (drugs, computers, TVs; furnishings and tobacco inside the CPI
          residual), so the approximation runs below the BLS services series. The gap is disclosed, not tuned away.
        </p>
      </Section>

      <Section title="Methodology">
        <div style={{ fontSize: 13, color: "var(--muted)", lineHeight: 1.6 }}>
          Weighted average of six components — medical care, education &amp; communication, recreation,
          electricity, utility gas and the CPI residual (everything outside the 13 named components, about 45% of
          the cut) — with weights renormalized; excludes shelter, food, gasoline, apparel and vehicles (config:
          supercore_components in basket.json). It approximates BLS &ldquo;services less rent of shelter&rdquo;
          and is graded against it; like that series, and unlike the market &ldquo;supercore&rdquo;, it includes
          energy services. Why it matters: goods prices swing with supply chains and energy with OPEC — services
          ex-shelter is the wage-driven core the Fed watches to judge whether inflation is entrenched. See{" "}
          <a href="/methodology" style={{ color: "var(--accent-sky)" }}>
          methodology</a> for validation stats.
        </div>
      </Section>
    </div>
  );
}
