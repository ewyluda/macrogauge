import type { CapacityCompany, CapacityCohortKey } from "./types";

/** Cohort membership used by the capacity page filters and the published-timeline parity test. */
export function cohortOf(c: CapacityCompany): CapacityCohortKey {
  return c.role === "hyperscaler" ? "hyperscaler" : "neocloud";
}
