import { describe, expect, it } from "vitest";
import replayJson from "../../public/data/replay.json";
import gaugeDaily from "../../public/data/gauge_daily.json";
import gaptable from "../../public/data/gaptable.json";
import { contributionGrid, contributionsAt, monthEnds, type ReplayComponent } from "./contribution";

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

describe("contribution — published artifact parity", () => {
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
    const ours = contributionsAt(replay.components, "ours", last);
    const bls = contributionsAt(replay.components, "bls", last);
    expect(ours && bls).toBeTruthy();
    for (const row of gaptable.rows) {
      const o = ours!.find((c) => c.code === row.component)!;
      const b = bls!.find((c) => c.code === row.component)!;
      if (row.contribution_pp == null) continue;
      expect(o.pp - b.pp, row.component).toBeCloseTo(row.contribution_pp, 1);
    }
  });
});
