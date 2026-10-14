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
