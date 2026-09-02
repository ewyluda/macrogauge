import { describe, expect, it } from "vitest";
import { sliceSince, windowStart } from "./chartWindow";

describe("windowStart", () => {
  it("counts back from the latest date across all arrays", () => {
    expect(windowStart([["2026-08-28", "2026-08-29"], ["2026-07-01"]], 24)).toBe(
      "2024-08-29",
    );
  });
  it("is undefined with no dates", () => {
    expect(windowStart([[], []], 24)).toBeUndefined();
  });
});

describe("sliceSince", () => {
  const dates = ["2024-08-28", "2024-08-29", "2024-08-30"];
  const a = [1, 2, 3];
  const b = [null, 20, 30];
  it("drops points before the window start from every aligned series", () => {
    const out = sliceSince(dates, [a, b], "2024-08-29");
    expect(out.dates).toEqual(["2024-08-29", "2024-08-30"]);
    expect(out.series).toEqual([[2, 3], [20, 30]]);
  });
  it("keeps everything when the start predates the data or is undefined", () => {
    expect(sliceSince(dates, [a], "2020-01-01").dates).toEqual(dates);
    expect(sliceSince(dates, [a], undefined).series).toEqual([a]);
  });
  it("returns empty arrays when the start is after the data", () => {
    const out = sliceSince(dates, [a, b], "2030-01-01");
    expect(out.dates).toEqual([]);
    expect(out.series).toEqual([[], []]);
  });
});
