import { describe, expect, it } from "vitest";
import { BASES, bases, lastCompleteMonth } from "./dcContingency";

// A 4-year monthly grid compounding at exactly 5%/yr from 100.
// 2022-01 .. 2026-01 inclusive = 49 months.
const MONTHS: string[] = [];
const INDEX: number[] = [];
for (let k = 0; k <= 48; k++) {
  const y = 2022 + Math.floor(k / 12);
  const mo = (k % 12) + 1;
  MONTHS.push(`${y}-${String(mo).padStart(2, "0")}`);
  INDEX.push(100 * Math.pow(1.05, k / 12));
}

describe("lastCompleteMonth", () => {
  it("takes the minimum component last_obs, not the last grid month", () => {
    // copper is daily and runs ahead; the PPIs stop at June
    expect(
      lastCompleteMonth(MONTHS, ["2026-01-20", "2025-12-01", "2025-12-01"])
    ).toBe("2025-12");
  });

  it("clamps to a month that actually exists in the grid", () => {
    expect(lastCompleteMonth(MONTHS, ["2030-06-01"])).toBe("2026-01");
  });

  it("returns null when the cap predates the grid", () => {
    expect(lastCompleteMonth(MONTHS, ["2019-01-01"])).toBeNull();
  });

  it("returns null on empty input", () => {
    expect(lastCompleteMonth([], ["2025-01-01"])).toBeNull();
    expect(lastCompleteMonth(MONTHS, [])).toBeNull();
  });
});

describe("bases", () => {
  it("computes the annualized ratio, not a median of YoY prints", () => {
    const out = bases(MONTHS, INDEX, "2026-01");
    const momentum = out.find((b) => b.key === "momentum")!;
    expect(momentum.months).toBe(12);
    expect(momentum.annualizedPct).toBeCloseTo(5.0, 6);
    expect(momentum.cumulativePct).toBeCloseTo(5.0, 6);
  });

  it("annualizes a multi-year window correctly", () => {
    const out = bases(MONTHS, INDEX, "2026-01");
    const t3 = out.find((b) => b.key === "trailing3y")!;
    expect(t3.months).toBe(36);
    expect(t3.annualizedPct).toBeCloseTo(5.0, 6);
    expect(t3.cumulativePct).toBeCloseTo(15.7625, 3); // 1.05^3 - 1
  });

  it("runs long-run from the first month in the sample", () => {
    const out = bases(MONTHS, INDEX, "2026-01");
    const lr = out.find((b) => b.key === "longrun")!;
    expect(lr.startMonth).toBe("2022-01");
    expect(lr.endMonth).toBe("2026-01");
    expect(lr.months).toBe(48);
    expect(lr.annualizedPct).toBeCloseTo(5.0, 6);
  });

  it("omits absolute bases whose window predates the sample", () => {
    // This grid starts 2022-01. Both absolute windows begin before it
    // (2008-12 and 2021-04), so monthIndexAtOrBefore returns -1 for each
    // start and both are omitted rather than silently clamped forward.
    const keys = bases(MONTHS, INDEX, "2026-01").map((b) => b.key);
    expect(keys).not.toContain("gfc");
    expect(keys).not.toContain("covid");
    expect(keys).toEqual(["longrun", "trailing3y", "momentum"]);
  });

  it("omits a rolling basis whose lookback predates the sample", () => {
    const shortMonths = MONTHS.slice(0, 6);
    const shortIndex = INDEX.slice(0, 6);
    const keys = bases(shortMonths, shortIndex, "2022-06").map((b) => b.key);
    expect(keys).not.toContain("trailing3y");
    expect(keys).not.toContain("momentum");
  });

  it("anchors on the month given, not the end of the grid", () => {
    const out = bases(MONTHS, INDEX, "2025-01");
    expect(out.every((b) => b.endMonth <= "2025-01")).toBe(true);
  });

  it("emits nothing rather than a zero-length window at the sample start", () => {
    // anchor == months[0]: longrun's window would be 2022-01 -> 2022-01 (j <= i),
    // both rolling lookbacks go negative, both absolutes predate the grid.
    const out = bases(MONTHS, INDEX, "2022-01");
    expect(out).toEqual([]);
  });

  it("declares two absolute bases whose windows are fixed constants", () => {
    const abs = BASES.filter((b) => b.kind === "absolute");
    expect(abs.map((b) => b.key).sort()).toEqual(["covid", "gfc"]);
    expect(abs.every((b) => !!b.startMonth && !!b.endMonth)).toBe(true);
  });

  // Regression guard for the "must not move between publishes" claim in
  // dcContingency.ts's BASES doc comment. The test above only checks shape
  // (kind, truthy bounds); it would still pass if a window's literal month
  // were typo'd. Pin the four literal strings so a silent edit to either
  // absolute window fails here.
  it("pins the two absolute windows to their exact literal months", () => {
    const gfc = BASES.find((b) => b.key === "gfc")!;
    expect(gfc.startMonth).toBe("2008-12");
    expect(gfc.endMonth).toBe("2011-12");

    const covid = BASES.find((b) => b.key === "covid")!;
    expect(covid.startMonth).toBe("2021-04");
    expect(covid.endMonth).toBe("2023-12");
  });
});
