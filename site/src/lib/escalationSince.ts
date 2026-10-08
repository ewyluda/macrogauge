/** Since-date escalation math for /calculator: what each chosen cost index
 *  has done since a bid or notice-to-proceed month, every series rebased to
 *  100 on that month. Monthly levels only; each series is measured to its OWN
 *  last month (a PPI lags the DC index by a month), never forward-filled.
 *  Pure; unit-tested. */

export type MonthlySeries = {
  key: string;
  label: string;
  group: string;
  /** what the level is ("BLS PPI WPU1175", "Jan 2018 = 100") */
  source: string;
  months: string[]; // YYYY-MM, ascending
  values: number[];
};

export type SinceRow = {
  key: string;
  label: string;
  baseMonth: string;
  lastMonth: string;
  months: number;
  changePct: number;
  annualizedPct: number | null;
  /** `amount` at the base month, escalated by this series */
  escalated: number;
};

export function monthDiff(from: string, to: string): number {
  const [fy, fm] = from.split("-").map(Number);
  const [ty, tm] = to.split("-").map(Number);
  return (ty - fy) * 12 + (tm - fm);
}

/** null when the series has no level in the base month (it starts later, or
 *  the month is past its last print); a base at the last print is no elapsed
 *  time: zero change, the amount unchanged, no annualized rate */
export function sinceRow(s: MonthlySeries, baseMonth: string, amount: number): SinceRow | null {
  const i = s.months.indexOf(baseMonth);
  const last = s.months.length - 1;
  if (i < 0 || !s.values[i]) return null;
  const ratio = s.values[last] / s.values[i];
  const months = monthDiff(baseMonth, s.months[last]);
  return {
    key: s.key,
    label: s.label,
    baseMonth,
    lastMonth: s.months[last],
    months,
    changePct: (ratio - 1) * 100,
    // under a year, an annualized rate compounds one print's noise
    annualizedPct: months >= 12 ? (Math.pow(ratio, 12 / months) - 1) * 100 : null,
    escalated: amount * ratio,
  };
}

/** the series from the base month on, as 100 × level / base-month level */
export function rebased(s: MonthlySeries, baseMonth: string): { months: string[]; values: number[] } | null {
  const i = s.months.indexOf(baseMonth);
  if (i < 0 || !s.values[i]) return null;
  const base = s.values[i];
  return {
    months: s.months.slice(i),
    values: s.values.slice(i).map((v) => Math.round((10000 * v) / base) / 100),
  };
}

/** a daily index as calendar-month averages (the gauge); the current month
 *  averages the days published so far */
export function monthlyAverage(dates: string[], values: number[]): { months: string[]; values: number[] } {
  const sums = new Map<string, { s: number; n: number }>();
  dates.forEach((d, i) => {
    const m = d.slice(0, 7);
    const acc = sums.get(m) ?? { s: 0, n: 0 };
    acc.s += values[i];
    acc.n += 1;
    sums.set(m, acc);
  });
  const months = [...sums.keys()].sort();
  return { months, values: months.map((m) => Math.round((1000 * sums.get(m)!.s) / sums.get(m)!.n) / 1000) };
}
