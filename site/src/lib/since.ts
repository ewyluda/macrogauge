export type SinceStats = {
  startDate: string;
  days: number;
  pctSince: number;
  thenNow: number;
  buys: number;
  annualizedPct: number;
};

/** Since-date math over the daily gauge index. Uses the nearest observation
 *  at or before `since`; null if `since` predates the series. */
export function sinceStats(
  dates: string[],
  index: number[],
  since: string,
  amount: number
): SinceStats | null {
  let i = -1;
  for (let j = 0; j < dates.length; j++) {
    if (dates[j] <= since) i = j;
    else break;
  }
  if (i < 0) return null;
  const last = index.length - 1;
  const ratio = index[last] / index[i];
  const days = Math.round(
    (Date.parse(dates[last]) - Date.parse(dates[i])) / 86400000
  );
  return {
    startDate: dates[i],
    days,
    pctSince: (ratio - 1) * 100,
    thenNow: amount * ratio,
    buys: amount / ratio,
    annualizedPct: days > 0 ? (Math.pow(ratio, 365 / days) - 1) * 100 : 0,
  };
}
