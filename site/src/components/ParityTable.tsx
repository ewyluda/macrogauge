// site/src/components/ParityTable.tsx
"use client";
import { useState } from "react";

export type ParityRow = {
  state: string; power_rel: number; ops_mult: number; power_asof: string;
  wage_rel: number | null; build_mult: number | null; wage_asof: string | null;
  power_cents?: number; wage_level?: number | null;
};

type Key = "state" | "build_mult" | "ops_mult";

function fmt(v: number | null): string {
  return v == null ? "—" : v.toFixed(3);
}

export function ParityTable({ states, mode }: { states: ParityRow[]; mode: string }) {
  const [key, setKey] = useState<Key>("ops_mult");
  const [asc, setAsc] = useState(false);
  const rows = [...states].sort((a, b) => {
    const av = a[key], bv = b[key];
    if (av == null && bv == null) return 0;
    if (av == null) return 1;
    if (bv == null) return -1;
    const cmp = av < bv ? -1 : av > bv ? 1 : 0;
    return asc ? cmp : -cmp;
  });
  const th = (label: string, k: Key) => (
    <th style={{ cursor: "pointer" }}
        onClick={() => (k === key ? setAsc(!asc) : (setKey(k), setAsc(k === "state")))}>
      {label}{key === k ? (asc ? " ↑" : " ↓") : ""}
    </th>
  );
  return (
    <div className="table-card">
      <table className="data-table">
        <thead><tr>
          {th("State", "state")}{th("Build ×", "build_mult")}{th("Ops ×", "ops_mult")}
          <th>Wage rel</th><th>Power rel</th><th>Power ¢/kWh</th><th>QCEW wage</th>
          <th>Wage as-of</th><th>Power as-of</th>
        </tr></thead>
        <tbody>{rows.map((r) => (
          <tr key={r.state}>
            <td>{r.state}</td><td>{fmt(r.build_mult)}</td><td>{fmt(r.ops_mult)}</td>
            <td>{fmt(r.wage_rel)}</td><td>{fmt(r.power_rel)}</td>
            <td>{r.power_cents != null ? r.power_cents.toFixed(2) : "—"}</td>
            <td>{r.wage_level != null ? `$${r.wage_level.toLocaleString()}` : "—"}</td>
            <td>{r.wage_asof ?? "—"}</td><td>{r.power_asof}</td>
          </tr>
        ))}</tbody>
      </table>
      {mode === "ops_only" ? (
        <p className="method">Build parity unavailable this run (QCEW wages missing) — showing power-driven ops parity only.</p>
      ) : states.some((s) => s.build_mult == null) ? (
        <p className="method">— in the Build column: BLS suppresses small-cell QCEW wages for these states, so no current-quarter wage relative exists.</p>
      ) : null}
    </div>
  );
}
