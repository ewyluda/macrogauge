import { weightAt } from "./contribution";
import { describe, expect, it } from "vitest";
import replay from "../../public/data/replay.json";
import compare from "../../public/data/compare.json";
import {
  DEFAULT_ANSWERS,
  applyAnswers,
  contributions,
  monthlyGap,
  personalWeights,
  renormalize,
  weightedYoY,
  type Answers,
} from "./reweight";

const NEUTRAL: Answers = {
  housing: "own_mortgage", // still reallocates; neutrality is tested via renormalize path
  driving: "average",
  eating: "average",
  healthcare: "average",
  tuition: "no",
};

const COMPS = [
  { code: "a", label: "A", weight: 0.6, yoy: [2.0, 3.0] },
  { code: "b", label: "B", weight: 0.4, yoy: [5.0, null] },
];

describe("weightedYoY", () => {
  it("hand-computed weighted own-obs YoY", () => {
    // 0.6*2.0 + 0.4*5.0 = 3.2
    expect(weightedYoY(COMPS, { a: 0.6, b: 0.4 }, 0)).toBeCloseTo(3.2, 10);
  });
  it("null if any component is null at that date", () => {
    expect(weightedYoY(COMPS, { a: 0.6, b: 0.4 }, 1)).toBeNull();
  });
});

describe("applyAnswers", () => {
  const base = [
    { code: "shelter_owned", label: "", weight: 0.265, yoy: [] },
    { code: "shelter_rent", label: "", weight: 0.075, yoy: [] },
    { code: "fuel", label: "", weight: 0.03, yoy: [] },
    { code: "used_vehicles", label: "", weight: 0.021, yoy: [] },
    { code: "new_vehicles", label: "", weight: 0.036, yoy: [] },
    { code: "food_away", label: "", weight: 0.057, yoy: [] },
    { code: "food_home", label: "", weight: 0.082, yoy: [] },
    { code: "medical", label: "", weight: 0.081, yoy: [] },
    { code: "education_comm", label: "", weight: 0.055, yoy: [] },
  ];
  it("renter: full shelter weight to rent", () => {
    const w = applyAnswers(base, { ...NEUTRAL, housing: "rent" });
    expect(w.shelter_rent).toBeCloseTo(0.34, 10);
    expect(w.shelter_owned).toBe(0);
  });
  it("paid-off owner keeps 35% of ownership costs", () => {
    const w = applyAnswers(base, { ...NEUTRAL, housing: "own_paidoff" });
    expect(w.shelter_owned).toBeCloseTo(0.34 * 0.35, 10);
    expect(w.shelter_rent).toBe(0);
  });
  it("don't-drive zeroes fuel and both vehicle components", () => {
    const w = applyAnswers(base, { ...NEUTRAL, driving: "none" });
    expect(w.fuel).toBe(0);
    expect(w.used_vehicles).toBe(0);
    expect(w.new_vehicles).toBe(0);
  });
  it("tuition-no scales education_comm to 0.6x", () => {
    const w = applyAnswers(base, NEUTRAL);
    expect(w.education_comm).toBeCloseTo(0.055 * 0.6, 10);
  });
});

describe("renormalize", () => {
  it("sums to 1 after zeroing", () => {
    const w = renormalize({ a: 0.5, b: 0, c: 0.25 });
    expect(w.a + w.b + w.c).toBeCloseTo(1, 10);
    expect(w.a).toBeCloseTo(2 / 3, 10);
  });
});

describe("engine invariant (spec §6, verified against live data)", () => {
  it("base weights reproduce published gauge YoY at every compare month", () => {
    // With the published weights untouched (no answers applied), the client's
    // weighted own-obs YoY IS the engine's Option A headline. Tolerance 0.02:
    // component yoy values are rounded to 2dp in replay.json (±0.005 weighted)
    // and compare rounds again (±0.005). compare.json samples each month at
    // its LAST grid date (quilt's convention since the 2026-07-16 audit), so
    // the invariant is evaluated there too.
    // Since 2026-09-29 the engine weights each date by relative importance
    // price-updated to that date's YoY base month (replay weights_by_month);
    // the fixed `weight` is only the latest month's. Rebuild with the weights
    // in force on each date — the same rule the site's contribution math uses.
    const comps = replay.components as {
      code: string; label: string; weight: number; yoy: (number | null)[];
      weights_by_month?: Record<string, number>;
    }[];
    const lastInMonth = new Map<string, number>();
    (replay.dates as string[]).forEach((d, i) => lastInMonth.set(d.slice(0, 7), i));
    let checked = 0;
    compare.months.forEach((m: string, mi: number) => {
      const g = compare.gauge_yoy_pct[mi];
      const di = lastInMonth.get(m.slice(0, 7)) ?? -1;
      if (g === null || di === -1) return;
      const date = (replay.dates as string[])[di];
      const w = renormalize(Object.fromEntries(comps.map((c) => [c.code, weightAt(c, date)])));
      const mine = weightedYoY(comps, w, di);
      if (mine === null) return;
      expect(Math.abs(mine - g)).toBeLessThanOrEqual(0.02);
      checked++;
    });
    expect(checked).toBeGreaterThan(90); // ~100 months of real coverage
  });
});

