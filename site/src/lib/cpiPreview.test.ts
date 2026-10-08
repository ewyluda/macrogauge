import { describe, expect, it } from "vitest";
import { dotDomain, previewTakeaway } from "./cpiPreview";
import type { NextPrint } from "./types";

const np = (over: Partial<NextPrint> = {}): NextPrint => ({
  published_at: "2026-10-08T12:00:00Z", target: "CPI MoM", release_date: "2026-10-14", reference_month: "2026-09",
  basis: "SA", ensemble: { value: 0.48, weights: {} },
  forecasters: [
    { name: "Macrogauge", value: 0.43, kind: "model", as_of: "2026-10-08" },
    { name: "Cleveland", value: 0.53, kind: "benchmark", as_of: "2026-09-30" },
    { name: "Kalshi", value: 0.491, kind: "benchmark", as_of: "2026-10-08" },
  ],
  ...over,
} as NextPrint);

describe("previewTakeaway", () => {
  it("states the call, the spread and the release date", () => {
    expect(previewTakeaway(np())).toBe(
      "Sep 2026 CPI, out Oct 14, 2026: the forecasters average +0.48% on the month (SA), from Macrogauge's +0.43% to Cleveland's +0.53%.");
  });
  it("drops the range with one forecaster and the date when the calendar is exhausted", () => {
    expect(previewTakeaway(np({ release_date: null, forecasters: [{ name: "Macrogauge", value: 0.43, kind: "model", as_of: "x" }] as NextPrint["forecasters"] })))
      .toBe("Sep 2026 CPI: the forecasters average +0.48% on the month (SA).");
  });
  it("is null with no ensemble", () => {
    expect(previewTakeaway(np({ ensemble: { value: null, weights: {} } }))).toBeNull();
  });
});

describe("dotDomain", () => {
  it("widens close calls to the minimum span, centred", () => {
    const [lo, hi] = dotDomain([0.43, 0.53]);
    expect(lo).toBeCloseTo(0.28, 10);
    expect(hi).toBeCloseTo(0.68, 10);
  });
  it("pads a wide spread", () => {
    const [lo, hi] = dotDomain([0, 1]);
    expect(lo).toBeCloseTo(-0.05, 10);
    expect(hi).toBeCloseTo(1.05, 10);
  });
});
