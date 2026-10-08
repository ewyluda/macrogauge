// /states ("Site Costs"): the metric definitions the map and the sorted table
// share, and the page headline, written from geo.json.
import type { GeoPanel, GeoStateRow } from "./types";

export type MetricKey = "elec_ind" | "elec_res" | "wage" | "gas" | "unemployment";

/** Industrial power leads: it is the site-selection cost a data center pays. */
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

/** The headline spread is the 48 contiguous states, where data-center
 *  siting actually competes: Hawaii and Alaska run isolated grids, and the
 *  District of Columbia is a city with little industrial load. The table
 *  still ranks all 51. */
const OFF_GRID = new Set(["HI", "AK", "DC"]);

/** "Across the 48 contiguous states, industrial power costs 6.0× as much in California
 *  (25.1¢/kWh) as in New Mexico (4.2¢); the US average is 9.77¢, up 4.7% on
 *  the year" — null without data. */
export function siteCostsHeadline(states: GeoStateRow[], national: GeoPanel): string | null {
  const priced = sortByMetric(states.filter((s) => !OFF_GRID.has(s.state)), "elec_ind")
    .filter((s) => s.elec_ind_cents.value != null);
  if (priced.length < 2) return null;
  const hi = priced[0], lo = priced[priced.length - 1];
  const x = hi.elec_ind_cents.value! / lo.elec_ind_cents.value!;
  let s = `Across the 48 contiguous states, industrial power costs ${x.toFixed(1)}× as much in ${hi.name} (${hi.elec_ind_cents.value!.toFixed(1)}¢/kWh) ` +
    `as in ${lo.name} (${lo.elec_ind_cents.value!.toFixed(1)}¢)`;
  const nat = national.elec_ind_cents;
  if (nat.value != null) {
    s += `; the US average is ${nat.value.toFixed(2)}¢`;
    if (nat.yoy_pct != null) {
      const r = Number(nat.yoy_pct.toFixed(1));
      s += r === 0 ? ", flat on the year" : `, ${r > 0 ? "up" : "down"} ${Math.abs(r).toFixed(1)}% on the year`;
    }
  }
  return s;
}
