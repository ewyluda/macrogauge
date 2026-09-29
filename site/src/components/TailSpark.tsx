import { yoyColor } from "@/lib/format";

/** Static SVG sparkline of a numeric trail (nulls skipped). Server-safe.
 * Stroke defaults to yoyColor of the last point; pass `stroke` to color by
 * something else (e.g. the 30-day change on a price-level trail). */
export function TailSpark({
  tail,
  stroke,
  label,
}: {
  tail: (number | null)[];
  stroke?: string;
  /** what the trail is ("WTI crude"); leads the text alternative (B15) */
  label?: string;
}) {
  const pts = tail
    .map((v, i) => [i, v] as const)
    .filter((p): p is readonly [number, number] => p[1] != null);
  if (pts.length < 2) return <span style={{ color: "var(--muted)" }}>—</span>;
  const w = 96;
  const h = 22;
  const ys = pts.map((p) => p[1]);
  const min = Math.min(...ys);
  const span = Math.max(...ys) - min || 1;
  const n = tail.length - 1 || 1;
  const line = pts
    .map(
      ([i, v]) =>
        `${((i / n) * w).toFixed(1)},${(h - 2 - ((v - min) / span) * (h - 4)).toFixed(1)}`
    )
    .join(" ");
  const last = ys[ys.length - 1];
  const fmt = (v: number) => (Math.abs(v) >= 1000 ? v.toLocaleString("en-US", { maximumFractionDigits: 0 }) : v.toFixed(2));
  // B15: an unlabeled SVG trail is invisible to assistive tech
  const alt = `${label ? `${label} trend` : "Trend"}: ${pts.length} points, from ${fmt(ys[0])} to latest ${fmt(last)}`;
  return (
    <svg width={w} height={h} style={{ display: "block" }} role="img" aria-label={alt}>
      <polyline
        points={line}
        fill="none"
        stroke={stroke ?? yoyColor(last)}
        strokeWidth={1.5}
      />
    </svg>
  );
}
