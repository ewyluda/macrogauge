import { DeltaChip } from "./DeltaChip";

/** Grocery/price card: name, big price, blue sparkline, YoY chip, as-of.
 *  Pure SVG — no hooks, renders statically at build time. */
export function SparklineCard({
  label,
  price,
  yoyPct,
  asOf,
  prices,
}: {
  label: string;
  price: string;
  yoyPct: number;
  asOf: string;
  prices: number[];
}) {
  const w = 170;
  const h = 36;
  const min = Math.min(...prices);
  const span = Math.max(...prices) - min || 1;
  const pts = prices
    .map(
      (p, i) =>
        `${((i / Math.max(prices.length - 1, 1)) * w).toFixed(1)},` +
        `${(h - 3 - ((p - min) / span) * (h - 6)).toFixed(1)}`
    )
    .join(" ");
  return (
    <div
      style={{
        background: "var(--card)",
        border: "1px solid var(--border)",
        borderRadius: 10,
        padding: 12,
        minWidth: 190,
        flex: "1 1 190px",
      }}
    >
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "baseline",
          gap: 8,
        }}
      >
        <span style={{ fontSize: 13, fontWeight: 600 }}>{label}</span>
        <DeltaChip value={yoyPct} />
      </div>
      <div
        style={{
          fontSize: 24,
          fontWeight: 700,
          fontVariantNumeric: "tabular-nums",
          margin: "2px 0 4px",
        }}
      >
        {price}
      </div>
      <svg width={w} height={h} style={{ display: "block", maxWidth: "100%" }}>
        <polyline
          points={pts}
          fill="none"
          stroke="var(--accent-sky)"
          strokeWidth={1.5}
        />
      </svg>
      <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 4 }}>{asOf}</div>
    </div>
  );
}
