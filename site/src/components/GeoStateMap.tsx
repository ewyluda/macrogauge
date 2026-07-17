"use client";
import { useState } from "react";
import { SegmentedControl } from "./SegmentedControl";
import { STOPS, ramp, EMPTY_CELL } from "@/lib/heat";
import { TILE_POS } from "@/lib/stateTiles";
import type { GeoStateRow, GeoPanel } from "@/lib/types";

type MetricKey = "gas" | "elec_res" | "elec_ind" | "wage" | "unemployment";

const METRICS = [
  { key: "gas", label: "GAS $/gal" },
  { key: "elec_res", label: "ELEC RES ¢" },
  { key: "elec_ind", label: "ELEC IND ¢" },
  { key: "wage", label: "WAGE $/wk" },
  { key: "unemployment", label: "UNEMP %" },
] as const;

function valueOf(panel: GeoPanel, m: MetricKey): number | null {
  switch (m) {
    case "gas": return panel.gas_regular.value;
    case "elec_res": return panel.elec_res_cents.value;
    case "elec_ind": return panel.elec_ind_cents.value;
    case "wage": return panel.wage_weekly.value;
    case "unemployment": return panel.unemployment_pct.value;
  }
}

/** Full form for tooltip/legend/national line. */
function fmtFull(v: number | null, m: MetricKey): string {
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

const GRADIENT = `linear-gradient(90deg, ${STOPS.map(
  ([t, [r, g, b]]) => `rgb(${r},${g},${b}) ${t * 100}%`
).join(", ")})`;

export function GeoStateMap({
  states,
  national,
}: {
  states: GeoStateRow[];
  national: GeoPanel;
}) {
  const [metric, setMetric] = useState<MetricKey>("gas");
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
          return (
            <div
              key={s.state}
              title={`${s.name}: ${fmtFull(v, metric)}`}
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
                {fmtTile(v, metric)}
              </div>
            </div>
          );
        })}
      </div>
      <p className="method" style={{ marginBottom: 0 }}>
        US average: {fmtFull(valueOf(national, metric), metric)}. Colored by each
        state&apos;s own latest reading (min–max across states); higher = warmer.
        {suppressed.length > 0 &&
          ` Greyed (${suppressed.join(", ")}): no published value${
            metric === "wage"
              ? " — BLS suppresses small-cell QCEW construction wages for these states."
              : "."
          }`}
      </p>
    </div>
  );
}
