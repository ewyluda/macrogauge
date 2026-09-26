// site/src/components/StateTileMap.tsx
"use client";
import { useState } from "react";
import { SegmentedControl } from "./SegmentedControl";
import { STOPS, ramp, EMPTY_CELL, textOn } from "@/lib/heat";
import { fmtMoney } from "@/lib/format";
import { TILE_POS } from "@/lib/stateTiles";

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
          const bg = v == null ? EMPTY_CELL : ramp((v - min) / span);
          // tile ink by WCAG luminance — near-white on the amber stretch was ~3:1
          const ink = textOn(bg);
          return (
            <div
              key={s.state}
              title={`${s.state}: ${v == null ? "no published value" : `${v.toFixed(3)}× national`}`}
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
