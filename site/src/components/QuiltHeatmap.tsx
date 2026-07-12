"use client";
import { useEffect, useState } from "react";
import { SegmentedControl } from "./SegmentedControl";
import { heatColor } from "@/lib/heat";
import { exportQuiltPng, type QuiltRow } from "@/lib/quiltPng";

type Quilt = {
  published_at: string;
  months: string[]; // "YYYY-MM"
  components: {
    code: string;
    label: string;
    weight: number;
    ours_yoy_pct: (number | null)[];
    official_yoy_pct: (number | null)[];
  }[];
};
type Compare = {
  months: string[]; // "YYYY-MM-01"
  official_yoy_pct: (number | null)[];
  official_core_yoy_pct: (number | null)[];
  gauge_yoy_pct: (number | null)[];
  col_yoy_pct: (number | null)[];
  tracker_yoy_pct: (number | null)[];
};

const WINDOWS = [
  { key: "24", label: "24M" },
  { key: "48", label: "48M" },
  { key: "all", label: "FULL HISTORY" },
] as const;
type WindowKey = (typeof WINDOWS)[number]["key"];

const HEADLINES: [string, keyof Compare][] = [
  ["OURS: CPI-Comparable", "gauge_yoy_pct"],
  ["OURS: Cost of Living", "col_yoy_pct"],
  ["OURS: CPI-Tracker", "tracker_yoy_pct"],
  ["BLS: CPI YoY", "official_yoy_pct"],
  ["BLS: Core CPI YoY", "official_core_yoy_pct"],
];

// Keep this presentation order aligned with Nowflation's public quilt. The
// codes are MacroGauge's stable artifact keys; labels intentionally match the
// public comparison surface rather than the longer internal component names.
const COMPONENT_ROWS: [string, string][] = [
  ["shelter_rent", "Shelter: Rent"],
  ["shelter_owned", "Shelter: Owned"],
  ["fuel", "Motor Fuel"],
  ["used_vehicles", "Used Vehicles"],
  ["new_vehicles", "New Vehicles"],
  ["food_home", "Food at Home"],
  ["food_away", "Food Away"],
  ["electricity", "Electricity"],
  ["nat_gas", "Utility Gas"],
  ["medical", "Medical Care"],
  ["apparel", "Apparel"],
  ["recreation", "Recreation"],
  ["education_comm", "Education & Comm"],
  ["other", "Everything Else"],
];

/** BLS trailing months where the print lags stay null — rendered empty,
 *  never forward-filled. */
function headlineRows(months: string[], compare: Compare): QuiltRow[] {
  return HEADLINES.map(([label, key]) => ({
    label,
    values: months.map((m) => {
      const i = compare.months.findIndex((cm) => cm.slice(0, 7) === m);
      return i === -1 ? null : (compare[key][i] as number | null);
    }),
  }));
}

function Cell({ v }: { v: number | null }) {
  return (
    <td
      style={{
        background: heatColor(v),
        minWidth: 42,
        height: 26,
        textAlign: "center",
        fontSize: 10.5,
        fontVariantNumeric: "tabular-nums",
        color: "rgba(255,255,255,0.92)",
        border: "1px solid var(--bg)",
      }}
    >
      {v === null ? "" : v.toFixed(2)}
    </td>
  );
}

export function QuiltHeatmap() {
  const [win, setWin] = useState<WindowKey>("24");
  const [cache, setCache] = useState<Partial<Record<WindowKey, Quilt>>>({});
  const [compare, setCompare] = useState<Compare | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    fetch("/data/compare.json")
      .then((r) => r.json())
      .then(setCompare)
      .catch(() => {
        setCompare(null);
        setFailed(true);
      });
  }, []);

  useEffect(() => {
    if (cache[win]) return;
    fetch(`/data/quilt_months_${win}.json`)
      .then((r) => r.json())
      .then((q: Quilt) => setCache((c) => ({ ...c, [win]: q })))
      .catch(() => setFailed(true));
  }, [win, cache]);

  const quilt = cache[win];
  if (failed) {
    return (
      <div style={{ color: "var(--muted)", fontSize: 13, padding: 24 }}>
        inflation quilt data unavailable — reload to retry
      </div>
    );
  }
  if (!quilt || !compare) {
    return (
      <div style={{ color: "var(--muted)", fontSize: 13, padding: 24 }}>
        loading inflation quilt…
      </div>
    );
  }

  const compRows: QuiltRow[] = COMPONENT_ROWS.flatMap(([code, label]) => {
    const component = quilt.components.find((candidate) => candidate.code === code);
    return component ? [{ label, values: component.ours_yoy_pct }] : [];
  });
  const hRows = headlineRows(quilt.months, compare);
  const asOf = quilt.months[quilt.months.length - 1];

  const labelTd: React.CSSProperties = {
    position: "sticky",
    left: 0,
    background: "var(--card)",
    textAlign: "right",
    fontSize: 12,
    color: "var(--muted)",
    padding: "0 8px",
    whiteSpace: "nowrap",
  };

  return (
    <div
      style={{
        background: "var(--card)",
        border: "1px solid var(--border)",
        borderRadius: 10,
        padding: 12,
      }}
    >
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
        <SegmentedControl options={WINDOWS} value={win} onChange={setWin} />
        <button
          onClick={() => exportQuiltPng(quilt.months, compRows, hRows, asOf)}
          style={{
            border: "1px solid var(--border)",
            background: "var(--chip-bg)",
            color: "var(--muted)",
            borderRadius: 999,
            padding: "2px 12px",
            fontSize: 12,
            cursor: "pointer",
          }}
        >
          ⬇ Export 1920×1080 PNG
        </button>
      </div>
      <div style={{ overflowX: "auto" }}>
        <table style={{ borderCollapse: "collapse" }}>
          <tbody>
            {compRows.map((r) => (
              <tr key={r.label}>
                <td style={labelTd}>{r.label}</td>
                {r.values.map((v, i) => (
                  <Cell key={quilt.months[i]} v={v} />
                ))}
              </tr>
            ))}
            <tr style={{ height: 10 }}>
              <td colSpan={quilt.months.length + 1} />
            </tr>
            {hRows.map((r) => (
              <tr key={r.label}>
                <td style={{ ...labelTd, fontWeight: 600 }}>{r.label}</td>
                {r.values.map((v, i) => (
                  <Cell key={quilt.months[i]} v={v} />
                ))}
              </tr>
            ))}
            <tr>
              <td style={labelTd} />
              {quilt.months.map((m, i) => (
                <td
                  key={m}
                  style={{
                    fontSize: 10,
                    color: "var(--muted)",
                    textAlign: "center",
                    padding: "4px 0",
                  }}
                >
                  {i % Math.max(1, Math.ceil(quilt.months.length / 26)) === 0
                    ? m
                    : ""}
                </td>
              ))}
            </tr>
          </tbody>
        </table>
      </div>
      <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 8 }}>
        Cell = our component YoY that month (own-observation, like-month honest) ·
        headline rows from compare.json · empty BLS/OURS-headline cells = print not yet
        released or trailing past compare.json&apos;s last graded month · colors: −2% blue →
        +6% red, same scale as the treemap · as of {asOf}.
      </div>
    </div>
  );
}
