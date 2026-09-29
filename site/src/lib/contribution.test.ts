import { describe, expect, it } from "vitest";
import replayJson from "../../public/data/replay.json";
import gaugeDaily from "../../public/data/gauge_daily.json";
import gaptable from "../../public/data/gaptable.json";
import { baseMonth, contributionGrid, contributionsAt, monthEnds, weightAt, type ReplayComponent } from "./contribution";

const replay = replayJson as { dates: string[]; components: ReplayComponent[] };

describe("contribution — synthetic", () => {
  const comps: ReplayComponent[] = [
    { code: "a", label: "A", weight: 0.4, yoy: [0, 1], bls_yoy: [0, 0] },
    { code: "b", label: "B", weight: 0.6, yoy: [10, null], bls_yoy: [5, 5] },
  ];
  it("is weight × own YoY, null when any component is null", () => {
    expect(contributionsAt(comps, "ours", 0)).toEqual([{ code: "a", pp: 0 }, { code: "b", pp: 6 }]);
    expect(contributionsAt(comps, "ours", 1)).toBeNull();
    expect(contributionsAt(comps, "bls", 0)![1].pp).toBeCloseTo(3, 9);
  });
  it("renormalizes when weights do not sum to one", () => {
    const half = comps.map((c) => ({ ...c, weight: c.weight / 2 }));
    expect(contributionsAt(half, "ours", 0)![1].pp).toBeCloseTo(6, 9);
  });
  it("gap mode is ours minus BLS and months are month-ends", () => {
    const dates = ["2020-01-30", "2020-01-31"];
    const g = contributionGrid(dates, comps, "gap");
    expect(g.months).toEqual(["2020-01"]);
    expect(g.total).toEqual([null]); // position 1 has a null ours YoY
    const g0 = contributionGrid(["2020-01-31", "2020-02-01"], comps, "gap", 1);
    expect(g0.months).toEqual(["2020-02"]);
    expect(monthEnds(["2020-01-01", "2020-01-02", "2020-02-01"])).toEqual([{ month: "2020-01", i: 1 }, { month: "2020-02", i: 2 }]);
  });
});

describe("contribution — time-varying weights (backlog #4)", () => {
  it("baseMonth mirrors the engine's aggregate.base_month (365 days back)", () => {
    expect(baseMonth("2019-08-31")).toBe("2018-08");
    expect(baseMonth("2019-08-01")).toBe("2018-08");
    expect(baseMonth("2024-02-29")).toBe("2023-03"); // leap edge, like the 365d YoY
    expect(baseMonth("2021-03-01")).toBe("2020-03");
  });
  const comps: ReplayComponent[] = [
    { code: "a", label: "A", weight: 0.9, yoy: [1, 1], bls_yoy: [0, 0],
      weights_by_month: { "2018-01": 0.5, "2018-02": 0.25 } },
    { code: "b", label: "B", weight: 0.1, yoy: [3, 3], bls_yoy: [0, 0],
      weights_by_month: { "2018-01": 0.5, "2018-02": 0.75 } },
  ];
  const dates = ["2019-01-31", "2019-02-28"];
  it("uses the weight in force at each date, not the fixed weight", () => {
    expect(weightAt(comps[0], "2019-01-31")).toBe(0.5);
    expect(weightAt(comps[0], "2019-02-28")).toBe(0.25);
    expect(weightAt(comps[0])).toBe(0.9);
    expect(weightAt(comps[0], "2019-05-01")).toBe(0.9); // month absent → fixed
    const s0 = contributionsAt(comps, "ours", 0, dates[0])!.reduce((s, c) => s + c.pp, 0);
    const s1 = contributionsAt(comps, "ours", 1, dates[1])!.reduce((s, c) => s + c.pp, 0);
    expect(s0).toBeCloseTo(2.0, 12); // 0.5·1 + 0.5·3
    expect(s1).toBeCloseTo(2.5, 12); // 0.25·1 + 0.75·3
    // without a date the fixed weights still apply (old call sites)
    expect(contributionsAt(comps, "ours", 1)!.reduce((s, c) => s + c.pp, 0)).toBeCloseTo(1.2, 12);
  });
  it("the month-end grid sums to the per-date headline at every month", () => {
    const g = contributionGrid(dates, comps, "ours");
    expect(g.months).toEqual(["2019-01", "2019-02"]);
    expect(g.total[0]).toBeCloseTo(2.0, 12);
    expect(g.total[1]).toBeCloseTo(2.5, 12);
  });
});

describe("contribution — published artifact parity", () => {
  it("Σ contributions (per-date weights) equals the published headline at EVERY date", () => {
    const g = gaugeDaily.variants.gauge;
    let checked = 0;
    replay.dates.forEach((d, i) => {
      const pub = g.yoy_pct[i];
      const parts = contributionsAt(replay.components, "ours", i, d);
      if (pub == null || parts == null) return;
      expect(parts.reduce((s, c) => s + c.pp, 0), d).toBeCloseTo(pub, 1);
      checked++;
    });
    expect(checked).toBeGreaterThan(2000);
  });
  it("Σ contributions equals gauge_daily's published headline YoY at every month end", () => {
    const g = gaugeDaily.variants.gauge;
    expect(g.dates).toEqual(replay.dates);
    const grid = contributionGrid(replay.dates, replay.components, "ours");
    const ends = monthEnds(replay.dates);
    let checked = 0;
    ends.forEach((e, k) => {
      const pub = g.yoy_pct[e.i];
      const sum = grid.total[k];
      if (pub == null || sum == null) return;
      expect(sum, e.month).toBeCloseTo(pub, 1); // both sides are 2dp-rounded
      checked++;
    });
    expect(checked).toBeGreaterThan(60);
  });
  it("matches gaptable.json's per-component contribution at the latest date", () => {
    const last = replay.dates.length - 1;
    const ours = contributionsAt(replay.components, "ours", last, replay.dates[last]);
    const bls = contributionsAt(replay.components, "bls", last, replay.dates[last]);
    expect(ours && bls).toBeTruthy();
    for (const row of gaptable.rows) {
      const o = ours!.find((c) => c.code === row.component)!;
      const b = bls!.find((c) => c.code === row.component)!;
      if (row.contribution_pp == null) continue;
      expect(o.pp - b.pp, row.component).toBeCloseTo(row.contribution_pp, 1);
    }
  });
});
