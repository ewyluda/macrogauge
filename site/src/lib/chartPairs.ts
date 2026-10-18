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
 *  print shows only as a vertical tick at the right edge. This closes it: when
 *  the last two points are first-of-month dates a whole number of months apart
 *  (a monthly or quarterly print), the last value runs one more period, to the
 *  day before the next print would land: Sep 2026's CPI through Sep 30. Daily or
 *  irregular series (the Fed target, a daily tail) come back unchanged. */
export function closeStep<T extends number | null>(pts: [string, T][]): [string, T][] {
  if (pts.length < 2) return pts;
  const [lastX, lastY] = pts[pts.length - 1];
  if (lastY === null) return pts;
  const ym = (x: string) => (/^\d{4}-\d{2}(-01)?$/.test(x) ? Number(x.slice(0, 4)) * 12 + Number(x.slice(5, 7)) - 1 : null);
  const a = ym(pts[pts.length - 2][0]);
  const b = ym(lastX);
  if (a === null || b === null || b <= a) return pts;
  const next = b + (b - a);
  const end = new Date(Date.UTC(Math.floor(next / 12), next % 12, 1) - 86_400_000).toISOString().slice(0, 10);
  return [...pts, [end, lastY]];
}
