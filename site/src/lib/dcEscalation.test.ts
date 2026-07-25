import { describe, expect, it } from "vitest";
import { escalate, bridge } from "./dcEscalation";

// 2 years, index 100 -> 114.49 (a plausible DC Build path)
const MONTHS = ["2024-03", "2025-03", "2026-03"];
const INDEX = [100, 106.81, 114.49];

describe("escalate", () => {
  it("escalates a base cost by the index ratio", () => {
    const r = escalate(MONTHS, INDEX, "2024-03", 9_000_000)!;
    expect(r.baseMonth).toBe("2024-03");
    expect(r.endMonth).toBe("2026-03");
    expect(r.monthsElapsed).toBe(24);
    expect(r.pct).toBeCloseTo(14.49, 2);
    expect(r.escalatedCost).toBeCloseTo(10_304_100, 0);   // 9M * 1.1449
    expect(r.deltaCost).toBeCloseTo(1_304_100, 0);
    expect(r.annualizedPct).toBeCloseTo(7.0, 1);           // 1.1449^(12/24) - 1
  });

  it("uses the nearest month at or before the base", () => {
    const r = escalate(MONTHS, INDEX, "2024-11", 100)!;
    expect(r.baseMonth).toBe("2024-03");
    expect(r.escalatedCost).toBeCloseTo(114.49, 2);
  });

  it("returns null before the series starts", () => {
    expect(escalate(MONTHS, INDEX, "2024-02", 100)).toBeNull();
  });

  it("does not divide by zero when base is the last month", () => {
    const r = escalate(MONTHS, INDEX, "2026-03", 100)!;
    expect(r.monthsElapsed).toBe(0);
    expect(r.pct).toBeCloseTo(0, 6);
    expect(r.annualizedPct).toBe(0);
  });
});

// two components, weights summing to 1 — headline is their weighted mean
const B_MONTHS = ["2024-03", "2025-03", "2026-03"];
const B_COMPONENTS = [
  { code: "steel", label: "Steel mill products", group: "materials", weight: 0.6 },
  { code: "switchgear", label: "Switchgear & switchboard", group: "electrical", weight: 0.4 },
];
const B_INDEX = {
  steel: [100, 110, 125],
  switchgear: [100, 102, 105],
};
// headline: .6*100+.4*100 = 100 -> .6*125+.4*105 = 117
const B_HEADLINE = [100, 106.8, 117];

describe("bridge", () => {
  it("contributions sum exactly to the headline escalation", () => {
    const rows = bridge(B_MONTHS, B_INDEX, B_COMPONENTS, "2024-03", 1_000_000);
    const headline = escalate(B_MONTHS, B_HEADLINE, "2024-03", 1_000_000)!;
    const summed = rows.reduce((a, r) => a + r.contributionPp, 0);
    expect(summed).toBeCloseTo(headline.pct, 6);   // 17.00
  });

  it("computes per-component escalation and cost attribution", () => {
    const rows = bridge(B_MONTHS, B_INDEX, B_COMPONENTS, "2024-03", 1_000_000);
    const steel = rows.find((r) => r.code === "steel")!;
    expect(steel.componentPct).toBeCloseTo(25, 6);           // 100 -> 125
    expect(steel.contributionPp).toBeCloseTo(15, 6);         // 100 * .6 * 25 / 100
    expect(steel.contributionCost).toBeCloseTo(150_000, 0);  // 1M * .6 * 25 / 100
  });

  it("sorts by absolute contribution, largest first", () => {
    const rows = bridge(B_MONTHS, B_INDEX, B_COMPONENTS, "2024-03", 1_000_000);
    expect(rows.map((r) => r.code)).toEqual(["steel", "switchgear"]);
  });

  it("returns an empty array before the series starts", () => {
    expect(bridge(B_MONTHS, B_INDEX, B_COMPONENTS, "2024-02", 100)).toEqual([]);
  });
});
