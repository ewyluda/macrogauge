import { describe, expect, it } from "vitest";
import { capacityHeadline } from "./capacityCohort";

const cohorts = {
  all: { companies: 29, op: 41475.5, con: 33871.3, plan: 49818 },
  neocloud: { companies: 19, op: 3754.5, con: 8381.3, plan: 13558 },
  hyperscaler: { companies: 10, op: 37721, con: 25490, plan: 36260 },
};

describe("capacityHeadline", () => {
  it("states who runs the live megawatts and what the pure plays are worth against Nvidia", () => {
    expect(capacityHeadline(cohorts, { nvda_cap_b: 5735.1, cohort_ev_b: 242.5 }, 18)).toEqual({
      title: "Hyperscalers run 91% of the 41.5 GW of AI capacity live today",
      detail: "The neoclouds and ex-miners have 3.8 GW live and 21.9 GW still to energize; " +
        "the 18 priced per megawatt are worth $243B combined, and Nvidia alone is worth 24 times that ($5.7T).",
    });
  });
  it("drops the valuation clause before the first repricing, and is null with no live MW", () => {
    expect(capacityHeadline(cohorts, { nvda_cap_b: null, cohort_ev_b: null }, 0)?.detail)
      .toBe("The neoclouds and ex-miners have 3.8 GW live and 21.9 GW still to energize.");
    expect(capacityHeadline({ ...cohorts, all: { ...cohorts.all, op: 0 } }, { nvda_cap_b: 1, cohort_ev_b: 1 }, 1)).toBeNull();
  });
});
