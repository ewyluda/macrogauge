// site/src/components/StateTileMap.tsx
"use client";
import { useState } from "react";
import { SegmentedControl } from "./SegmentedControl";
import { EMPTY_CELL, textOn } from "@/lib/heat";
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
  { key: "ops_mult", label: "Operating cost" },
  { key: "build_mult", label: "Build cost" },
  { key: "power_rel", label: "Industrial power price" },
  { key: "wage_rel", label: "Construction wage" },
] as const;

// Every metric is a ratio to the national average, so the scale diverges
// around 1.0: neutral gray at parity, emerald for cheaper, red for pricier.
// Distance is measured in log-ratio so 0.5× and 2× sit equally far out.
const CHEAP: [number, number, number] = [14, 138, 109];   // #0E8A6D
const MID: [number, number, number] = [228, 232, 237];    // #E4E8ED
const DEAR: [number, number, number] = [187, 69, 69];     // #BB4545
const mix = (a: number[], b: number[], f: number) =>
  `rgb(${a.map((v, i) => Math.round(v + (b[i] - v) * f)).join(",")})`;
const diverge = (v: number, reach: number) => {
  const t = Math.max(-1, Math.min(1, Math.log(v) / reach));
  return t < 0 ? mix(MID, CHEAP, -t) : mix(MID, DEAR, t);
};
const GRADIENT = `linear-gradient(90deg, ${mix(MID, CHEAP, 1)}, rgb(${MID.join(",")}) 50%, ${mix(MID, DEAR, 1)})`;

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
  const reach = hasVals ? Math.max(Math.abs(Math.log(min)), Math.abs(Math.log(max)), 0.01) : 1;
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
            <span>Cheaper</span>
            <span
              style={{
                display: "inline-block",
                width: 140,
                height: 8,
                borderRadius: 4,
                background: GRADIENT,
              }}
            />
            <span>Pricier</span>
            <span style={{ marginLeft: 6 }}>gray = national average · range {min.toFixed(2)}×–{max.toFixed(2)}×</span>
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
          const bg = v == null ? EMPTY_CELL : diverge(v, reach);
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
