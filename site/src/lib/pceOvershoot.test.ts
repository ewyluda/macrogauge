import { describe, expect, it } from "vitest";
import compare from "../../public/data/compare.json";
import { overshoot } from "./pceOvershoot";

describe("overshoot", () => {
  it("finds the longest run at or above the gap and its peak", () => {
    const m = ["2021-01", "2021-02", "2021-03", "2021-04", "2021-05", "2021-06"];
    expect(overshoot(m, [1, 3, 4, 2, 5, 1], [1, 1.5, 1.5, 1.5, 1, 1]))
      .toEqual({ from: "2021-02", to: "2021-03", peakGapPp: 2.5, peakMonth: "2021-03" });
  });
  it("breaks a run on a missing month and returns null when nothing clears", () => {
    expect(overshoot(["a", "b", "c"], [3, null, 3], [1, 1, 1])).toEqual({ from: "a", to: "a", peakGapPp: 2, peakMonth: "a" });
    expect(overshoot(["a"], [1], [1])).toBeNull();
  });
  it("locates 2021–22 on the published history", () => {
    const o = overshoot(compare.months, compare.pce_yoy_pct, compare.official_pce_yoy_pct)!;
    expect(o.from.slice(0, 4)).toBe("2021");
    expect(o.to.slice(0, 4)).toBe("2022");
    expect(o.peakGapPp).toBeGreaterThan(2);
  });
});
