// site/src/components/ParityTable.tsx
"use client";
import { useState } from "react";

export type ParityRow = {
  state: string; power_rel: number; ops_mult: number; power_asof: string;
  wage_rel: number | null; build_mult: number | null; wage_asof: string | null;
  power_cents?: number; wage_level?: number | null;
  /** state's newest QCEW quarter lags national (disclosure suppression): its
   *  build multiplier compares the state's own latest quarter to the national
   *  wage for that same quarter */
  wage_lagged?: boolean;
};

/** "2025-10-01" -> "Q4 2025" */
export function quarterLabel(day: string): string {
  const m = Number(day.slice(5, 7));
  return `Q${Math.floor((m - 1) / 3) + 1} ${day.slice(0, 4)}`;
}

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
  // Sortable headers are real buttons with aria-sort (todo #28) — the same
  // pattern /markets uses — so they are reachable by keyboard and announce
  // which column drives the order.
  const th = (label: string, k: Key) => (
    <th aria-sort={key === k ? (asc ? "ascending" : "descending") : undefined}>
      <button type="button"
        onClick={() => (k === key ? setAsc(!asc) : (setKey(k), setAsc(k === "state")))}
        style={{ background: "none", border: 0, padding: 0, width: "100%", color: "inherit",
                 cursor: "pointer", font: "inherit", textAlign: "inherit" }}>
        {label}{key === k ? (asc ? " ↑" : " ↓") : ""}
      </button>
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
            <td>{r.state}</td>
            <td>{fmt(r.build_mult)}{r.wage_lagged && r.wage_asof ? (
              <span style={{ color: "var(--muted)", fontSize: 11 }}> ({quarterLabel(r.wage_asof)})</span>
            ) : null}</td>
            <td>{fmt(r.ops_mult)}</td>
            <td>{fmt(r.wage_rel)}</td><td>{fmt(r.power_rel)}</td>
            <td>{r.power_cents != null ? r.power_cents.toFixed(2) : "—"}</td>
            <td>{r.wage_level != null ? `$${r.wage_level.toLocaleString("en-US")}` : "—"}</td>
            <td>{r.wage_asof ?? "—"}</td><td>{r.power_asof}</td>
          </tr>
        ))}</tbody>
      </table>
      {mode === "ops_only" ? (
        <p className="method">Build parity unavailable this run (QCEW wages missing) — showing power-driven ops parity only.</p>
      ) : null}
      {mode !== "ops_only" && states.some((s) => s.wage_lagged) ? (
        <p className="method">A quarter in brackets in the Build column: BLS suppressed that state&apos;s newest QCEW
          construction wage, so its multiplier compares the state&apos;s own latest published quarter with the national
          wage for that same quarter — like-for-like, one quarter older than the rest.</p>
      ) : null}
      {mode !== "ops_only" && states.some((s) => s.build_mult == null) ? (
        <p className="method">— in the Build column: BLS suppresses small-cell QCEW wages for these states, so no wage relative exists.</p>
      ) : null}
    </div>
  );
}
