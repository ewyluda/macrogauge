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
    expect(s.baseNote).toBe("Much of the hump is base effect. The climb to Dec 2026 drops Oct 2025–Dec 2025 out of the comparison, when the gauge fell 0.8% (about +0.8pp of the +1.4pp climb); the fall to May 2027 drops Jan 2026–May 2026, when it rose 3.6% (about −3.7pp of the −3.1pp fall).");
  });

  it("claims a base effect only when the year-ago levels carry most of both legs", () => {
    const hump = path([2.5, 3.0, 2.5]); // from 2.0%: +1.0pp climb, −0.5pp fall
    const note = (m: Record<string, number>) => outlookShape("2026-09", 2.0, hump, m).baseNote!;
    // flat year-ago levels explain none of it
    const flat = note({ "2025-09": 100, "2025-11": 100, "2025-12": 100 });
    expect(flat).not.toContain("base effect");
    expect(flat).toContain("when the gauge rose 0.0% (about 0.0pp of the +1.0pp climb)");
    // year-ago levels moving the same way as the hump work against it
    expect(note({ "2025-09": 100, "2025-11": 101, "2025-12": 100 })).not.toContain("base effect");
    // a small base effect: under half of the climb
    expect(note({ "2025-09": 100, "2025-11": 99.7, "2025-12": 100.2 })).not.toContain("base effect");
    // dominant: the year-ago dip and rebound carry both legs
    expect(note({ "2025-09": 100, "2025-11": 99.2, "2025-12": 99.8 })).toMatch(/^Much of the hump is base effect\./);
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
