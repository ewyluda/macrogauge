/** Every published artifact under /public/data, with a one-line description
 *  for the footer "Data" row and the JSON download buttons. A vitest pins
 *  this list to the directory listing so a new artifact cannot ship
 *  unlisted (and a removed one cannot leave a dead link). */
export type DataSection = "AI Infra" | "Inflation" | "Forecasts" | "Economy" | "System";
export type DataFile = { file: string; description: string; section: DataSection };
/** /data's grouping: the nav's data sections, AI Infra first (pinned to
 *  lib/nav.ts by dataFiles.test.ts), then the run's own receipts. */
export const DATA_SECTIONS: DataSection[] = ["AI Infra", "Inflation", "Forecasts", "Economy", "System"];

export const DATA_FILES: DataFile[] = [
  { file: "pulse.json", description: "Headline readings: gauge, tracker, official, gap, next print" , section: "Inflation" },
  { file: "gauge_daily.json", description: "Daily index + YoY for all five variants, 2018→" , section: "Inflation" },
  { file: "compare.json", description: "Monthly ours-vs-official histories and validation stats" , section: "Inflation" },
  { file: "gaptable.json", description: "Component-level gap decomposition vs BLS" , section: "Inflation" },
  { file: "replay.json", description: "Per-component daily index/YoY, ours and BLS, for replay" , section: "Inflation" },
  { file: "quilt_months_24.json", description: "Month × component YoY grid, last 24 months" , section: "Inflation" },
  { file: "quilt_months_48.json", description: "Month × component YoY grid, last 48 months" , section: "Inflation" },
  { file: "quilt_months_all.json", description: "Month × component YoY grid, full history" , section: "Inflation" },
  { file: "official.json", description: "Latest official CPI headline, core and component prints" , section: "Inflation" },
  { file: "grocery_basket.json", description: "BLS average-price grocery staples, monthly" , section: "Inflation" },
  { file: "real_wages.json", description: "Wage growth vs the gauge and official CPI" , section: "Inflation" },
  { file: "nowcast_latest.json", description: "CPI / PCE / NFP nowcasts with component receipts" , section: "Forecasts" },
  { file: "nextprint.json", description: "Next CPI release date and ensemble call" , section: "Forecasts" },
  { file: "fuel.json", description: "Pump price two-week-forward from RBOB futures" , section: "Forecasts" },
  { file: "outlook.json", description: "12-month component-by-component CPI outlook" , section: "Forecasts" },
  { file: "releases.json", description: "First prints as they landed (vintage log)" , section: "Forecasts" },
  { file: "backtest.json", description: "Vintage-true walk-forward CPI backtest" , section: "Forecasts" },
  { file: "accountability_cpi.json", description: "Graded CPI calls" , section: "Forecasts" },
  { file: "accountability_pce.json", description: "Graded PCE calls" , section: "Forecasts" },
  { file: "accountability_nfp.json", description: "Graded NFP calls" , section: "Forecasts" },
  { file: "matrix.json", description: "Underlying, pipeline and expectations measures" , section: "Forecasts" },
  { file: "heatcheck.json", description: "Economy heat composite" , section: "Economy" },
  { file: "stress.json", description: "Consumer stress composite" , section: "Economy" },
  { file: "recession.json", description: "Six-rule recession signal" , section: "Economy" },
  { file: "labor.json", description: "Payrolls, unemployment, claims, wages" , section: "Economy" },
  { file: "geo.json", description: "51-state gas, electricity, wages, unemployment" , section: "AI Infra" },
  { file: "metros.json", description: "Zillow rent and home value, 50 largest metros" , section: "Economy" },
  { file: "commodities.json", description: "Daily commodity prices with sparklines" , section: "AI Infra" },
  { file: "datacenter.json", description: "DC Build / Ops / Hardware cost indexes" , section: "AI Infra" },
  { file: "dc_grades.json", description: "Vintage-true grading of DC escalation bases" , section: "AI Infra" },
  { file: "dc_markets.json", description: "County-level construction labor for 20 DC markets" , section: "AI Infra" },
  { file: "capacity.json", description: "AI capacity tracker: MW by company and status" , section: "AI Infra" },
  { file: "longlead.json", description: "Long-lead equipment prices and vendor order books" , section: "AI Infra" },
  { file: "news.json", description: "AI-infra news tape: posts naming AI/data-center companies (daily snapshot of the live feed)" , section: "AI Infra" },
  { file: "sources_status.json", description: "Per-source freshness and errors" , section: "System" },
  { file: "qa.json", description: "Data-integrity self-test results" , section: "System" },
  { file: "methodology.json", description: "Basket, series inventory, validation" , section: "System" },
  { file: "rates.json", description: "Treasury curve, breakevens, credit, dollar, liquidity, mortgage spread" , section: "AI Infra" },
  { file: "compute.json", description: "Cost of a token and a GPU-hour: model and SKU prices with two composite indexes" , section: "AI Infra" },
  { file: "housing.json", description: "Home prices, rents, sales and payment-to-income affordability" , section: "Economy" },
  { file: "changes.json", description: "What moved since the previous publish: headline, components, sources" , section: "Inflation" },
  { file: "revisions.json", description: "First print vs latest value for CPI, PCE and payrolls" , section: "Forecasts" },
  { file: "ledger.json", description: "Every publish's headline readings, append-only, never restated" , section: "AI Infra" },
];

export function dataUrl(file: string): string {
  return `/data/${file}`;
}

const AS_OF_KEYS = new Set(["as_of", "asof", "last_obs", "latest_obs"]);
const ISO_DAY = /^\d{4}-\d{2}-\d{2}/;

/** The newest observation date anywhere in an artifact: the max over every
 *  as_of / asof / last_obs / latest_obs date field, at any depth. A curated
 *  review date (as_of_curated) is not data and is not counted. Null when the
 *  file states none. */
export function newestAsOf(json: unknown): string | null {
  let best: string | null = null;
  const walk = (v: unknown): void => {
    if (Array.isArray(v)) { for (const x of v) walk(x); return; }
    if (!v || typeof v !== "object") return;
    for (const [k, x] of Object.entries(v)) {
      if (AS_OF_KEYS.has(k) && typeof x === "string" && ISO_DAY.test(x)) {
        const day = x.slice(0, 10);
        if (best === null || day > best) best = day;
      } else if (x && typeof x === "object") walk(x);
    }
  };
  walk(json);
  return best;
}
