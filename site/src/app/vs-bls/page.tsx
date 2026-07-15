import type { Metadata } from "next";
import compare from "../../../public/data/compare.json";
import gaugeDaily from "../../../public/data/gauge_daily.json";
import { HeroChart } from "@/components/HeroChart";

export const metadata: Metadata = {
  title: "Macrogauge vs BLS",
  description: "Full history and validation — how the daily gauge tracks the official print.",
};

export default function VsBls() {
  return <div><h1>Macrogauge vs BLS <span className="subtitle">history and validation</span></h1><div className="chart-card"><HeroChart dates={gaugeDaily.variants.gauge.dates} gauge={gaugeDaily.variants.gauge.yoy_pct} tracker={gaugeDaily.variants.tracker.yoy_pct} col={gaugeDaily.variants.col.yoy_pct} months={compare.months} official={compare.official_yoy_pct} core={compare.official_core_yoy_pct} /></div><p className="method">Tracker correlation: {compare.validation.tracker.corr ?? "—"}; mean absolute gap: {compare.validation.tracker.mean_abs_gap_pp ?? "—"}pp. Every observation carries its source vintage.</p></div>;
}
