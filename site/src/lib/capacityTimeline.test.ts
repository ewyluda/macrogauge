import { describe, expect, it } from "vitest";
import { buildTimeline } from "./capacityTimeline";
import type { CapacityCompany } from "./types";

const co = (over: Partial<CapacityCompany>): CapacityCompany =>
  ({
    t: "AAA", n: "Aaa Corp", role: "neocloud", dupe: null, private: false,
    confidence: "filed", op: 100, con: 200, plan: 400, valuation_b: null,
    cap: null, px: null, priced_date: null, stale: false, ev: null,
    wmw: 300, ev_per_mw: null, pct_energized: null, coverage: null,
    econ: null, sites: [], src: [], tl: [], ...over,
  }) as CapacityCompany;

describe("buildTimeline", () => {
  it("mirrors the publisher: base from op, gaps filled from 2026Q2, cumulative adds", () => {
    const tl = buildTimeline([
      co({ tl: [["2026Q3", "S1", 50], ["2026Q3", "S2", 30], ["2027Q1", "S3", 20]] }),
    ]);
    expect(tl.base_mw).toBe(100);
    expect(tl.points[0]).toEqual({ q: "2026Q2", add_mw: 0, cum_mw: 100 });
    const q = Object.fromEntries(tl.points.map((p) => [p.q, p]));
    expect(q["2026Q3"]).toEqual({ q: "2026Q3", add_mw: 80, cum_mw: 180 });
    expect(q["2026Q4"].cum_mw).toBe(180); // gap quarter carries cumulative
    expect(q["2027Q1"].cum_mw).toBe(200);
    expect(tl.milestones["2026Q3"]).toEqual([["AAA", "S1", 50], ["AAA", "S2", 30]]);
  });

  it("aggregates only the rows passed in — search-filtered timelines work", () => {
    const a = co({ t: "AAA", op: 100, tl: [["2026Q3", "S1", 50]] });
    const b = co({ t: "BBB", op: 900, tl: [["2026Q4", "S9", 500]] });
    const both = buildTimeline([a, b]);
    expect(both.base_mw).toBe(1000);
    const only = buildTimeline([a]);
    expect(only.base_mw).toBe(100);
    expect(only.points.at(-1)!.cum_mw).toBe(150);
    expect(only.milestones["2026Q4"]).toBeUndefined();
  });

  it("excludes dupe rows and returns no points when nothing is dated", () => {
    const tl = buildTimeline([
      co({ t: "AAA", op: 100 }),
      co({ t: "BBB", op: 50, dupe: "tenant", tl: [["2026Q3", "S1", 50]] }),
    ]);
    expect(tl.base_mw).toBe(100);
    expect(tl.points).toEqual([]);
    expect(tl.milestones).toEqual({});
  });
});
