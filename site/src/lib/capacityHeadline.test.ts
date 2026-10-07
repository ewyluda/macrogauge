import { describe, expect, it } from "vitest";
import { capacityHeadline } from "./capacityCohort";

const cohorts = {
  all: { companies: 29, op: 41475.5, con: 33871.3, plan: 49818 },
  neocloud: { companies: 19, op: 3754.5, con: 8381.3, plan: 13558 },
  hyperscaler: { companies: 10, op: 37721, con: 25490, plan: 36260 },
};

describe("capacityHeadline", () => {
  it("states who runs the live megawatts and what the pure plays are worth against Nvidia", () => {
    expect(capacityHeadline(cohorts, { nvda_cap_b: 5735.1, cohort_ev_b: 242.5 }, 14, "Oct 2, 2026")).toEqual({
      // "tracked" and "estimated": the curated universe, not a market census
      title: "Hyperscalers account for about 91% of our estimated 41.5 GW of tracked operational AI capacity",
      // the bases are named: Nvidia's market cap against the cohort's EV
      detail: "The neoclouds and ex-miners have 3.8 GW live and 21.9 GW still to energize; " +
        "the 14 priced per megawatt carry $243B of combined enterprise value, and Nvidia's market cap alone " +
        "($5.7T) is 24 times that. MW as curated Oct 2, 2026.",
    });
  });
  it("drops the valuation clause before the first repricing, and is null with no live MW", () => {
    expect(capacityHeadline(cohorts, { nvda_cap_b: null, cohort_ev_b: null }, 0)?.detail)
      .toBe("The neoclouds and ex-miners have 3.8 GW live and 21.9 GW still to energize.");
    expect(capacityHeadline({ ...cohorts, all: { ...cohorts.all, op: 0 } }, { nvda_cap_b: 1, cohort_ev_b: 1 }, 1)).toBeNull();
  });
});
