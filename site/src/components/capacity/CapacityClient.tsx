"use client";
import { useMemo } from "react";
import { useUrlState } from "@/lib/useUrlState";
import { codecs } from "@/lib/urlState";
import { CopyLink } from "../CopyLink";
import type { Capacity, CapacityCompany, CapacityCohortKey } from "@/lib/types";
import { cohortOf } from "@/lib/capacityCohort";
import { buildTimeline } from "@/lib/capacityTimeline";
import { CapacityBars } from "./CapacityBars";
import { ValuationScatter } from "./ValuationScatter";
import { DemandMap } from "./DemandMap";
import { TimelineChart } from "./TimelineChart";
import { GeoMap } from "./GeoMap";

export { cohortOf } from "@/lib/capacityCohort";

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
  const [tab, setTab] = useUrlState<(typeof TABS)[number]>("tab", "Capacity", codecs.enumOf(TABS));
  const [cohort, setCohort] = useUrlState<CapacityCohortKey>("cohort", "all", codecs.enumOf(COHORTS.map((c) => c[0])));
  const [query, setQuery] = useUrlState("q", "", codecs.str(60));
  const [sort, setSort] = useUrlState("sort", "total", codecs.str(20));

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
          <button key={k} style={btn(cohort === k)}
            aria-pressed={cohort === k} onClick={() => setCohort(k)}>{label}</button>
        ))}
        <CopyLink />
        {tab === "Capacity" && (
          <>
            <span style={{ color: "var(--muted)", fontSize: 12, marginLeft: 8 }}>sort</span>
            {SORTS.map(([k, label]) => (
              <button key={k} style={btn(sort === k)}
                aria-pressed={sort === k} onClick={() => setSort(k)}>{label}</button>
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
      {/* Unfiltered cohorts render the PUBLISHED timeline (capacity.json,
          computed by the pipeline); a text search narrows to a subset the
          artifact never published, so only then is the curve rebuilt
          client-side. capacityTimeline.test.ts pins the two equal. */}
      {tab === "Timeline" && (
        <TimelineChart timeline={query.trim() ? buildTimeline(rows) : (data.timeline?.[cohort] ?? buildTimeline(rows))} />
      )}
      {tab === "Geo map" && <GeoMap data={data} visible={new Set(rows.map((r) => r.t))} />}
    </div>
  );
}
