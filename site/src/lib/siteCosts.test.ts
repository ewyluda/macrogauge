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

  it("leads with one claim and names the full contiguous cohort and its one month (Hawaii and DC left out)", () => {
    expect(siteCostsHeadline(full, nat)).toEqual({
      title: "Industrial power costs 3.4× as much in California as in Oklahoma",
      detail: "Average industrial price across the 3 contiguous states, Jul 2026: California 25.1¢/kWh, Oklahoma 7.4¢. " +
        "The US average is 9.77¢, up 4.7% on the year.",
    });
  });
  it("says how many report when one is missing — never claims the full cohort", () => {
    // the highest-price state unreported: the spread is a different comparison
    const missing = [...full.filter((s) => s.state !== "CA"), st("CA", "California", null)];
    const h = siteCostsHeadline(missing, nat)!;
    expect(h.title).toBe("Industrial power costs 1.1× as much in Alabama as in Oklahoma");
    expect(h.detail).toMatch(/^Average industrial price across 2 of 3 contiguous states reporting, Jul 2026: Alabama 8\.4¢\/kWh/);
  });
  it("dates each end when they come from different months, and drops a whole multiple's decimal", () => {
    const mixed = full.map((s) => s.state === "CA"
      ? { ...s, elec_ind_cents: { ...s.elec_ind_cents, as_of: "2026-06-01" } } : s);
    expect(siteCostsHeadline(mixed, nat)?.detail).toContain(
      "across the 3 contiguous states: California 25.1¢/kWh (Jun 2026), Oklahoma 7.4¢ (Jul 2026).");
    expect(siteCostsHeadline([st("OK", "Oklahoma", 4), st("CA", "California", 24)], nat)?.title)
      .toBe("Industrial power costs 6× as much in California as in Oklahoma");
  });
  it("is null without two priced states", () => {
    expect(siteCostsHeadline([st("OK", "Oklahoma", 7.4)], panel(9.77))).toBeNull();
  });
});
