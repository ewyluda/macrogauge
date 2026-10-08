import { describe, expect, it } from "vitest";
import { monthDiff, monthlyAverage, rebased, sinceRow, type MonthlySeries } from "./escalationSince";

const s = (months: string[], values: number[]): MonthlySeries =>
  ({ key: "k", label: "K", group: "g", source: "src", months, values });

describe("sinceRow", () => {
  const ppi = s(["2024-06", "2024-07", "2025-06", "2025-07", "2026-06"], [200, 202, 210, 211, 220.5]);

  it("measures base month to the series' own last month", () => {
    const r = sinceRow(ppi, "2024-06", 1_000_000)!;
    expect(r.lastMonth).toBe("2026-06");
    expect(r.months).toBe(24);
    expect(r.changePct).toBeCloseTo(10.25, 10);
    expect(r.escalated).toBeCloseTo(1_102_500, 6);
    // 1.1025 over two years is 5% a year
    expect(r.annualizedPct).toBeCloseTo(5, 10);
  });

  it("leaves the annualized rate out under twelve months", () => {
    expect(sinceRow(ppi, "2025-07", 1)!.annualizedPct).toBeNull();
  });

  it("is null when the base month has no level or is the last print", () => {
    expect(sinceRow(ppi, "2024-01", 1)).toBeNull();
    expect(sinceRow(ppi, "2026-06", 1)).toBeNull();
  });
});

describe("rebased", () => {
  it("sets the base month to 100 and drops what came before", () => {
    expect(rebased(s(["2024-01", "2024-02", "2024-03"], [50, 80, 88]), "2024-02"))
      .toEqual({ months: ["2024-02", "2024-03"], values: [100, 110] });
  });
});

describe("monthDiff", () => {
  it("counts calendar months across a year", () => {
    expect(monthDiff("2024-11", "2026-02")).toBe(15);
  });
});

describe("monthlyAverage", () => {
  it("averages each calendar month's days", () => {
    expect(monthlyAverage(["2026-01-30", "2026-01-31", "2026-02-01"], [100, 102, 104]))
      .toEqual({ months: ["2026-01", "2026-02"], values: [101, 104] });
  });
});
