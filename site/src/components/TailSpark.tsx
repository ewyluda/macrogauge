import { yoyColor } from "@/lib/format";

/** Static SVG sparkline of a numeric trail (nulls skipped). Server-safe.
 * Stroke defaults to yoyColor of the last point; pass `stroke` to color by
 * something else (e.g. the 30-day change on a price-level trail). */
export function TailSpark({
  tail,
  stroke,
}: {
  tail: (number | null)[];
  stroke?: string;
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
  return (
    <svg width={w} height={h} style={{ display: "block" }}>
      <polyline
        points={line}
        fill="none"
        stroke={stroke ?? yoyColor(last)}
        strokeWidth={1.5}
      />
    </svg>
  );
}
