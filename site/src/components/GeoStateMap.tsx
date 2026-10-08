"use client";
import { SegmentedControl } from "./SegmentedControl";
import { LEVEL_STOPS, levelRamp, levelInk, EMPTY_CELL, textOn } from "@/lib/heat";
import { TILE_POS } from "@/lib/stateTiles";
import { METRICS, valueOf, type MetricKey } from "@/lib/siteCosts";
import type { GeoStateRow, GeoPanel } from "@/lib/types";

/** Full form for tooltip/legend/national line. */
export function fmtFull(v: number | null, m: MetricKey): string {
  if (v == null) return "—";
  switch (m) {
    case "gas": return `$${v.toFixed(3)}/gal`;
    case "elec_res":
    case "elec_ind": return `${v.toFixed(2)}¢/kWh`;
    case "wage": return `$${Math.round(v).toLocaleString("en-US")}/wk`;
    case "unemployment": return `${v.toFixed(1)}%`;
  }
}

/** Compact form that fits a 30px tile. */
function fmtTile(v: number | null, m: MetricKey): string {
  if (v == null) return "—";
  switch (m) {
    case "gas": return v.toFixed(2);
    case "elec_res":
    case "elec_ind": return v.toFixed(1);
    case "wage": return `${(v / 1000).toFixed(1)}k`;
    case "unemployment": return v.toFixed(1);
  }
}

const GRADIENT = `linear-gradient(90deg, ${LEVEL_STOPS.map(
  ([t, [r, g, b]]) => `rgb(${r},${g},${b}) ${t * 100}%`
).join(", ")})`;

/** Controlled: the page's StatesExplorer owns the metric (in the URL) so the
 *  map and the ranked table always show the same one. */
export function GeoStateMap({
  states,
  national,
  metric,
  onMetric,
}: {
  states: GeoStateRow[];
  national: GeoPanel;
  metric: MetricKey;
  onMetric: (m: MetricKey) => void;
}) {
  const vals = states
    .map((s) => valueOf(s, metric))
    .filter((v): v is number => v != null);
  const hasVals = vals.length > 0;
  const min = hasVals ? Math.min(...vals) : 0;
  const max = hasVals ? Math.max(...vals) : 0;
  const span = max - min || 1;
  const suppressed = states
    .filter((s) => valueOf(s, metric) == null)
    .map((s) => s.state);

  return (
    <div className="table-card" style={{ padding: 12 }}>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          flexWrap: "wrap",
          gap: 8,
          marginBottom: 10,
        }}
      >
        <SegmentedControl options={METRICS} value={metric} onChange={onMetric} />
        {hasVals ? (
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 6,
              fontSize: 11,
              color: "var(--muted)",
            }}
          >
            <span>{fmtFull(min, metric)}</span>
            <span
              style={{
                display: "inline-block",
                width: 120,
                height: 8,
                borderRadius: 4,
                background: GRADIENT,
              }}
            />
            <span>{fmtFull(max, metric)}</span>
          </div>
        ) : (
          <span style={{ fontSize: 11, color: "var(--muted)" }}>
            no published values for this metric this run
          </span>
        )}
      </div>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(11, minmax(30px, 1fr))",
          gap: 3,
          maxWidth: 720,
        }}
      >
        {states.map((s) => {
          const pos = TILE_POS[s.state];
          if (!pos) return null;
          const v = valueOf(s, metric);
          const bg = v == null ? EMPTY_CELL : levelRamp((v - min) / span);
          // tile ink by WCAG luminance — near-white on the amber stretch was ~3:1
          // level tiles: black/white ink, which clears 4.5:1 across the ramp
          // (textOn's #17212B does not between ~t=0.55 and 0.65)
          const ink = v == null ? textOn(bg) : levelInk(bg);
          return (
            <div
              key={s.state}
              title={`${s.name}: ${fmtFull(v, metric)}`}
              style={{
                gridRow: pos[0] + 1,
                gridColumn: pos[1] + 1,
                background: bg,
                opacity: v == null ? 0.45 : 1,
                borderRadius: 3,
                padding: "5px 2px",
                textAlign: "center",
              }}
            >
              <div style={{ fontSize: 11, fontWeight: 600, color: ink }}>
                {s.state}
              </div>
              <div style={{ fontSize: 10, color: ink }}>
                {fmtTile(v, metric)}
              </div>
            </div>
          );
        })}
      </div>
      <p className="method" style={{ marginBottom: 0 }}>
        US average: {fmtFull(valueOf(national, metric), metric)}. Colored by {metric === "wage"
          ? "the latest shared national QCEW quarter"
          : "each state’s own latest reading"} (min–max across states); higher = darker.
        {suppressed.length > 0 &&
          ` Greyed (${suppressed.join(", ")}): no published value${
            metric === "wage"
              ? " in the shared QCEW quarter — BLS suppresses these small-cell construction wages."
              : "."
          }`}
      </p>
    </div>
  );
}
