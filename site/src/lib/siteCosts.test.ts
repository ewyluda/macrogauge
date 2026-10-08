import { describe, expect, it } from "vitest";
import { siteCostsHeadline, sortByMetric } from "./siteCosts";
import type { GeoPanel, GeoStateRow } from "./types";

const m = (value: number | null, yoy: number | null = null) => ({ value, as_of: "2026-07-01", yoy_pct: yoy });
const panel = (ind: number | null, wage: number | null = 1500): GeoPanel => ({
  gas_regular: m(3.5), elec_res_cents: m(16), elec_ind_cents: m(ind), wage_weekly: m(wage),
  unemployment_pct: { value: 4, as_of: "2026-08-01", delta_1y_pp: 0.1 },
});
const st = (state: string, name: string, ind: number | null, wage: number | null = 1500): GeoStateRow =>
  ({ state, name, ...panel(ind, wage) });
const states = [st("OK", "Oklahoma", 7.4), st("HI", "Hawaii", 29.5), st("CA", "California", 25.1), st("AL", "Alabama", 8.42), st("DC", "District of Columbia", 32.1), st("WY", "Wyoming", null)];

describe("sortByMetric", () => {
  it("ranks highest first and puts missing values last", () => {
    expect(sortByMetric(states, "elec_ind").map((s) => s.state)).toEqual(["DC", "HI", "CA", "AL", "OK", "WY"]);
  });
});

describe("siteCostsHeadline", () => {
  it("states the contiguous-48 spread (Hawaii and DC left out) and the US average", () => {
    expect(siteCostsHeadline(states, { ...panel(9.77), elec_ind_cents: m(9.77, 4.72) }))
      .toBe("Across the 48 contiguous states, industrial power costs 3.4× as much in California (25.1¢/kWh) as in Oklahoma (7.4¢); the US average is 9.77¢, up 4.7% on the year");
  });
  it("is null without two priced states", () => {
    expect(siteCostsHeadline([st("OK", "Oklahoma", 7.4)], panel(9.77))).toBeNull();
  });
});
