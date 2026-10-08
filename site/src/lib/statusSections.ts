// /status groups every self-test check and every source by the site section
// it serves, AI Infra first. The sections are the header nav's groups
// (lib/nav.ts), so a renamed or reordered nav group moves here too; checks
// that guard the whole run sit under "Pipeline", and sources several sections
// read under "Shared". statusSections.test.ts fails on any published check
// or source without an explicit home, so a new phase can't land unsorted.
import capacityCfg from "../../../config/capacity.json";
import marketsCfg from "../../../config/dc_markets.json";
import pipelineCfg from "../../../config/dc_market_pipeline.json";
import longleadCfg from "../../../config/dc_longlead.json";
import newsCfg from "../../../config/ai_news.json";
import { NAV } from "./nav";

const LEAD = "AI Infra";
/** Nav group labels, AI Infra first, then nav order; About is not a data section. */
export const NAV_SECTIONS: string[] = (() => {
  const groups = NAV.filter((e) => e.kind === "group").map((g) => g.label).filter((l) => l !== "About");
  return [LEAD, ...groups.filter((l) => l !== LEAD)];
})();
export const CHECK_SECTIONS = [...NAV_SECTIONS, "Pipeline"];
export const SOURCE_SECTIONS = [...NAV_SECTIONS, "Shared"];

export const CHECK_SECTION: Record<string, string> = {
  // AI Infra phases (one *_ok per isolated run_daily phase)
  datacenter_ok: "AI Infra", capacity_ok: "AI Infra", markets_ok: "AI Infra", grades_ok: "AI Infra",
  longlead_ok: "AI Infra", rates_ok: "AI Infra", compute_ok: "AI Infra", commodities_ok: "AI Infra",
  geography_ok: "AI Infra", news_ok: "AI Infra", ledger_ok: "AI Infra",
  // the gauge
  headline_current: "Inflation", yoy_finite: "Inflation", engine_ok: "Inflation", gauge_current: "Inflation",
  gauge_components_present: "Inflation", basket_weights_sum: "Inflation", gauge_coverage: "Inflation",
  tracker_corr: "Inflation", fuel_sources_agree: "Inflation", quilt_complete: "Inflation",
  grocery_items: "Inflation", changes_ok: "Inflation",
  // forecasts
  nowcast_ok: "Forecasts", outlook_ok: "Forecasts", nowcast_fresh: "Forecasts", ensemble_computed: "Forecasts",
  calendar_horizon: "Forecasts", revisions_ok: "Forecasts",
  // economy
  composites_ok: "Economy", labor_ok: "Economy", housing_ok: "Economy",
  // the whole run
  single_run_stamp: "Pipeline", connectors_ok: "Pipeline", sources_fresh: "Pipeline", expected_absence: "Pipeline",
};

export const SOURCE_SECTION: Record<string, string> = {
  AWS_GPU: "AI Infra", AZURE_GPU: "AI Infra", OCI_GPU: "AI Infra", COREWEAVE: "AI Infra", NEBIUS: "AI Infra",
  VASTAI: "AI Infra", SFCOMPUTE: "AI Infra", OPENROUTER: "AI Infra", DRAMEX: "AI Infra", FMP_EQ: "AI Infra",
  QCEW: "AI Infra", QCEW_238212: "AI Infra", CENSUS: "AI Infra", CAISO: "AI Infra", MISO: "AI Infra",
  ERCOT: "AI Infra", SPP: "AI Infra", NYISO: "AI Infra", ICE: "AI Infra", EIA_SPOT: "AI Infra",
  EIA_STATE: "AI Infra", EIA_STATE_RES: "AI Infra", KALSHI_DC: "AI Infra", TREASURY: "AI Infra",
  AAA: "Inflation", AAA_STATE: "Inflation", APTLIST: "Inflation", MANHEIM: "Inflation", MND: "Inflation",
  PMMS: "Inflation", ZILLOW: "Inflation", USDA: "Inflation",
  CLEVELAND: "Forecasts", KALSHI: "Forecasts", KALSHI_CORE: "Forecasts", KALSHI_FED: "Forecasts",
  STEO: "Forecasts", NYFED: "Forecasts", ATLFED: "Forecasts",
  FRED: "Shared", BLS: "Shared", FMP: "Shared", EIA: "Shared",
};

/** Items grouped by section, in section order; empty sections dropped. */
export function groupBy<T>(items: T[], sectionOf: (t: T) => string, order: string[]): { section: string; items: T[] }[] {
  return order.map((section) => ({ section, items: items.filter((t) => sectionOf(t) === section) }))
    .filter((g) => g.items.length > 0);
}

export type Freshness = { fresh: number; stale: number; absent: number };
/** Per-source series freshness from methodology.json's inventory (the
 *  pipeline's freshness classifier): fresh / stale / under an expected-
 *  absence policy. */
export function sourceFreshness(inventory: { source: string; fresh: boolean; absence?: string | null }[]): Record<string, Freshness> {
  const out: Record<string, Freshness> = {};
  for (const r of inventory) {
    const f = (out[r.source] ??= { fresh: 0, stale: 0, absent: 0 });
    if (r.fresh) f.fresh += 1;
    else if (r.absence) f.absent += 1;
    else f.stale += 1;
  }
  return out;
}

/** The hand-curated inputs behind the AI Infra pages and when each was last
 *  reviewed (their configs' as_of_curated), read at build time. */
export const CURATED_INPUTS: { label: string; href: string; reviewed: string; note?: string }[] = [
  { label: "AI capacity tracker (MW per company)", href: "/capacity", reviewed: capacityCfg.as_of_curated },
  { label: "DC market panel (counties, tags)", href: "/markets", reviewed: marketsCfg.as_of_curated },
  { label: "Market construction pipeline (Cushman & Wakefield)", href: "/markets", reviewed: pipelineCfg.as_of_curated,
    note: `${pipelineCfg.source.doc}, published ${pipelineCfg.source.doc_date}` },
  { label: "Long-lead vendor figures and lead times", href: "/longlead", reviewed: longleadCfg.as_of_curated },
  { label: "AI news ticker universe", href: "/news", reviewed: newsCfg.as_of_curated },
];

/** Whole days from `from` to `to` (YYYY-MM-DD). */
export function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(to.slice(0, 10)) - Date.parse(from.slice(0, 10))) / 86_400_000);
}
