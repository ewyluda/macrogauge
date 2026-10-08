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
  const nat = { ...panel(9.77), elec_ind_cents: m(9.77, 4.72) };
  const full = [st("OK", "Oklahoma", 7.4), st("HI", "Hawaii", 29.5), st("CA", "California", 25.1),
    st("AL", "Alabama", 8.42), st("DC", "District of Columbia", 32.1)];

  it("names the full contiguous cohort and its one month (Hawaii and DC left out)", () => {
    expect(siteCostsHeadline(full, nat)).toBe(
      "Across the 3 contiguous states, the average industrial power price in Jul 2026 is 3.4× higher in " +
      "California (25.1¢/kWh) than in Oklahoma (7.4¢); the US average is 9.77¢, up 4.7% on the year");
  });
  it("says how many report when one is missing — never claims the full cohort", () => {
    // the highest-price state unreported: the spread is a different comparison
    const missing = [...full.filter((s) => s.state !== "CA"), st("CA", "California", null)];
    expect(siteCostsHeadline(missing, nat)).toMatch(
      /^Across 2 of 3 contiguous states reporting, .* 1\.1× higher in Alabama \(8\.4¢\/kWh\) than in Oklahoma/);
  });
  it("dates each end when they come from different months", () => {
    const mixed = full.map((s) => s.state === "CA"
      ? { ...s, elec_ind_cents: { ...s.elec_ind_cents, as_of: "2026-06-01" } } : s);
    expect(siteCostsHeadline(mixed, nat)).toContain(
      "price is 3.4× higher in California (25.1¢/kWh, Jun 2026) than in Oklahoma (7.4¢, Jul 2026)");
  });
  it("is null without two priced states", () => {
    expect(siteCostsHeadline([st("OK", "Oklahoma", 7.4)], panel(9.77))).toBeNull();
  });
});
