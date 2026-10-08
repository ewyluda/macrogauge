import { describe, expect, it } from "vitest";
import { outlookShape } from "./outlookHeadline";

const path = (ys: number[], start = 10) =>
  ys.map((v, i) => ({ month: `${2026 + Math.floor((start - 1 + i) / 12)}-${String(((start - 1 + i) % 12) + 1).padStart(2, "0")}`, central_yoy_pct: v }));
// the published 2026-10-08 path: origin Sep 2026 at 3.03%
const PUBLISHED = path([3.45, 4.01, 4.46, 4.05, 3.63, 2.31, 1.87, 1.39, 1.97, 1.89, 1.9, 1.75]);
const MONTHLY = { "2025-09": 100, "2025-12": 99.2, "2026-05": 102.8 };

describe("outlookShape", () => {
  it("titles a hump with its peak and end, and names the year-ago legs it replaces", () => {
    const s = outlookShape("2026-09", 3.03, PUBLISHED, MONTHLY);
    expect(s.title).toBe("Inflation climbs to a 4.5% peak in Dec 2026, then eases to 1.8% by Sep 2027");
    expect(s.peak).toEqual({ month: "2026-12", yoy: 4.46 });
    expect(s.baseNote).toBe("Much of the hump is base effect. The climb to Dec 2026 drops Oct 2025–Dec 2025 out of the comparison, when the gauge fell 0.8%; the fall to May 2027 drops Jan 2026–May 2026, when it rose 3.6%.");
  });

  it("says eases or rises without a hump, and has no annotation", () => {
    expect(outlookShape("2026-09", 3.0, path([2.9, 2.6, 2.2]), {})).toEqual(
      { title: "Inflation eases from 3.0% to 2.2% by Dec 2026", peak: null, baseNote: null });
    expect(outlookShape("2026-09", 2.0, path([2.1, 2.3, 2.6]), {}).title).toBe("Inflation rises from 2.0% to 2.6% by Dec 2026");
  });

  it("drops the base note when the year-ago levels are missing", () => {
    expect(outlookShape("2026-09", 3.03, PUBLISHED, {}).baseNote).toBeNull();
  });
});
