/** Math for /datacenter/components/[code]: one DC index component's monthly
 *  level, cut at its OWN last observation (the published monthly grid
 *  forward-fills an official PPI past its last print; a live-tail component
 *  runs to the current month), with YoY and annualized momentum off it.
 *  Pure; unit-tested. */

export type MonthlyLevel = { months: string[]; levels: number[] };

/** the series through the component's last observation month */
export function ownSeries(months: string[], levels: number[], lastObs: string | null): MonthlyLevel {
  const end = lastObs ? months.lastIndexOf(lastObs.slice(0, 7)) : -1;
  const n = end >= 0 ? end + 1 : months.length;
  return { months: months.slice(0, n), levels: levels.slice(0, n) };
}

/** 12-month % change at each month; null for the first year */
export function yoySeries(s: MonthlyLevel): (number | null)[] {
  return s.levels.map((v, i) => (i >= 12 && s.levels[i - 12] ? Math.round((v / s.levels[i - 12] - 1) * 10000) / 100 : null));
}

/** n-month change compounded to a year, at the last month */
export function annualized(s: MonthlyLevel, n: number): number | null {
  const last = s.levels.length - 1;
  if (last - n < 0 || !s.levels[last - n]) return null;
  return (Math.pow(s.levels[last] / s.levels[last - n], 12 / n) - 1) * 100;
}
