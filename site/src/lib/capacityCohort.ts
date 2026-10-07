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
 * Nvidia reference: who runs the megawatts live today, what the neoclouds
 * still have to energize, and what the market pays for them.
 * "Hyperscalers run 91% of the 41.5 GW of AI capacity live today" +
 * "The neoclouds and ex-miners have 3.8 GW live and 21.9 GW still to energize;
 *  the 18 priced per megawatt are worth $243B combined, and Nvidia alone is
 *  worth 24 times that ($5.7T)."
 */
export function capacityHeadline(
  cohorts: Record<CapacityCohortKey, { op: number; con: number; plan: number; companies: number }>,
  reference: { nvda_cap_b: number | null; cohort_ev_b: number | null },
  pricedRows: number,
): { title: string; detail: string } | null {
  const all = cohorts.all, hyp = cohorts.hyperscaler, neo = cohorts.neocloud;
  if (!all.op) return null;
  const share = Math.round((100 * hyp.op) / all.op);
  const title = `Hyperscalers run ${share}% of the ${gw(all.op)} of AI capacity live today`;
  let detail = `The neoclouds and ex-miners have ${gw(neo.op)} live and ${gw(neo.con + neo.plan)} still to energize`;
  const { nvda_cap_b: nv, cohort_ev_b: ev } = reference;
  if (nv != null && ev != null && ev > 0 && pricedRows > 0) {
    detail += `; the ${pricedRows} priced per megawatt are worth $${Math.round(ev)}B combined, ` +
      `and Nvidia alone is worth ${Math.round(nv / ev)} times that ($${(nv / 1000).toFixed(1)}T)`;
  }
  return { title, detail: `${detail}.` };
}
