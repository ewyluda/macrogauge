/** Trailing-window helpers for the home hero chart.
 *
 *  ECharts derives the y-axis extent from every point in a series, even the
 *  ones clipped by `xAxis.min`, so a 24-month window has to be cut from the
 *  data itself or the 2022 spike still sets the scale. Slicing server-side
 *  also keeps the clipped points out of the RSC payload. */

/** ISO date `months` before the latest date across all the given date arrays;
 *  undefined when nothing is dated. */
export function windowStart(
  dateArrays: string[][],
  months: number,
): string | undefined {
  let latest: string | undefined;
  for (const xs of dateArrays) {
    for (const x of xs) if (!latest || x > latest) latest = x;
  }
  if (!latest) return undefined;
  const start = new Date(`${latest.slice(0, 10)}T00:00:00Z`);
  start.setUTCMonth(start.getUTCMonth() - months);
  return start.toISOString().slice(0, 10);
}

/** Keep the dates at or after `start` and the matching entries of each
 *  aligned series. A missing `start` returns the inputs unchanged. */
export function sliceSince<T>(
  dates: string[],
  series: T[][],
  start: string | undefined,
): { dates: string[]; series: T[][] } {
  if (!start) return { dates, series };
  let from = 0;
  while (from < dates.length && dates[from] < start) from++;
  return {
    dates: dates.slice(from),
    series: series.map((ys) => ys.slice(from)),
  };
}
