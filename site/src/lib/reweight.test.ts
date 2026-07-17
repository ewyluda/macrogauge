import { describe, expect, it } from "vitest";
import replay from "../../public/data/replay.json";
import compare from "../../public/data/compare.json";
import {
  DEFAULT_ANSWERS,
  applyAnswers,
  contributions,
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
    const comps = replay.components as {
      code: string; label: string; weight: number; yoy: (number | null)[];
    }[];
    const w = renormalize(
      Object.fromEntries(comps.map((c) => [c.code, c.weight]))
    );
    const lastInMonth = new Map<string, number>();
    (replay.dates as string[]).forEach((d, i) => lastInMonth.set(d.slice(0, 7), i));
    let checked = 0;
    compare.months.forEach((m: string, mi: number) => {
      const g = compare.gauge_yoy_pct[mi];
      const di = lastInMonth.get(m.slice(0, 7)) ?? -1;
      if (g === null || di === -1) return;
      const mine = weightedYoY(comps, w, di);
      if (mine === null) return;
      expect(Math.abs(mine - g)).toBeLessThanOrEqual(0.02);
      checked++;
    });
    expect(checked).toBeGreaterThan(90); // ~100 months of real coverage
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
