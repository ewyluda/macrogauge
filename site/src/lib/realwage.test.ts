import { describe, expect, it } from "vitest";
import { realRaisePct } from "./realwage";

describe("realRaisePct", () => {
  // original-site fixture: 4.0% raise vs 1.70% gauge -> +2.26% real
  it("matches the original's published example", () => {
    expect(realRaisePct(4.0, 1.7)).toBeCloseTo(2.26, 2);
  });
  // wage 3.5 vs gauge 1.7 -> +1.77 (the pipeline KPI's own formula)
  it("agrees with the pipeline real_wage_growth_pct formula", () => {
    expect(realRaisePct(3.5, 1.7)).toBeCloseTo(1.77, 2);
  });
  it("goes negative when inflation outruns the raise", () => {
    expect(realRaisePct(4.0, 4.25)).toBeCloseTo(-0.24, 2);
  });
  it("is 0 when raise equals inflation", () => {
    expect(realRaisePct(3.0, 3.0)).toBe(0);
  });
});
