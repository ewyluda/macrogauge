export type EscalationResult = {
  baseMonth: string;
  endMonth: string;
  monthsElapsed: number;
  baseIndex: number;
  endIndex: number;
  pct: number;
  annualizedPct: number;
  escalatedCost: number;
  deltaCost: number;
};

/** Whole months between two "YYYY-MM" strings. */
function monthDiff(a: string, b: string): number {
  const [ay, am] = a.split("-").map(Number);
  const [by, bm] = b.split("-").map(Number);
  return (by - ay) * 12 + (bm - am);
}

/** Index of the nearest month at or before `target`; -1 if target predates the series. */
export function monthIndexAtOrBefore(months: string[], target: string): number {
  let i = -1;
  for (let j = 0; j < months.length; j++) {
    if (months[j] <= target) i = j;
    else break;
  }
  return i;
}

/** Escalate a base cost by the index ratio. Unit-agnostic — the caller's $/MW,
 *  total project $, or any other denomination all ride the same ratio. */
export function escalate(
  months: string[],
  index: number[],
  baseMonth: string,
  baseCost: number
): EscalationResult | null {
  const i = monthIndexAtOrBefore(months, baseMonth);
  if (i < 0) return null;
  const last = index.length - 1;
  const ratio = index[last] / index[i];
  const monthsElapsed = monthDiff(months[i], months[last]);
  return {
    baseMonth: months[i],
    endMonth: months[last],
    monthsElapsed,
    baseIndex: index[i],
    endIndex: index[last],
    pct: (ratio - 1) * 100,
    annualizedPct: monthsElapsed > 0 ? (Math.pow(ratio, 12 / monthsElapsed) - 1) * 100 : 0,
    escalatedCost: baseCost * ratio,
    deltaCost: baseCost * (ratio - 1),
  };
}
