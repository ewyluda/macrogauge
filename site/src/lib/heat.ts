// blue → slate → amber → red, nowflation's -2%→6% ramp normalized to t∈[0,1].
// Single source of truth: Treemap tiles, QuiltHeatmap cells and the PNG
// exporter all color through here.
export const STOPS: [number, [number, number, number]][] = [
  [0.0, [37, 99, 235]],   // blue
  [0.25, [71, 85, 105]],  // slate ≈ 0
  [0.62, [217, 119, 6]],  // amber
  [1.0, [220, 38, 38]],   // red
];

export function ramp(t: number): string {
  const x = Math.max(0, Math.min(1, t));
  for (let i = 1; i < STOPS.length; i++) {
    if (x <= STOPS[i][0]) {
      const [t0, c0] = STOPS[i - 1];
      const [t1, c1] = STOPS[i];
      const f = (x - t0) / (t1 - t0);
      const c = c0.map((v, j) => Math.round(v + (c1[j] - v) * f));
      return `rgb(${c[0]},${c[1]},${c[2]})`;
    }
  }
  return `rgb(220,38,38)`;
}

export const EMPTY_CELL = "#2a3542";

export function heatColor(v: number | null, domain: [number, number] = [-2, 6]): string {
  return v === null ? EMPTY_CELL : ramp((v - domain[0]) / (domain[1] - domain[0]));
}
