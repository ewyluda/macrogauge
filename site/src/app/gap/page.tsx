import type { Metadata } from "next";
import gaptable from "../../../public/data/gaptable.json";
import official from "../../../public/data/official.json";
import { GapDecomposition } from "@/components/GapDecomposition";
import { GapVariantStrip } from "@/components/GapVariantStrip";
import { ContributionSection } from "@/components/ContributionSection";
import { Section } from "@/components/Section";
import { Term } from "@/components/Term";
import { DownloadData } from "@/components/DownloadData";

export const metadata: Metadata = {
  title: "Gauge Gap",
  description: "Where the daily gauge differs from BLS, reconciled component by component.",
};

// each variant's gap is taken against its own reference print (lib/reconcile
// VARIANT_REF): CPI, core CPI for supercore, PCEPI for the PCE-weighted gauge
const refs = {
  cpi: { yoy_pct: official.headline.cpi.yoy_pct, month: official.headline.cpi.month },
  core: { yoy_pct: official.headline.core.yoy_pct, month: official.headline.core.month },
  pce: { yoy_pct: official.headline.pce.yoy_pct, month: official.headline.pce.month },
};
export default function Gap() {
  return <div><h1>Gauge Gap <span className="subtitle">where ours differs from BLS</span></h1><p className="lede"><Term k="laspeyres">Laspeyres</Term> contribution arithmetic decomposes our gap against a 14-component reconstruction of the BLS basket — close to, but not identical to, the headline gap vs the official print.</p><GapVariantStrip variants={gaptable.variants} refs={refs} /><div className="section-tools"><DownloadData rows={gaptable.rows} filename="macrogauge-gap" json="gaptable.json" citation={`MacroGauge gap decomposition, ${gaptable.as_of}, vs official ${gaptable.official_month}`} /></div><GapDecomposition rows={gaptable.rows} asOf={gaptable.as_of} officialMonth={gaptable.official_month} totalGapPp={gaptable.total_gap_pp} /><Section title="Gap contribution over time — ours minus BLS, by component"><ContributionSection defaultMode="gap" showTable={false} /></Section></div>;
}
