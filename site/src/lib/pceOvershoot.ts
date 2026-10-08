/** The longest stretch where the PCE gauge ran at least `minGapPp` above
 *  official PCEPI (2021–22 on the published history), for /pce's chart band
 *  and caption. Months with either side missing break a run. Pure; tested. */
export type Overshoot = { from: string; to: string; peakGapPp: number; peakMonth: string };

export function overshoot(months: string[], ours: (number | null)[], official: (number | null)[], minGapPp = 1): Overshoot | null {
  let best: Overshoot | null = null;
  let run: Overshoot | null = null;
  months.forEach((m, i) => {
    const a = ours[i];
    const b = official[i];
    const gap = a != null && b != null ? a - b : null;
    if (gap != null && gap >= minGapPp) {
      if (!run) run = { from: m, to: m, peakGapPp: gap, peakMonth: m };
      run.to = m;
      if (gap > run.peakGapPp) { run.peakGapPp = gap; run.peakMonth = m; }
      if (!best || monthsBetween(run) > monthsBetween(best)) best = { ...run };
    } else {
      run = null;
    }
  });
  return best;
}

function monthsBetween(o: Overshoot): number {
  const [fy, fm] = o.from.split("-").map(Number);
  const [ty, tm] = o.to.split("-").map(Number);
  return (ty - fy) * 12 + (tm - fm);
}
