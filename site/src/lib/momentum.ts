/** Annualized momentum off the published daily index grid.
 *
 *  gauge_daily / replay publish a CONTIGUOUS forward-filled daily grid (one
 *  entry per calendar day), so a lookback of k days is a position offset of
 *  k — no weekend bridging needed, unlike publish/util.pct_change_daily for
 *  raw weekday series. ann(k) = (I_t / I_{t−k})^(365/k) − 1, in %.
 *  Annualizing a short window amplifies noise: 3m ≈ ×4, 6m ≈ ×2. */
export type RateMode = "yoy" | "ann3" | "ann6";

export const RATE_MODES = [
  { key: "yoy", label: "YoY" },
  { key: "ann3", label: "3m ann." },
  { key: "ann6", label: "6m ann." },
] as const;

export const RATE_LOOKBACK_DAYS: Record<Exclude<RateMode, "yoy">, number> = { ann3: 91, ann6: 182 };

export function annualizedChange(index: (number | null)[], lookbackDays: number): (number | null)[] {
  const k = lookbackDays;
  return index.map((v, i) => {
    if (i < k || v == null) return null;
    const base = index[i - k];
    if (base == null || base <= 0) return null;
    return (Math.pow(v / base, 365 / k) - 1) * 100;
  });
}

/** The series to plot for a mode: the PUBLISHED YoY (so the chart matches
 *  every KPI to the decimal) or an annualized rate computed from the index. */
export function rateSeries(
  mode: RateMode,
  yoy: (number | null)[],
  index: (number | null)[] | undefined,
): (number | null)[] {
  if (mode === "yoy" || !index) return yoy;
  return annualizedChange(index, RATE_LOOKBACK_DAYS[mode]);
}

export function rateLabel(mode: RateMode): string {
  return mode === "yoy" ? "YoY" : mode === "ann3" ? "3-month annualized" : "6-month annualized";
}

/** Latest non-null value of a series and its date. */
export function latestOf(dates: string[], ys: (number | null)[]): { date: string; value: number } | null {
  for (let i = ys.length - 1; i >= 0; i--) {
    const v = ys[i];
    if (v != null) return { date: dates[i], value: v };
  }
  return null;
}
