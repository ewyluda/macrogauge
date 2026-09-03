import { describe, expect, it } from "vitest";
import { fmtDay, fmtMonth } from "./format";

describe("fmtDay", () => {
  // daily-cadence as-of dates must keep the day — fmtMonth collapsed
  // "2026-07-20" to "Jul 2026", indistinguishable from a monthly obs
  it("renders a full day date", () => {
    expect(fmtDay("2026-07-20")).toBe("Jul 20, 2026");
  });
  it("strips a leading zero day", () => {
    expect(fmtDay("2026-07-01")).toBe("Jul 1, 2026");
  });
});

describe("fmtMonth", () => {
  it("renders month-year", () => {
    expect(fmtMonth("2026-05-01")).toBe("May 2026");
  });
});

import { fmtUsd } from "./format";

describe("fmtUsd", () => {
  it("prints whole dollars with the sign from the rounded value", () => {
    expect(fmtUsd(1_290_000.4)).toBe("$1,290,000");
    expect(fmtUsd(-17_639.2)).toBe("−$17,639");
    expect(fmtUsd(-0.4)).toBe("$0");
    expect(fmtUsd(0.4)).toBe("$0");
    expect(fmtUsd(null)).toBe("—");
    expect(fmtUsd(NaN)).toBe("—");
  });
});
