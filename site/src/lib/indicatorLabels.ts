// Human labels for the composite indicator codes published in heatcheck.json and
// stress.json. Names follow config/series.json where the code exists there; the rest
// are standard FRED series. Content only — no math. Unmapped codes fall back to the
// raw code via indicatorLabel().

export const INDICATOR_LABELS: Record<string, string> = {
  // heatcheck — prices (SA inputs from 2026-09-28; NSA codes kept for older artifacts)
  CPIAUCSL: "CPI, all items (SA)",
  CPILFESL: "Core CPI (SA)",
  CPIAUCNS: "CPI, all items",
  CPILFENS: "Core CPI",
  PCEPI: "PCE price index",
  PPIACO: "PPI, all commodities",
  T5YIE: "5yr breakeven inflation",
  // heatcheck — real economy
  PAYEMS: "Nonfarm payrolls",
  UNRATE: "Unemployment rate",
  INDPRO: "Industrial production",
  RSAFS: "Retail sales",
  DSPIC96: "Real disposable income",
  // heatcheck — pipeline
  ICSA: "Initial claims",
  CCSA: "Continued claims",
  PCUOMFGOMFG: "PPI, manufacturing",
  FEDFUNDS: "Fed funds rate",
  // heatcheck — housing
  HOUST: "Housing starts",
  PERMIT: "Building permits",
  CSUSHPISA: "Case-Shiller home prices (SA)",
  CSUSHPINSA: "Case-Shiller home prices",
  pmms_30yr: "30yr mortgage rate",
  // heatcheck — money & expectations
  M2SL: "M2 money stock",
  UMCSENT: "Consumer sentiment",
  T10Y2Y: "10yr–2yr Treasury spread",
  // stress
  DRCCLACBS: "Credit card delinquency",
  TERMCBCCALLNS: "Credit card interest rate",
  PSAVERT: "Personal saving rate",
  TDSP: "Debt service ratio",
  REVOLSL: "Revolving credit growth (YoY %)",
  DRSFRMACBS: "Mortgage delinquency",
};

export function indicatorLabel(code: string): string {
  return INDICATOR_LABELS[code] ?? code;
}

/** How a composite input's published `value` reads. Percent-valued inputs
 *  (rates, ratios, YoY growth) carry two decimals; counts are compacted.
 *  Unlisted codes fall back to a two-decimal number, never a raw float. */
const INDICATOR_UNITS: Record<string, "pct" | "count"> = {
  DRCCLACBS: "pct", TERMCBCCALLNS: "pct", PSAVERT: "pct", TDSP: "pct",
  REVOLSL: "pct", DRSFRMACBS: "pct", CCSA: "count", ICSA: "count",
};

/** 11.111439 -> "11.11%"; 1716000 -> "1.72M"; 1234.5678 -> "1,234.57" */
export function fmtIndicatorValue(code: string, value: number): string {
  const unit = INDICATOR_UNITS[code];
  if (unit === "pct") return `${value.toFixed(2)}%`;
  if (unit === "count") {
    return value >= 1e6 ? `${(value / 1e6).toFixed(2)}M`
      : value >= 1e3 ? `${(value / 1e3).toFixed(0)}K` : `${Math.round(value)}`;
  }
  return value.toLocaleString("en-US", { maximumFractionDigits: 2 });
}
