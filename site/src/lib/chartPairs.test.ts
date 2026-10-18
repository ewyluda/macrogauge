import { describe, expect, it } from "vitest";
import { closeStep, pairWithBreaks } from "./chartPairs";

describe("pairWithBreaks", () => {
  it("keeps interior nulls as breaks and trims the ends", () => {
    expect(pairWithBreaks(["a", "b", "c", "d", "e"], [null, 1, null, 2, null]))
      .toEqual([["b", 1], ["c", null], ["d", 2]]);
  });

  it("is empty for an all-null series", () => {
    expect(pairWithBreaks(["a", "b"], [null, undefined as unknown as null])).toEqual([]);
  });
});

describe("closeStep", () => {
  it("runs a monthly print to its month end", () => {
    expect(closeStep([["2026-08-01", 3.5], ["2026-09-01", 3.7]])).toEqual(
      [["2026-08-01", 3.5], ["2026-09-01", 3.7], ["2026-09-30", 3.7]]);
  });
  it("accepts YYYY-MM months and crosses a year end", () => {
    expect(closeStep([["2025-11", 1], ["2025-12", 2]]).at(-1)).toEqual(["2025-12-31", 2]);
  });
  it("runs a quarterly print to its quarter end", () => {
    expect(closeStep([["2026-01-01", 1], ["2026-04-01", 2]]).at(-1)).toEqual(["2026-06-30", 2]);
  });
  it("leaves daily, irregular and empty-ended series alone", () => {
    const daily: [string, number][] = [["2026-10-16", 4.5], ["2026-10-17", 4.5]];
    expect(closeStep(daily)).toBe(daily);
    const gap: [string, number | null][] = [["2026-08-01", 1], ["2026-09-01", null]];
    expect(closeStep(gap)).toBe(gap);
    expect(closeStep([["2026-09-01", 1]])).toHaveLength(1);
  });
});
