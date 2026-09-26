import { describe, expect, it } from "vitest";
import { annualizedAt, annualizedChange, lastChange, latestOf, monthsBefore, rateSeries } from "./momentum";

/** Contiguous daily ISO grid [from, to]. */
function dailyGrid(from: string, to: string): string[] {
  const out: string[] = [];
  for (let t = Date.parse(`${from}T00:00:00Z`); t <= Date.parse(`${to}T00:00:00Z`); t += 86_400_000) {
    out.push(new Date(t).toISOString().slice(0, 10));
  }
  return out;
}

/** A monthly component forward-filled onto the daily grid: each 1st-of-month
 *  print holds until the next. `level(month)` gives the print for "YYYY-MM". */
function monthlyStep(dates: string[], level: (ym: string) => number): number[] {
  return dates.map((d) => level(d.slice(0, 7)));
}

describe("monthsBefore", () => {
  it("keeps the day-of-month and clamps to month end", () => {
    expect(monthsBefore("2026-08-01", 6)).toBe("2026-02-01");
    expect(monthsBefore("2026-08-01", 3)).toBe("2026-05-01");
    expect(monthsBefore("2026-05-31", 3)).toBe("2026-02-28");
    expect(monthsBefore("2024-08-31", 6)).toBe("2024-02-29");
    expect(monthsBefore("2026-02-15", 3)).toBe("2025-11-15");
  });
});

describe("annualizedChange — calendar-month lookback", () => {
  const dates = dailyGrid("2025-06-01", "2026-09-25");
  // Jan 2026 = 100, Feb = 105, then +1% a month through Aug. A 182-day
  // lookback from 2026-08-01 lands on 2026-01-31 (January's print) and would
  // report a 7-month change; the calendar lookback must land on Feb-1.
  const LEVEL: Record<string, number> = {
    "2026-01": 100, "2026-02": 105, "2026-03": 106, "2026-04": 107, "2026-05": 108,
    "2026-06": 109, "2026-07": 110, "2026-08": 111, "2026-09": 111,
  };
  const index = monthlyStep(dates, (ym) => LEVEL[ym] ?? 100);
  const own = lastChange(index);

  it("reads the component's own last obs at 2026-08-01", () => {
    expect(dates[own]).toBe("2026-08-01");
  });
  it("6m at Aug-1 uses the Feb-1 print as base, annualized with 12/6", () => {
    const a6 = annualizedAt(index, dates, 6, own);
    expect(a6).toBeCloseTo((Math.pow(111 / 105, 2) - 1) * 100, 9);
    // not the 7-month change against January's 100
    expect(a6).not.toBeCloseTo((Math.pow(111 / 100, 2) - 1) * 100, 3);
  });
  it("3m at Aug-1 uses the May-1 print as base, annualized with 12/3", () => {
    expect(annualizedAt(index, dates, 3, own)).toBeCloseTo((Math.pow(111 / 108, 4) - 1) * 100, 9);
  });
  it("the chart series agrees with the point read at every date", () => {
    const series = annualizedChange(index, dates, 6);
    expect(series[own]).toBe(annualizedAt(index, dates, 6, own));
    // mid-month: 2026-08-15 vs 2026-02-15 — still Aug's vs Feb's print
    const i = dates.indexOf("2026-08-15");
    expect(series[i]).toBeCloseTo((Math.pow(111 / 105, 2) - 1) * 100, 9);
  });
  it("nulls where the base date precedes the grid", () => {
    const series = annualizedChange(index, dates, 6);
    expect(series[dates.indexOf("2025-11-30")]).toBeNull();
    expect(series[dates.indexOf("2025-12-01")]).not.toBeNull();
  });
});

describe("annualizedChange — daily series sanity", () => {
  it("a constant daily growth rate annualizes to itself over 3m and 6m", () => {
    const dates = dailyGrid("2025-01-01", "2026-06-30");
    // 5%/yr continuous-ish daily compounding on a 365-day year
    const g = Math.pow(1.05, 1 / 365);
    const index = dates.map((_, i) => 100 * Math.pow(g, i));
    const i = dates.length - 1; // 2026-06-30
    const a3 = annualizedAt(index, dates, 3, i)!; // base 2026-03-30 — 92 days
    const a6 = annualizedAt(index, dates, 6, i)!; // base 2025-12-30 — 182 days
    // calendar months are not exactly a quarter/half of 365 days, so the
    // annualized rate sits within a few tenths of the true 5%
    expect(a3).toBeGreaterThan(4.9);
    expect(a3).toBeLessThan(5.3);
    expect(a6).toBeGreaterThan(4.9);
    expect(a6).toBeLessThan(5.1);
  });
  it("nulls through missing or non-positive bases and ends", () => {
    const dates = dailyGrid("2026-01-01", "2026-04-02");
    const index: (number | null)[] = dates.map(() => 100);
    index[0] = null; // base for 2026-04-01 at 3m
    expect(annualizedAt(index, dates, 3, dates.indexOf("2026-04-01"))).toBeNull();
    expect(annualizedAt(index, dates, 3, dates.indexOf("2026-04-02"))).toBe(0);
    index[1] = 0;
    expect(annualizedAt(index, dates, 3, dates.indexOf("2026-04-02"))).toBeNull();
    index[dates.length - 1] = null;
    expect(annualizedAt(index, dates, 3, dates.length - 1)).toBeNull();
  });
});

describe("rateSeries / latestOf", () => {
  it("returns the published yoy untouched in yoy mode", () => {
    const yoy = [1, 2, null];
    const dates = ["2026-01-01", "2026-01-02", "2026-01-03"];
    expect(rateSeries("yoy", yoy, [1, 2, 3], dates)).toBe(yoy);
    expect(rateSeries("ann3", yoy, undefined, dates)).toBe(yoy);
  });
  it("latestOf skips trailing nulls", () => {
    expect(latestOf(["a", "b", "c"], [1, 2, null])).toEqual({ date: "b", value: 2 });
    expect(latestOf(["a"], [null])).toBeNull();
  });
});

describe("lastChange", () => {
  it("returns the last position where a forward-filled index moves", () => {
    expect(lastChange([100, 100, 101, 101, 101])).toBe(2);
    expect(lastChange([100, 100])).toBe(0);
    expect(lastChange([100, null, 102, 102])).toBe(0);
  });
});
