import { describe, expect, it } from "vitest";
import {
  cumulativeSpend, DEFAULT_DURATION_MONTHS, inverseCumulativeSpend, resolveStart, sCurveCost, spendSchedule,
} from "./sCurve";

describe("sine-squared cumulative spend", () => {
  it("is 0 at start, ½ at mid-build, 1 at delivery, and clamps outside", () => {
    expect(cumulativeSpend(0)).toBe(0);
    expect(cumulativeSpend(0.5)).toBeCloseTo(0.5, 12);
    expect(cumulativeSpend(1)).toBeCloseTo(1, 12);
    expect(cumulativeSpend(-0.3)).toBe(0);
    expect(cumulativeSpend(1.7)).toBeCloseTo(1, 12);
  });
  it("is symmetric, monotone, and inverted exactly", () => {
    let prev = -1;
    for (let k = 0; k <= 20; k++) {
      const u = k / 20;
      expect(cumulativeSpend(1 - u)).toBeCloseTo(1 - cumulativeSpend(u), 12);
      expect(cumulativeSpend(u)).toBeGreaterThanOrEqual(prev);
      prev = cumulativeSpend(u);
      expect(inverseCumulativeSpend(cumulativeSpend(u))).toBeCloseTo(u, 9);
    }
    // a quarter of the way in, sin²(π/8) ≈ 14.6% is out of the door
    expect(cumulativeSpend(0.25)).toBeCloseTo((1 - Math.SQRT1_2) / 2, 12);
  });
});

describe("spendSchedule", () => {
  it("incurred fraction at start, mid and end of construction", () => {
    expect(spendSchedule("2026-01", "2028-01", "2026-01")!.incurredFraction).toBe(0);
    expect(spendSchedule("2025-01", "2027-01", "2026-01")!.incurredFraction).toBeCloseTo(0.5, 12);
    const done = spendSchedule("2024-01", "2026-01", "2026-01")!;
    expect(done.incurredFraction).toBe(1);
    expect(done.remainingFraction).toBe(0);
    expect(done.midpointMonth).toBeNull();
    expect(done.midpointHorizon).toBe(0);
  });
  it("a build not yet started has its spend midpoint at the start/delivery midpoint", () => {
    const s = spendSchedule("2027-01", "2029-01", "2026-06")!;
    expect(s.incurredFraction).toBe(0);
    expect(s.remainingFraction).toBe(1);
    expect(s.midpointMonth).toBe("2028-01");
    expect(s.midpointHorizon).toBe(19);
    // odd duration rounds to a month: 25 / 2 = 12.5 -> 13
    expect(spendSchedule("2027-01", "2029-02", "2026-06")!.midpointMonth).toBe("2028-02");
  });
  it("a build in progress carries only the remaining spend, to the remaining spend's midpoint", () => {
    // half spent: remaining tail is S ∈ [½, 1]; its midpoint S = ¾ is u = 2/3 -> month 16 of 24
    const s = spendSchedule("2025-08", "2027-08", "2026-08")!;
    expect(s.incurredFraction).toBeCloseTo(0.5, 12);
    expect(inverseCumulativeSpend(0.75)).toBeCloseTo(2 / 3, 12);
    expect(s.midpointMonth).toBe("2026-12");
    expect(s.midpointHorizon).toBe(4);
    // the midpoint is never before the anchor
    const late = spendSchedule("2024-09", "2026-09", "2026-08")!;
    expect(late.midpointHorizon).toBeGreaterThanOrEqual(0);
    expect(late.midpointMonth! >= "2026-08").toBe(true);
  });
  it("assumes a 24-month build when no start month is given", () => {
    expect(DEFAULT_DURATION_MONTHS).toBe(24);
    expect(resolveStart(undefined, "2028-03")).toEqual({ month: "2026-03", assumed: true });
    expect(resolveStart("2027-01", "2028-03")).toEqual({ month: "2027-01", assumed: false });
    const s = spendSchedule(undefined, "2028-08", "2026-08")!;
    expect(s.startAssumed).toBe(true);
    expect(s.startMonth).toBe("2026-08");
    expect(s.durationMonths).toBe(24);
    expect(s.midpointMonth).toBe("2027-08");
  });
  it("rejects a start on or after delivery", () => {
    expect(spendSchedule("2028-01", "2028-01", "2026-01")).toBeNull();
    expect(spendSchedule("2028-06", "2028-01", "2026-01")).toBeNull();
  });
});

describe("sCurveCost", () => {
  it("holds the incurred share at to-date and compounds the rest to the midpoint", () => {
    const s = spendSchedule("2025-08", "2027-08", "2026-08")!;
    const got = sCurveCost(1_000, s, 6);
    expect(got).toBeCloseTo(1_000 * (0.5 + 0.5 * Math.pow(1.06, 4 / 12)), 9);
    // smaller than carrying everything to delivery (12 months) at a positive basis
    expect(got).toBeLessThan(1_000 * 1.06);
    // nothing remaining -> nothing carried
    expect(sCurveCost(1_000, spendSchedule("2023-01", "2025-01", "2026-08")!, 6)).toBe(1_000);
  });
});
