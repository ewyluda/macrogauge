/** [x, y] points for an ECharts line without the leading/trailing nulls (a
 *  series that starts late or ends early). An interior null stays as a
 *  break, so the line does not bridge an undefined stretch — a 3/6-month
 *  rate touching a month BLS never printed (October 2025) — with a made-up
 *  straight segment. */
export function pairWithBreaks(xs: string[], ys: (number | null)[]): [string, number | null][] {
  const out = xs.map((x, i): [string, number | null] => [x, ys[i] ?? null]);
  const first = out.findIndex((p) => p[1] !== null);
  if (first < 0) return [];
  let last = out.length - 1;
  while (out[last][1] === null) last--;
  return out.slice(first, last + 1);
}

/** A step:"end" line draws each value flat until the NEXT point, so the newest
 *  print shows only as a vertical tick at the right edge. This closes it: the
 *  last value runs one more period, to the day before the next print would
 *  land (Sep 2026's CPI through Sep 30). The period is the series' own cadence,
 *  read as the smallest spacing across ALL its first-of-month points, so a
 *  skipped print just before the last one (BLS's missing October 2025) does
 *  not stretch it; only a monthly, quarterly or annual cadence is trusted.
 *  Daily or irregular series (the Fed target, a daily tail), and spacing that
 *  is not a standard cadence, come back unchanged. */
export function closeStep<T extends number | null>(pts: [string, T][]): [string, T][] {
  if (pts.length < 2) return pts;
  const [, lastY] = pts[pts.length - 1];
  if (lastY === null) return pts;
  const ym = (x: string) => (/^\d{4}-\d{2}(-01)?$/.test(x) ? Number(x.slice(0, 4)) * 12 + Number(x.slice(5, 7)) - 1 : null);
  const months = pts.map(([x]) => ym(x));
  let cadence = Infinity;
  for (let i = 1; i < months.length; i++) {
    const a = months[i - 1];
    const b = months[i];
    if (a === null || b === null || b <= a) return pts;
    cadence = Math.min(cadence, b - a);
  }
  if (cadence !== 1 && cadence !== 3 && cadence !== 12) return pts;
  const next = (months[months.length - 1] as number) + cadence;
  const end = new Date(Date.UTC(Math.floor(next / 12), next % 12, 1) - 86_400_000).toISOString().slice(0, 10);
  return [...pts, [end, lastY]];
}
