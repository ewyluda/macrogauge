import { describe, expect, it } from "vitest";
import { annualizedChange, latestOf, rateSeries } from "./momentum";

describe("annualizedChange", () => {
  it("compounds a k-day change to a year", () => {
    // 91 days at exactly +1% → (1.01)^(365/91) − 1
    const index = Array.from({ length: 92 }, (_, i) => (i === 91 ? 101 : 100));
    const out = annualizedChange(index, 91);
    expect(out.slice(0, 91).every((v) => v === null)).toBe(true);
    expect(out[91]).toBeCloseTo((Math.pow(1.01, 365 / 91) - 1) * 100, 6);
  });
  it("nulls through missing or zero bases", () => {
    expect(annualizedChange([null, 100, 100], 1)).toEqual([null, null, 0]);
    expect(annualizedChange([0, 100], 1)).toEqual([null, null]);
  });
});

describe("rateSeries / latestOf", () => {
  it("returns the published yoy untouched in yoy mode", () => {
    const yoy = [1, 2, null];
    expect(rateSeries("yoy", yoy, [1, 2, 3])).toBe(yoy);
    expect(rateSeries("ann3", yoy, undefined)).toBe(yoy);
  });
  it("latestOf skips trailing nulls", () => {
    expect(latestOf(["a", "b", "c"], [1, 2, null])).toEqual({ date: "b", value: 2 });
    expect(latestOf(["a"], [null])).toBeNull();
  });
});
