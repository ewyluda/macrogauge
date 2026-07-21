"use client";
import { useMemo, useState } from "react";
import type { Capacity, CapacityCompany, CapacityCohortKey } from "@/lib/types";
import { CapacityBars } from "./CapacityBars";
import { ValuationScatter } from "./ValuationScatter";
import { DemandMap } from "./DemandMap";
import { TimelineChart } from "./TimelineChart";
import { GeoMap } from "./GeoMap";

export function cohortOf(c: CapacityCompany): CapacityCohortKey {
  return c.role === "hyperscaler" ? "hyperscaler" : "neocloud";
}

const COHORTS: [CapacityCohortKey, string][] = [
  ["all", "All"], ["neocloud", "Neoclouds"], ["hyperscaler", "Hyperscalers"],
];
const TABS = ["Capacity", "Valuation × Execution", "Demand map", "Timeline", "Geo map"] as const;
const SORTS: [string, string][] = [
  ["total", "Total"], ["op", "Operational"], ["con", "Construction"],
  ["plan", "Planned"], ["ev_per_mw", "EV / MW"], ["cap", "Mkt cap"],
];

function sortVal(c: CapacityCompany, key: string): number {
  switch (key) {
    case "op": return c.op;
    case "con": return c.con;
    case "plan": return c.plan;
    case "ev_per_mw": return c.ev_per_mw ?? -1;
    case "cap": return c.cap ?? c.valuation_b ?? -1;
    default: return c.op + c.con + c.plan;
  }
}

export function CapacityClient({ data }: { data: Capacity }) {
  const [tab, setTab] = useState<(typeof TABS)[number]>("Capacity");
  const [cohort, setCohort] = useState<CapacityCohortKey>("all");
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState("total");

  const rows = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return data.companies
      .filter((c) => cohort === "all" || cohortOf(c) === cohort)
      .filter((c) => !needle ||
        `${c.t} ${c.n} ${c.econ?.anchor ?? ""}`.toLowerCase().includes(needle))
      .slice()
      .sort((a, b) => sortVal(b, sort) - sortVal(a, sort));
  }, [data, cohort, query, sort]);

  const btn = (on: boolean): React.CSSProperties => ({
    font: "inherit", fontSize: 13, cursor: "pointer", padding: "6px 12px",
    borderRadius: 8, border: "1px solid var(--border)",
    background: on ? "var(--chip-bg)" : "none",
    color: on ? "var(--text)" : "var(--muted)",
  });

  return (
    <div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8, margin: "18px 0 6px" }}>
        {TABS.map((t) => (
          <button key={t} style={btn(tab === t)}
            aria-pressed={tab === t} onClick={() => setTab(t)}>{t}</button>
        ))}
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center", margin: "8px 0 14px" }}>
        {COHORTS.map(([k, label]) => (
          <button key={k} style={btn(cohort === k)} onClick={() => setCohort(k)}>{label}</button>
        ))}
        {tab === "Capacity" && (
          <>
            <span style={{ color: "var(--muted)", fontSize: 12, marginLeft: 8 }}>sort</span>
            {SORTS.map(([k, label]) => (
              <button key={k} style={btn(sort === k)} onClick={() => setSort(k)}>{label}</button>
            ))}
          </>
        )}
        <input value={query} onChange={(e) => setQuery(e.target.value)}
          placeholder="Search ticker, company, customer…" aria-label="Search companies"
          style={{ flex: "1 1 200px", minWidth: 160, font: "inherit", fontSize: 13,
                   padding: "6px 10px", borderRadius: 8,
                   border: "1px solid var(--border)", background: "none",
                   color: "var(--text)" }} />
      </div>
      {tab === "Capacity" && <CapacityBars rows={rows} />}
      {tab === "Valuation × Execution" && <ValuationScatter rows={rows} />}
      {tab === "Demand map" && <DemandMap data={data} visible={new Set(rows.map((r) => r.t))} />}
      {tab === "Timeline" && <TimelineChart timeline={data.timeline[cohort]} />}
      {tab === "Geo map" && <GeoMap data={data} visible={new Set(rows.map((r) => r.t))} />}
    </div>
  );
}
