/** /cost-of-living's annotation: the latest sharp rise in the cost-of-living
 *  YoY (≥ `minRisePp` over `days`), set against the gauge over the same span
 *  and the mortgage rate now vs a year earlier — the buyer's payment rides
 *  the rate, rental-equivalence shelter does not. Pure; tested. */
export type ColJump = { from: string; to: string; colFrom: number; colTo: number; gaugeFrom: number; gaugeTo: number; text: string };

export function colJump(
  dates: string[], col: (number | null)[], gauge: (number | null)[],
  rate: { now: number; nowAsOf: string; yearAgo: number | null },
  days = 60, minRisePp = 1.5,
): ColJump | null {
  let end = col.length - 1;
  while (end >= 0 && (col[end] == null || gauge[end] == null)) end--;
  if (end < 0) return null;
  const startDate = new Date(Date.parse(`${dates[end]}T00:00:00Z`) - days * 86400000).toISOString().slice(0, 10);
  let start = dates.findIndex((d) => d >= startDate);
  while (start >= 0 && start < end && (col[start] == null || gauge[start] == null)) start++;
  if (start < 0 || start >= end) return null;
  const c0 = col[start] as number, c1 = col[end] as number, g0 = gauge[start] as number, g1 = gauge[end] as number;
  if (c1 - c0 < minRisePp) return null;
  const pct = (v: number) => `${v.toFixed(1)}%`;
  const ago = rate.yearAgo == null ? "" : `, against ${pct(rate.yearAgo)} a year earlier`;
  const text = `Since ${dates[start]}, cost of living has jumped from ${pct(c0)} to ${pct(c1)} while the gauge went from ${pct(g0)} to ${pct(g1)}. `
    + `The 30-year mortgage rate is ${pct(rate.now)} (${rate.nowAsOf})${ago}, and the buyer's payment rides the rate; rental-equivalence shelter does not.`;
  return { from: dates[start], to: dates[end], colFrom: c0, colTo: c1, gaugeFrom: g0, gaugeTo: g1, text };
}
