import { describe, expect, it } from "vitest";
import { breadthRows, latestBreadth, trimmedMean, weightedMedian, type QuiltComponent } from "./breadth";

const cells = [
  { w: 0.5, v: 1 },
  { w: 0.3, v: 3 },
  { w: 0.2, v: 10 },
];

describe("weightedMedian / trimmedMean", () => {
  it("median is where cumulative weight crosses half", () => {
    expect(weightedMedian(cells)).toBe(1); // 0.5 reaches exactly half at v=1
    expect(weightedMedian([{ w: 0.4, v: 1 }, { w: 0.6, v: 5 }])).toBe(5);
    expect(weightedMedian([])).toBeNull();
  });
  it("trimmed mean drops weight from both tails, splitting the straddling cell", () => {
    // trim 0.16 each side: keep [0.16, 0.84] of cumulative weight
    // cell1 covers [0,0.5] → keeps 0.34 at v=1; cell2 [0.5,0.8] → 0.30 at 3;
    // cell3 [0.8,1.0] → keeps 0.04 at 10
    const expected = (0.34 * 1 + 0.3 * 3 + 0.04 * 10) / 0.68;
    expect(trimmedMean(cells)).toBeCloseTo(expected, 9);
    // zero trim = plain weighted mean
    expect(trimmedMean(cells, 0)).toBeCloseTo(0.5 * 1 + 0.3 * 3 + 0.2 * 10, 9);
  });
});

describe("breadthRows", () => {
  const comps: QuiltComponent[] = [
    { code: "a", label: "A", weight: 0.5, ours_yoy_pct: [1, 1, 1, 3], official_yoy_pct: [1, 1, 1, 1] },
    { code: "b", label: "B", weight: 0.3, ours_yoy_pct: [3, 3, 3, 2.5], official_yoy_pct: [3, 3, 3, 3] },
    { code: "c", label: "C", weight: 0.2, ours_yoy_pct: [10, 10, null, 10], official_yoy_pct: [10, 10, 10, 10] },
  ];
  const months = ["m1", "m2", "m3", "m4"];
  it("computes shares above 2% by count and weight, and acceleration vs 3 months earlier", () => {
    const rows = breadthRows(months, comps, "ours");
    expect(rows[0].aboveCountPct).toBeCloseTo((2 / 3) * 100, 9);
    expect(rows[0].aboveWeightPct).toBeCloseTo(50, 9);
    expect(rows[0].acceleratingWeightPct).toBeNull(); // no lag base yet
    expect(rows[2].weightedMedian).toBeNull(); // null cell → whole month null
    // m4 vs m1: a rose (0.5), b fell, c flat → 50% of weight accelerating
    expect(rows[3].acceleratingWeightPct).toBeCloseTo(50, 9);
    expect(rows[3].aboveWeightPct).toBeCloseTo(100, 9);
  });
  it("latestBreadth skips null months", () => {
    const rows = breadthRows(months.slice(0, 3), comps, "ours");
    expect(latestBreadth(rows)?.month).toBe("m2");
  });
});