describe("overrides", () => {
  const OVR_COMPS = [
    { code: "electricity", label: "Electricity", weight: 0.5, yoy: [5.0] },
    { code: "fuel", label: "Gasoline", weight: 0.5, yoy: [10.0] },
  ];
  const OVR_W = { electricity: 0.5, fuel: 0.5 };

  it("override replaces a component's YoY at the index", () => {
    // national: 0.5*5 + 0.5*10 = 7.5
    expect(weightedYoY(OVR_COMPS, OVR_W, 0)).toBe(7.5);
    // override electricity -> 9: 0.5*9 + 0.5*10 = 9.5
    expect(weightedYoY(OVR_COMPS, OVR_W, 0, { electricity: 9 })).toBe(9.5);
  });

  it("override with no matching code is a no-op", () => {
    expect(weightedYoY(OVR_COMPS, OVR_W, 0, { nope: 3 })).toBe(7.5);
  });

  it("override feeds through to contributions", () => {
    const c = contributions(OVR_COMPS, OVR_W, 0, { electricity: 9 }).find((x) => x.code === "electricity")!;
    expect(c.yoyPct).toBe(9);
    expect(c.pp).toBeCloseTo(4.5, 6); // 0.5 * 9
  });

  it("a zero override is honored (not treated as missing)", () => {
    expect(weightedYoY(OVR_COMPS, OVR_W, 0, { electricity: 0 })).toBe(5.0); // 0.5*0 + 0.5*10
  });
});

describe("contributions", () => {
  it("sums to the personal rate (Option A property)", () => {
    const w = { a: 0.6, b: 0.4 };
    const list = contributions(COMPS, w, 0);
    const total = list.reduce((s, c) => s + c.pp, 0);
    expect(total).toBeCloseTo(weightedYoY(COMPS, w, 0)!, 10);
    expect(list[0].code).toBe("b"); // 0.4*5=2.0 > 0.6*2=1.2
  });

  it("ranks by magnitude so a big deflating driver tops the list", () => {
    // deflator: -3.0pp of drag vs +1.2pp — the signed sort dropped it LAST
    const comps = [
      { code: "a", label: "A", weight: 0.6, yoy: [2] },
      { code: "d", label: "D", weight: 0.6, yoy: [-5] },
    ];
    const list = contributions(comps, { a: 0.6, d: 0.6 }, 0);
    expect(list[0].code).toBe("d");
    expect(list[0].pp).toBeCloseTo(-3.0, 10);
  });
});

describe("personalWeights — time-varying weights", () => {
  const comps = [
    { code: "food_home", label: "F", weight: 0.5, yoy: [1], weights_by_month: { "2018-01": 0.2 } },
    { code: "apparel", label: "A", weight: 0.5, yoy: [1], weights_by_month: { "2018-01": 0.8 } },
  ];
  it("reweights the shares in force on the date, renormalized", () => {
    const w = personalWeights(comps, DEFAULT_ANSWERS, "2019-01-31");
    expect(w.food_home).toBeCloseTo(0.2, 12);
    expect(w.apparel).toBeCloseTo(0.8, 12);
  });
  it("falls back to the fixed weights without a date or month entry", () => {
    expect(personalWeights(comps, DEFAULT_ANSWERS).food_home).toBeCloseTo(0.5, 12);
    expect(personalWeights(comps, DEFAULT_ANSWERS, "2020-06-30").food_home).toBeCloseTo(0.5, 12);
  });
});

describe("monthlyGap — your rate minus everyone's (/my-inflation chart)", () => {
  it("is exactly 0 every month when the answers change no weight", () => {
    // no component the answers touch: the personal basket IS everyone's, so
    // any residual would be sampling artefact. Day-1 and month-end YoYs
    // differ, and weights vary by month, to catch a mixed sampling.
    const dates = ["2019-01-01", "2019-01-31", "2019-02-01", "2019-02-28"];
    const comps = [
      { code: "a", label: "A", weight: 0.5, yoy: [9, 1, 9, 2], weights_by_month: { "2018-01": 0.3, "2018-02": 0.7 } },
      { code: "b", label: "B", weight: 0.5, yoy: [-9, 3, -9, 4] },
    ];
    expect(monthlyGap(comps, dates, ["2019-01-01", "2019-02-01"], DEFAULT_ANSWERS))
      .toEqual([["2019-01-01", 0], ["2019-02-01", 0]]);
  });

  it("samples each month at its last daily date, like compare.json", () => {
    const dates = ["2019-01-01", "2019-01-31"];
    const comps = [
      { code: "food_away", label: "F", weight: 0.5, yoy: [100, 4] },
      { code: "food_home", label: "H", weight: 0.5, yoy: [100, 2] },
    ];
    // eat out a lot: food_away ×2, food_home ×0.7 → 2/2.7 vs 0.7/2.7
    const mine = (2 * 4 + 0.7 * 2) / 2.7;
    const gap = monthlyGap(comps, dates, ["2019-01-01"], { ...DEFAULT_ANSWERS, eating: "out" })[0][1]!;
    expect(gap).toBeCloseTo(Math.round((mine - 3) * 100) / 100, 10);
  });

  it("default answers sit at ~0 every month on the published data", () => {
    // Before the fix the chart subtracted compare.json's gauge from a series
    // rebuilt off replay at a different day of the month: ±1.3pp of pure
    // artefact. What remains is the defaults' one real reweight (tuition
    // "no" scales education & comm ×0.6; renting moves no weight while both
    // shelter components ride the market-rent blend): ≤0.30pp, 2022.
    const gaps = monthlyGap(
      replay.components as Parameters<typeof monthlyGap>[0],
      replay.dates as string[],
      compare.months,
      DEFAULT_ANSWERS
    ).map(([, g]) => g).filter((g): g is number => g !== null);
    expect(gaps.length).toBeGreaterThan(90);
    for (const g of gaps) expect(Math.abs(g)).toBeLessThanOrEqual(0.35);
  });
});
