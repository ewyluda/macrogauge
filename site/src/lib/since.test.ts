import { describe, expect, it } from "vitest";
import { sinceStats } from "./since";

// fixture straight from the original site's screenshot: $100 since 2020-01-01,
// index 100 -> 127.79 over 2378 days (2020-01-01 -> 2026-07-06)
const DATES = ["2020-01-01", "2026-07-06"];
const INDEX = [100, 127.79];

describe("sinceStats", () => {
  it("reproduces the original's published example", () => {
    const s = sinceStats(DATES, INDEX, "2020-01-01", 100)!;
    expect(s.days).toBe(2378);
    expect(s.pctSince).toBeCloseTo(27.79, 2);
    expect(s.thenNow).toBeCloseTo(127.79, 2);
    expect(s.buys).toBeCloseTo(78.25, 2);          // 100 / 1.2779
    expect(s.annualizedPct).toBeCloseTo(3.84, 2);  // 1.2779^(365/2378) - 1
  });
  it("uses the nearest observation at or before the date", () => {
    const s = sinceStats(["2020-01-01", "2020-01-05"], [100, 110], "2020-01-03", 50)!;
    expect(s.startDate).toBe("2020-01-01");
    expect(s.thenNow).toBeCloseTo(55, 4);
  });
  it("returns null before the series starts", () => {
    expect(sinceStats(DATES, INDEX, "2019-12-31", 100)).toBeNull();
  });
});
