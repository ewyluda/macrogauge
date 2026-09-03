import { describe, expect, it } from "vitest";
import grades from "../../public/data/dc_grades.json";
import type { DcGrades } from "./types";
import { anchorBases, anchorPoints, anchorStats } from "./dcAnchors";

const data = grades as unknown as DcGrades;

describe("anchorPoints / anchorStats", () => {
  it("reproduce the published legs.*.grades from the anchors", () => {
    // Every (leg, basis, horizon) the pipeline graded must be recomputable
    // from the anchor rows to 2dp — the scatter caption and the paired table
    // are then two views of one number, not two numbers.
    let checked = 0;
    for (const [legKey, leg] of Object.entries(data.legs)) {
      for (const [basis, byH] of Object.entries(leg.grades)) {
        for (const [hk, stat] of Object.entries(byH)) {
          if (!stat) continue;
          const h = Number(hk.slice(1));
          const s = anchorStats(anchorPoints(data.anchors, legKey, basis, h));
          expect(s, `${legKey}/${basis}/${hk}`).not.toBeNull();
          expect(s!.n).toBe(stat.n);
          expect(s!.maePp).toBeCloseTo(stat.mae_pp, 1);
          expect(s!.biasPp).toBeCloseTo(stat.bias_pp, 1);
          expect(s!.shortfallRatePct).toBeCloseTo(stat.shortfall_rate_pct, 0);
          checked++;
        }
      }
    }
    expect(checked).toBeGreaterThan(5);
  });

  it("drops anchors with a null base or realized value", () => {
    const pts = anchorPoints(
      [
        { m: "2020-01", leg: "strict", bases: { a: 1 }, realized: { h12: null } },
        { m: "2020-02", leg: "strict", bases: { a: null }, realized: { h12: 2 } },
        { m: "2020-03", leg: "strict", bases: { a: 1 }, realized: { h12: 3 } },
        { m: "2020-04", leg: "extended", bases: { a: 1 }, realized: { h12: 3 } },
      ],
      "strict", "a", 12,
    );
    expect(pts).toEqual([{ m: "2020-03", expected: 1, realized: 3, shortfallPp: 2 }]);
    expect(anchorStats([])).toBeNull();
  });

  it("lists the bases a leg actually carries", () => {
    expect(anchorBases(data.anchors, "strict").length).toBeGreaterThan(0);
    expect(anchorBases([], "strict")).toEqual([]);
  });
});
