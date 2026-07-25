import { describe, expect, it } from "vitest";
import { escalate } from "./dcEscalation";

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
