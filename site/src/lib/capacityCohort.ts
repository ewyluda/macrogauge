import type { CapacityCompany, CapacityCohortKey } from "./types";

/** Cohort membership used by the capacity page filters and the published-timeline parity test. */
export function cohortOf(c: CapacityCompany): CapacityCohortKey {
  return c.role === "hyperscaler" ? "hyperscaler" : "neocloud";
}

/** The business a pure-play row is in, for like-with-like comparisons: GPU
 *  clouds and operators rent out compute; landlords and power developers
 *  (ex-miners, colocation, sites still seeking an AI tenant) lease powered
 *  shells. EV per MW and MW scale are only compared within one. */
export type Business = "hyperscaler" | "cloud" | "landlord";
export function businessOf(c: CapacityCompany): Business {
  if (c.role === "hyperscaler") return "hyperscaler";
  return c.role === "landlord" || c.role === "exploratory" ? "landlord" : "cloud";
}
export const BUSINESS: Record<Business, { label: string; detail: string }> = {
  hyperscaler: { label: "Hyperscalers and AI labs", detail: "self-build for their own clouds and models" },
  cloud: { label: "Neoclouds: GPU clouds and operators", detail: "rent out GPU compute" },
  landlord: { label: "Landlords and power developers", detail: "ex-miners, colocation landlords and sites still seeking AI tenants" },
};

const gw = (mw: number) => `${(mw / 1000).toFixed(1)} GW`;

/**
 * The page's takeaway, written from the published cohort totals and the
 * Nvidia reference. Every number is this tracker's curated universe (most
 * hyperscaler MW are estimates), so the sentence says "tracked" and
 * "estimated", never a market-wide share; and it names the bases it compares
 * (Nvidia's market cap against the cohort's combined EV).
 * "Hyperscalers account for about 91% of our estimated 41.5 GW of tracked
 *  operational AI capacity" +
 * "The neoclouds and ex-miners have 3.8 GW live and 21.9 GW still to energize;
 *  the 14 priced per megawatt carry $243B of combined enterprise value, and
 *  Nvidia's market cap alone ($5.7T) is 24 times that. MW as curated Oct 2, 2026."
 */
export function capacityHeadline(
  cohorts: Record<CapacityCohortKey, { op: number; con: number; plan: number; companies: number }>,
  reference: { nvda_cap_b: number | null; cohort_ev_b: number | null },
  pricedRows: number,
  curatedAsOf?: string,
): { title: string; detail: string } | null {
  const all = cohorts.all, hyp = cohorts.hyperscaler, neo = cohorts.neocloud;
  if (!all.op) return null;
  const share = Math.round((100 * hyp.op) / all.op);
  // "we track": the curated universe, not a market census; "estimated" rides
  // with the curation date in the detail
  const title = `Hyperscalers hold about ${share}% of the ${gw(all.op)} of operating AI capacity we track`;
  let detail = `The neoclouds and ex-miners have ${gw(neo.op)} live and ${gw(neo.con + neo.plan)} still to energize`;
  const { nvda_cap_b: nv, cohort_ev_b: ev } = reference;
  if (nv != null && ev != null && ev > 0 && pricedRows > 0) {
    detail += `; the ${pricedRows} priced per megawatt carry $${Math.round(ev)}B of combined enterprise value, ` +
      `and Nvidia's market cap alone ($${(nv / 1000).toFixed(1)}T) is ${Math.round(nv / ev)} times that`;
  }
  return { title, detail: `${detail}.${curatedAsOf ? ` Estimated MW as curated ${curatedAsOf}.` : ""}` };
}
