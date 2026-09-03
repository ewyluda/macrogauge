/** Every published artifact under /public/data, with a one-line description
 *  for the footer "Data" row and the JSON download buttons. A vitest pins
 *  this list to the directory listing so a new artifact cannot ship
 *  unlisted (and a removed one cannot leave a dead link). */
export type DataFile = { file: string; description: string };

export const DATA_FILES: DataFile[] = [
  { file: "pulse.json", description: "Headline readings: gauge, tracker, official, gap, next print" },
  { file: "gauge_daily.json", description: "Daily index + YoY for all five variants, 2018→" },
  { file: "compare.json", description: "Monthly ours-vs-official histories and validation stats" },
  { file: "gaptable.json", description: "Component-level gap decomposition vs BLS" },
  { file: "replay.json", description: "Per-component daily index/YoY, ours and BLS, for replay" },
  { file: "quilt_months_24.json", description: "Month × component YoY grid, last 24 months" },
  { file: "quilt_months_48.json", description: "Month × component YoY grid, last 48 months" },
  { file: "quilt_months_all.json", description: "Month × component YoY grid, full history" },
  { file: "official.json", description: "Latest official CPI headline, core and component prints" },
  { file: "grocery_basket.json", description: "BLS average-price grocery staples, monthly" },
  { file: "real_wages.json", description: "Wage growth vs the gauge and official CPI" },
  { file: "nowcast_latest.json", description: "CPI / PCE / NFP nowcasts with component receipts" },
  { file: "nextprint.json", description: "Next CPI release date and ensemble call" },
  { file: "fuel.json", description: "Pump price two-week-forward from RBOB futures" },
  { file: "outlook.json", description: "12-month component-by-component CPI outlook" },
  { file: "releases.json", description: "First prints as they landed (vintage log)" },
  { file: "backtest.json", description: "Vintage-true walk-forward CPI backtest" },
  { file: "accountability_cpi.json", description: "Graded CPI calls" },
  { file: "accountability_pce.json", description: "Graded PCE calls" },
  { file: "accountability_nfp.json", description: "Graded NFP calls" },
  { file: "matrix.json", description: "Underlying, pipeline and expectations measures" },
  { file: "heatcheck.json", description: "Economy heat composite" },
  { file: "stress.json", description: "Consumer stress composite" },
  { file: "recession.json", description: "Six-rule recession signal" },
  { file: "labor.json", description: "Payrolls, unemployment, claims, wages" },
  { file: "geo.json", description: "51-state gas, electricity, wages, unemployment" },
  { file: "metros.json", description: "Zillow rent and home value, 50 largest metros" },
  { file: "commodities.json", description: "Daily commodity prices with sparklines" },
  { file: "datacenter.json", description: "DC Build / Ops / Hardware cost indexes" },
  { file: "dc_grades.json", description: "Vintage-true grading of DC escalation bases" },
  { file: "dc_markets.json", description: "County-level construction labor for 20 DC markets" },
  { file: "capacity.json", description: "AI capacity tracker: MW by company and status" },
  { file: "longlead.json", description: "Long-lead equipment prices and vendor order books" },
  { file: "sources_status.json", description: "Per-source freshness and errors" },
  { file: "qa.json", description: "Data-integrity self-test results" },
  { file: "methodology.json", description: "Basket, series inventory, validation" },
  { file: "rates.json", description: "Treasury curve, breakevens, credit, dollar, liquidity, mortgage spread" },
  { file: "compute.json", description: "Cost of a token and a GPU-hour: model and SKU prices with two composite indexes" },
  { file: "housing.json", description: "Home prices, rents, sales and payment-to-income affordability" },
  { file: "changes.json", description: "What moved since the previous publish: headline, components, sources" },
];

export function dataUrl(file: string): string {
  return `/data/${file}`;
}
