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
// The valuation view leads: market cap ≠ megawatts is the page's point, and
// the scatter is where it shows (scorecard 2026-10-07).
const TABS = ["Valuation × Execution", "Capacity", "Demand map", "Timeline", "Geo map"] as const;
const SORTS: [string, string][] = [
  ["total", "Total MW"], ["op", "Operational MW"], ["con", "Construction MW"],
  ["plan", "Planned MW"], ["ev_per_mw", "EV per MW"], ["cap", "Market cap"],
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
  const [tab, setTab] = useUrlState<(typeof TABS)[number]>("tab", "Valuation × Execution", codecs.enumOf(TABS));
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

  const tabIds = (t: string) => `cap-tab-${t.toLowerCase().replace(/[^a-z]+/g, "-")}`;
  const onTabKey = (e: React.KeyboardEvent<HTMLButtonElement>, i: number) => {
    const step = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0;
    if (!step) return;
    e.preventDefault();
    const next = TABS[(i + step + TABS.length) % TABS.length];
    setTab(next);
    document.getElementById(tabIds(next))?.focus();
  };

  return (
    <div className="capacity-workspace">
      <div className="cap-tabs" role="tablist" aria-label="Capacity views">
        {TABS.map((t, i) => (
          <button key={t} id={tabIds(t)} type="button" role="tab" className="cap-tab"
            aria-selected={tab === t} aria-controls="cap-panel" tabIndex={tab === t ? 0 : -1}
            onClick={() => setTab(t)} onKeyDown={(e) => onTabKey(e, i)}>{t}</button>
        ))}
      </div>
      <div className="cap-toolbar">
        <div className="cap-cohort" role="group" aria-label="Cohort">
          {COHORTS.map(([k, label]) => (
            <button key={k} type="button" aria-pressed={cohort === k} onClick={() => setCohort(k)}>
              {label} <span className="cap-count">{data.cohorts[k].companies}</span>
            </button>
          ))}
        </div>
        <input type="search" className="cap-search" value={query} onChange={(e) => setQuery(e.target.value)}
          placeholder="Search ticker, company or customer" aria-label="Search companies" />
        {tab === "Capacity" && (
          <label className="cap-sort">
            <span>Sort by</span>
            <select value={sort} onChange={(e) => setSort(e.target.value)}>
              {SORTS.map(([k, label]) => <option key={k} value={k}>{label}</option>)}
            </select>
          </label>
        )}
        <CopyLink />
      </div>
      <div id="cap-panel" role="tabpanel" aria-labelledby={tabIds(tab)}>
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
    </div>
  );
}
