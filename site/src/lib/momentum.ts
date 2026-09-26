/** Annualized momentum off the published daily index grid.
 *
 *  gauge_daily / replay publish a forward-filled daily grid (one entry per
 *  calendar day). The lookback is n CALENDAR months, not a fixed day count:
 *  the base for grid date d is the grid value dated the same day-of-month n
 *  months earlier (clamped to month end). A fixed 182-day offset was wrong for
 *  a monthly component — from a 2026-08-01 print it landed on 2026-01-31,
 *  still January's print, so "6m" was a 7-month change annualized as 6.
 *  ann(n) = (I_d / I_{d − n months})^(12/n) − 1, in %.
 *  Annualizing a short window amplifies noise (3m ≈ ×4, 6m ≈ ×2), and the
 *  indexes are not seasonally adjusted, so short windows carry seasonality. */
export type RateMode = "yoy" | "ann3" | "ann6";

export const RATE_MODES = [
  { key: "yoy", label: "YoY" },
  { key: "ann3", label: "3m ann." },
  { key: "ann6", label: "6m ann." },
] as const;

export const RATE_LOOKBACK_MONTHS: Record<Exclude<RateMode, "yoy">, number> = { ann3: 3, ann6: 6 };

/** The one-line caveat every 3m/6m surface carries. */
export const NSA_NOTE = "Indexes are not seasonally adjusted — short-window annualized rates carry seasonality.";

/** ISO date n calendar months before `iso`, same day-of-month clamped to the
 *  target month's end (2026-05-31 − 3m → 2026-02-28). */
export function monthsBefore(iso: string, n: number): string {
  const t = Number(iso.slice(0, 4)) * 12 + Number(iso.slice(5, 7)) - 1 - n;
  const y = Math.floor(t / 12);
  const m = t - y * 12;
  const monthEnd = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  const d = Math.min(Number(iso.slice(8, 10)), monthEnd);
  return `${String(y).padStart(4, "0")}-${String(m + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

/** Position of the last grid date ≤ `iso` (an as-of read of the
 *  forward-filled grid — exact on a contiguous daily grid); −1 when `iso`
 *  precedes the grid. `dates` is ascending ISO. */
function asOfPosition(dates: string[], iso: string): number {
  let lo = 0;
  let hi = dates.length - 1;
  let out = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (dates[mid] <= iso) {
      out = mid;
      lo = mid + 1;
    } else hi = mid - 1;
  }
  return out;
}

/** n-calendar-month annualized change at grid position i (e.g. a
 *  component's own last observation). Null when the base date precedes the
 *  grid or either end is missing / non-positive. */
export function annualizedAt(index: (number | null)[], dates: string[], months: number, i: number): number | null {
  const v = index[i];
  if (v == null || i < 0 || i >= dates.length) return null;
  const j = asOfPosition(dates, monthsBefore(dates[i], months));
  const base = j < 0 ? null : index[j];
  if (base == null || base <= 0) return null;
  return (Math.pow(v / base, 12 / months) - 1) * 100;
}

/** The annualized rate at every grid date: the base for dates[i] is the grid
 *  value n calendar months before dates[i]. */
export function annualizedChange(index: (number | null)[], dates: string[], months: number): (number | null)[] {
  return index.map((_, i) => annualizedAt(index, dates, months, i));
}

/** The series to plot for a mode: the PUBLISHED YoY (so the chart matches
 *  every KPI to the decimal) or an annualized rate computed from the index. */
export function rateSeries(
  mode: RateMode,
  yoy: (number | null)[],
  index: (number | null)[] | undefined,
  dates: string[],
): (number | null)[] {
  if (mode === "yoy" || !index) return yoy;
  return annualizedChange(index, dates, RATE_LOOKBACK_MONTHS[mode]);
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

/** Position of the last change in a forward-filled daily index (the
 *  component's own latest observation); 0 when it never changes. Momentum
 *  on a lagging component must be read here, never at the grid end. */
export function lastChange(index: (number | null)[]): number {
  for (let i = index.length - 1; i > 0; i--) {
    if (index[i] != null && index[i - 1] != null && index[i] !== index[i - 1]) return i;
  }
  return 0;
}
