// site/src/components/StateTileMap.tsx
"use client";
import { useState } from "react";
import { SegmentedControl } from "./SegmentedControl";
import { STOPS, ramp, EMPTY_CELL } from "@/lib/heat";
import { fmtMoney } from "@/lib/format";

export type StateParityTile = {
  state: string;
  power_rel: number | null;
  ops_mult: number | null;
  wage_rel: number | null;
  build_mult: number | null;
};

type MetricKey = "ops_mult" | "build_mult" | "power_rel" | "wage_rel";

// All four published state metrics are ratios vs the national average
// (multipliers/relatives) — per-state ¢/kWh and $/wk levels are not published.
const METRICS = [
  { key: "ops_mult", label: "OPS ×" },
  { key: "build_mult", label: "BUILD ×" },
  { key: "power_rel", label: "POWER REL" },
  { key: "wage_rel", label: "WAGE REL" },
] as const;

// Widely-used equal-area tile arrangement (NPR-style), 8 rows × 11 cols,
// 50 states + DC. [row, col], 0-indexed.
const TILE_POS: Record<string, [number, number]> = {
  AK: [0, 0], ME: [0, 10],
  VT: [1, 9], NH: [1, 10],
  WA: [2, 0], ID: [2, 1], MT: [2, 2], ND: [2, 3], MN: [2, 4], IL: [2, 5],
  WI: [2, 6], MI: [2, 7], NY: [2, 8], MA: [2, 9], RI: [2, 10],
  OR: [3, 0], NV: [3, 1], WY: [3, 2], SD: [3, 3], IA: [3, 4], IN: [3, 5],
  OH: [3, 6], PA: [3, 7], NJ: [3, 8], CT: [3, 9],
  CA: [4, 0], UT: [4, 1], CO: [4, 2], NE: [4, 3], MO: [4, 4], KY: [4, 5],
  WV: [4, 6], VA: [4, 7], MD: [4, 8], DE: [4, 9],
  AZ: [5, 1], NM: [5, 2], KS: [5, 3], AR: [5, 4], TN: [5, 5], NC: [5, 6],
  SC: [5, 7], DC: [5, 8],
  OK: [6, 3], LA: [6, 4], MS: [6, 5], AL: [6, 6], GA: [6, 7],
  HI: [7, 0], TX: [7, 3], FL: [7, 8],
};

const GRADIENT = `linear-gradient(90deg, ${STOPS.map(
  ([t, [r, g, b]]) => `rgb(${r},${g},${b}) ${t * 100}%`
).join(", ")})`;

export function StateTileMap({
  states,
  national,
}: {
  states: StateParityTile[];
  // dcindex.py legally publishes either denominator as null (parity.mode
  // "ops_only" / "unavailable") — never dereference these unguarded
  national: {
    power: { value: number; as_of: string } | null;
    wage: { value: number; as_of: string } | null;
  };
}) {
  const [metric, setMetric] = useState<MetricKey>("ops_mult");
  const vals = states
    .map((s) => s[metric])
    .filter((v): v is number => v != null);
  // parity.mode "unavailable" ships states: [] — render an honest empty state
  if (states.length === 0) {
    return (
      <div className="table-card" style={{ padding: 12 }}>
        <p className="method" style={{ margin: 0 }}>
          State parity is unavailable this run — no per-state inputs were
          published. The map returns when the next publish carries state data.
        </p>
      </div>
    );
  }
  const hasVals = vals.length > 0;
  const min = hasVals ? Math.min(...vals) : 0;
  const max = hasVals ? Math.max(...vals) : 0;
  const span = max - min || 1;
  const suppressed = states
    .filter((s) => s[metric] == null)
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
        <SegmentedControl options={METRICS} value={metric} onChange={setMetric} />
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
            <span>{min.toFixed(2)}×</span>
            <span
              style={{
                display: "inline-block",
                width: 120,
                height: 8,
                borderRadius: 4,
                background: GRADIENT,
              }}
            />
            <span>{max.toFixed(2)}×</span>
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
          const v = s[metric];
          return (
            <div
              key={s.state}
              title={`${s.state}: ${v == null ? "no published value" : `${v.toFixed(3)}× national`}`}
              style={{
                gridRow: pos[0] + 1,
                gridColumn: pos[1] + 1,
                background: v == null ? EMPTY_CELL : ramp((v - min) / span),
                opacity: v == null ? 0.45 : 1,
                borderRadius: 3,
                padding: "5px 2px",
                textAlign: "center",
              }}
            >
              <div style={{ fontSize: 11, fontWeight: 600, color: "#E6EDF3" }}>
                {s.state}
              </div>
              <div style={{ fontSize: 10, color: "rgba(230,237,243,0.85)" }}>
                {v == null ? "—" : v.toFixed(2)}
              </div>
            </div>
          );
        })}
      </div>
      <p className="method" style={{ marginBottom: 0 }}>
        multipliers vs national:
        {national.power
          ? ` power ${national.power.value.toFixed(2)}¢/kWh (as of ${national.power.as_of})`
          : " power denominator unavailable this run"}
        ,{" "}
        {national.wage
          ? `construction wage ${fmtMoney(national.wage.value, "$")}/wk (as of ${national.wage.as_of})`
          : "wage denominator unavailable this run"}
        .
        {suppressed.length > 0 &&
          ` Greyed tiles (${suppressed.join(", ")}): no published value — BLS suppresses small-cell QCEW wages for these states.`}
      </p>
    </div>
  );
}
