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

/** Text colours a heat cell can carry: the site's ink and white. */
export const TEXT_DARK = "#17212B";
export const TEXT_LIGHT = "#FFFFFF";

/** "#rrggbb" | "#rgb" | "rgb(r,g,b)" → [r, g, b]; null if unparseable. */
function parseColor(c: string): [number, number, number] | null {
  const s = c.trim();
  const rgb = /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/i.exec(s);
  if (rgb) return [Number(rgb[1]), Number(rgb[2]), Number(rgb[3])];
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(s);
  if (!hex) return null;
  const h = hex[1].length === 3 ? hex[1].split("").map((x) => x + x).join("") : hex[1];
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}

/** WCAG 2.x relative luminance of an sRGB colour (0 for unparseable). */
export function luminance(c: string): number {
  const rgb = parseColor(c);
  if (!rgb) return 0;
  const [r, g, b] = rgb.map((v) => {
    const x = v / 255;
    return x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG contrast ratio between two colours (1…21). */
export function contrast(a: string, b: string): number {
  const la = luminance(a);
  const lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/** Text colour for a heat-cell background: whichever of dark ink / white
 *  gives the higher WCAG contrast. White on the amber stretch of the ramp
 *  (≈3% YoY) is only ~3.2:1; the site ink there is ~6:1. */
export function textOn(bg: string): string {
  return contrast(bg, TEXT_DARK) >= contrast(bg, TEXT_LIGHT) ? TEXT_DARK : TEXT_LIGHT;
}
