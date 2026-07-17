// Human labels for the composite indicator codes published in heatcheck.json and
// stress.json. Names follow config/series.json where the code exists there; the rest
// are standard FRED series. Content only — no math. Unmapped codes fall back to the
// raw code via indicatorLabel().

export const INDICATOR_LABELS: Record<string, string> = {
  // heatcheck — prices
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
