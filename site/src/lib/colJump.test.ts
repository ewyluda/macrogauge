import { describe, expect, it } from "vitest";
import { colJump } from "./colJump";

const days = (n: number, start = "2026-08-01") =>
  Array.from({ length: n }, (_, i) => new Date(Date.parse(`${start}T00:00:00Z`) + i * 86400000).toISOString().slice(0, 10));

describe("colJump", () => {
  const d = days(70);
  const col = d.map((_, i) => (i < 9 ? 3 : 3 + (i - 9) * 0.05));     // 3.0 -> 6.0
  const gauge = d.map(() => 2.9);
  it("states the rise, the gauge beside it and the rate now vs a year ago", () => {
    const j = colJump(d, col, gauge, { now: 7.59, nowAsOf: "2026-10-08", yearAgo: 6.34 })!;
    expect(j.from).toBe("2026-08-10");
    expect(j.colTo).toBeCloseTo(6, 10);
    expect(j.text).toBe("Since 2026-08-10, cost of living has jumped from 3.0% to 6.0% while the gauge went from 2.9% to 2.9%. The 30-year mortgage rate is 7.6% (2026-10-08), against 6.3% a year earlier, and the buyer's payment rides the rate; rental-equivalence shelter does not.");
  });
  it("is null when the rise is small", () => {
    expect(colJump(d, d.map(() => 3), gauge, { now: 7, nowAsOf: "x", yearAgo: null })).toBeNull();
  });
});
