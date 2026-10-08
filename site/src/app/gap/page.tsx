import type { Metadata } from "next";
import gaptable from "../../../public/data/gaptable.json";
import official from "../../../public/data/official.json";
import compare from "../../../public/data/compare.json";
import { GapDecomposition } from "@/components/GapDecomposition";
import { GapVariantStrip } from "@/components/GapVariantStrip";
import { ContributionSection } from "@/components/ContributionSection";
import { Section } from "@/components/Section";
import { Term } from "@/components/Term";
import { DownloadData } from "@/components/DownloadData";
import { HeroChart } from "@/components/HeroChart";
import { LinesChart } from "@/components/LinesChart";
import gaugeDaily from "../../../public/data/gauge_daily.json";
import pulse from "../../../public/data/pulse.json";
import { columnsToRows } from "@/lib/csv";
import { C } from "@/lib/chartTheme";
import { fmtMonth, fmtPct, fmtPp } from "@/lib/format";

export const metadata: Metadata = {
  title: "Gauge Gap",
  description: "Where the daily gauge differs from BLS, reconciled component by component.",
};

// each variant's gap is taken against its own reference print (lib/reconcile
// VARIANT_REF): CPI, BLS services less rent of shelter for supercore (from
// compare.json; core CPI when an older artifact lacks it), PCEPI for PCE
const svc = (() => {
  const c = compare as unknown as { months: string[]; official_supercore_yoy_pct?: (number | null)[] };
  const col = c.official_supercore_yoy_pct;
  if (!col) return undefined;
  for (let i = col.length - 1; i >= 0; i--) if (col[i] != null) return { yoy_pct: col[i], month: c.months[i] };
  return undefined;
})();
const refs = {
  ...(svc ? { services: svc } : {}),
  cpi: { yoy_pct: official.headline.cpi.yoy_pct, month: official.headline.cpi.month },
  core: { yoy_pct: official.headline.core.yoy_pct, month: official.headline.core.month },
  pce: { yoy_pct: official.headline.pce.yoy_pct, month: official.headline.pce.month },
};
// Supercore (was /supercore, folded 2026-10-08): only electricity and utility
// gas can ride live data, so the series is usually the BLS carry-forward;
// claim "daily" only while something rides live.
const SC_LIVE = gaptable.variants.supercore.coverage_pct > 0;
const SVC = (compare as typeof compare & { official_supercore_yoy_pct?: (number | null)[] }).official_supercore_yoy_pct;
const SC_REF = SVC ?? compare.official_core_yoy_pct;
const SC_REF_NAME = SVC ? "BLS services less rent of shelter (CUUR0000SASL2RS)" : "the official core CPI print";
function supercoreLatest() {
  const sc = gaugeDaily.variants.supercore;
  let i = sc.yoy_pct.length - 1;
  while (i >= 0 && sc.yoy_pct[i] === null) i--;
  return i < 0 ? null : { yoy: sc.yoy_pct[i] as number, asOf: sc.dates[i] };
}

export default function Gap() {
  const sc = supercoreLatest();
  const v = compare.validation;
  return <div><h1>Gauge Gap <span className="subtitle">where ours differs from BLS</span></h1><p className="lede"><Term k="laspeyres">Laspeyres</Term> contribution arithmetic decomposes our gap against a 14-component reconstruction of the BLS basket — close to, but not identical to, the headline gap vs the official print.</p><GapVariantStrip variants={gaptable.variants} refs={refs} />
    {sc && <p className="method" data-testid="supercore-takeaway" id="supercore">
      Supercore — services excluding shelter, the cut the Fed watches for wage-driven inflation — reads {fmtPct(sc.yoy)},{" "}
      {fmtPp(sc.yoy - pulse.gauge.yoy_pct)} against the headline gauge,{" "}
      {SC_LIVE ? `tracked daily (as of ${sc.asOf})` : `at its latest monthly BLS-derived reading (${fmtMonth(sc.asOf)}): no live source rides it, so it moves on a CPI release`}.
    </p>}<div className="section-tools"><DownloadData rows={gaptable.rows} filename="macrogauge-gap" json="gaptable.json" citation={`MacroGauge gap decomposition, ${gaptable.as_of}, vs official ${gaptable.official_month}`} /></div><GapDecomposition rows={gaptable.rows} asOf={gaptable.as_of} officialMonth={gaptable.official_month} totalGapPp={gaptable.total_gap_pp} /><Section title="Gap contribution over time — ours minus BLS, by component"><ContributionSection defaultMode="gap" showTable={false} /></Section>
    <Section title="Validation — the gauge against CPI and core, full history" id="validation">
      <div className="chart-card"><HeroChart dates={gaugeDaily.variants.gauge.dates} gauge={gaugeDaily.variants.gauge.yoy_pct} tracker={gaugeDaily.variants.tracker.yoy_pct} col={gaugeDaily.variants.col.yoy_pct} gaugeIndex={gaugeDaily.variants.gauge.index} trackerIndex={gaugeDaily.variants.tracker.index} colIndex={gaugeDaily.variants.col.index} months={compare.months} official={compare.official_yoy_pct} core={compare.official_core_yoy_pct} /></div>
      <p className="method" data-testid="validation-stats">Against the official CPI print, month-end sampled over {v.gauge.window}: the gauge correlates {v.gauge.corr ?? "—"} with a mean absolute gap of {v.gauge.mean_abs_gap_pp ?? "—"}pp; the CPI-Tracker {v.tracker.corr ?? "—"} and {v.tracker.mean_abs_gap_pp ?? "—"}pp. Core CPI is plotted for context; no gap statistic is computed against it. Every observation carries its source vintage.</p>
    </Section>
    <Section title="Supercore vs its official reference — monthly, full history">
      <div className="section-tools">
        <DownloadData filename="macrogauge-supercore-monthly" json="compare.json"
          citation={`MacroGauge supercore vs ${SC_REF_NAME}, monthly, ${v.supercore.window}`}
          rows={columnsToRows({ name: "month", values: compare.months }, [
            { name: "supercore_yoy_pct", values: compare.supercore_yoy_pct },
            { name: SVC ? "official_services_less_rent_of_shelter_yoy_pct" : "official_core_yoy_pct", values: SC_REF },
          ])} />
      </div>
      <div className="chart-card">
        <LinesChart refLine={2} refLabel="2%" series={[
          { name: "Supercore (ours)", x: compare.months, y: compare.supercore_yoy_pct, color: C.amber },
          { name: SVC ? "BLS services less rent of shelter" : "Official core CPI", x: compare.months, y: SC_REF, color: C.muted, dashed: true, step: true },
        ]} />
      </div>
      <p className="method">
        Month-end sampling against {SC_REF_NAME}, the series supercore is graded on. Correlation {v.supercore.corr ?? "—"},
        mean absolute gap {v.supercore.mean_abs_gap_pp ?? "—"}pp over {v.supercore.window}. Supercore is a weighted average of
        six components (medical care, education and communication, recreation, electricity, utility gas and the CPI
        residual) with weights renormalized; it excludes shelter, food, gasoline, apparel and vehicles. Its coarse
        components still carry some goods, so it runs below the BLS services series; the gap is disclosed, not tuned away.
      </p>
    </Section></div>;
}
