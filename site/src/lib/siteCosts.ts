// /states ("Site Costs"): the metric definitions the map and the sorted table
// share, and the page headline, written from geo.json.
import type { GeoPanel, GeoStateRow } from "./types";

export type MetricKey = "elec_ind" | "elec_res" | "wage" | "gas" | "unemployment";

/** Industrial power leads: the EIA state industrial-sector average price is
 *  the closest published screen for what a large load pays (its actual bill
 *  is its utility tariff and contract — see /power). */
export const METRICS: { key: MetricKey; label: string; noun: string }[] = [
  { key: "elec_ind", label: "Industrial ¢/kWh", noun: "industrial power price" },
  { key: "wage", label: "Construction $/wk", noun: "construction wage" },
  { key: "elec_res", label: "Residential ¢/kWh", noun: "residential power price" },
  { key: "gas", label: "Gas $/gal", noun: "pump price" },
  { key: "unemployment", label: "Unemployment %", noun: "unemployment rate" },
];

export function valueOf(p: GeoPanel, m: MetricKey): number | null {
  switch (m) {
    case "gas": return p.gas_regular.value;
    case "elec_res": return p.elec_res_cents.value;
    case "elec_ind": return p.elec_ind_cents.value;
    case "wage": return p.wage_weekly.value;
    case "unemployment": return p.unemployment_pct.value;
  }
}

/** States sorted by the active metric, highest first; states with no value
 *  last (alphabetical among themselves — they are never ranked). */
export function sortByMetric(states: GeoStateRow[], m: MetricKey): GeoStateRow[] {
  return [...states].sort((a, b) => {
    const va = valueOf(a, m), vb = valueOf(b, m);
    if (va == null && vb == null) return a.name.localeCompare(b.name);
    if (va == null) return 1;
    if (vb == null) return -1;
    return vb - va || a.name.localeCompare(b.name);
  });
}

/** The headline spread is the contiguous states, where data-center siting
 *  actually competes: Hawaii and Alaska run isolated grids, and the District
 *  of Columbia is a city with little industrial load. The table ranks all 51. */
const OFF_GRID = new Set(["HI", "AK", "DC"]);

const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const month = (d: string | null) => (d ? `${MON[Number(d.slice(5, 7)) - 1]} ${d.slice(0, 4)}` : "date unknown");

/**
 * The page's takeaway: the spread in the EIA state industrial-sector AVERAGE
 * price (revenue ÷ sales — a screening proxy, not any customer's tariff).
 * title: one claim, "Industrial power costs 6× as much in California as in
 * New Mexico". detail: its cohort and period, stated, never assumed —
 * "across the 48 contiguous states" only when all of them report, else
 * "across 47 of 48 contiguous states reporting"; one month when both ends
 * share it, else each end dated — then the US average.
 * Null without two priced states.
 */
export function siteCostsHeadline(states: GeoStateRow[], national: GeoPanel): { title: string; detail: string } | null {
  const contiguous = states.filter((s) => !OFF_GRID.has(s.state));
  const priced = sortByMetric(contiguous, "elec_ind").filter((s) => s.elec_ind_cents.value != null);
  if (priced.length < 2) return null;
  const hi = priced[0], lo = priced[priced.length - 1];
  const x = hi.elec_ind_cents.value! / lo.elec_ind_cents.value!;
  const times = x >= 10 ? `${Math.round(x)}` : x.toFixed(1).replace(/\.0$/, "");
  const title = `Industrial power costs ${times}× as much in ${hi.name} as in ${lo.name}`;
  const cohort = priced.length === contiguous.length
    ? `across the ${contiguous.length} contiguous states`
    : `across ${priced.length} of ${contiguous.length} contiguous states reporting`;
  const sameMonth = hi.elec_ind_cents.as_of != null && hi.elec_ind_cents.as_of === lo.elec_ind_cents.as_of;
  const at = (st: GeoStateRow, unit: string) =>
    `${st.name} ${st.elec_ind_cents.value!.toFixed(1)}${unit}${sameMonth ? "" : ` (${month(st.elec_ind_cents.as_of)})`}`;
  let detail = `Average industrial price ${cohort}${sameMonth ? `, ${month(hi.elec_ind_cents.as_of)}` : ""}: ` +
    `${at(hi, "¢/kWh")}, ${at(lo, "¢")}.`;
  const nat = national.elec_ind_cents;
  if (nat.value != null) {
    detail += ` The US average is ${nat.value.toFixed(2)}¢`;
    if (nat.yoy_pct != null) {
      const r = Number(nat.yoy_pct.toFixed(1));
      detail += r === 0 ? ", flat on the year" : `, ${r > 0 ? "up" : "down"} ${Math.abs(r).toFixed(1)}% on the year`;
    }
    detail += ".";
  }
  return { title, detail };
}
