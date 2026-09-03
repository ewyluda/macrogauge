import type { Metadata } from "next";
import gaptable from "../../../public/data/gaptable.json";
import pulse from "../../../public/data/pulse.json";
import { GapDecomposition } from "@/components/GapDecomposition";
import { GapVariantStrip } from "@/components/GapVariantStrip";
import { ContributionSection } from "@/components/ContributionSection";
import { Section } from "@/components/Section";
import { DownloadData } from "@/components/DownloadData";

export const metadata: Metadata = {
  title: "Gauge Gap",
  description: "Where the daily gauge differs from BLS, reconciled component by component.",
};

const pulseOfficial = { yoy_pct: pulse.official.yoy_pct, month: pulse.official.month };
export default function Gap() {
  return <div><h1>Gauge Gap <span className="subtitle">where ours differs from BLS</span></h1><p className="lede">Contribution arithmetic decomposes our gap against a 14-component reconstruction of the BLS basket — close to, but not identical to, the headline gap vs the official print.</p><GapVariantStrip variants={gaptable.variants} officialYoy={pulseOfficial} /><div className="section-tools"><DownloadData rows={gaptable.rows} filename="macrogauge-gap" json="gaptable.json" citation={`MacroGauge gap decomposition, ${gaptable.as_of}, vs official ${gaptable.official_month}`} /></div><GapDecomposition rows={gaptable.rows} asOf={gaptable.as_of} officialMonth={gaptable.official_month} totalGapPp={gaptable.total_gap_pp} /><Section title="Gap contribution over time — ours minus BLS, by component"><ContributionSection defaultMode="gap" showTable={false} /></Section></div>;
}
