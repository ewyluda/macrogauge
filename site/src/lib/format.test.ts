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

import { fmtUsdCompact } from "./format";

describe("fmtUsdCompact", () => {
  it("scales to B/M/K and keeps small costs distinguishable", () => {
    expect(fmtUsdCompact(1.25e9)).toBe("$1.25B");
    expect(fmtUsdCompact(11_633_187)).toBe("$11.63M");
    expect(fmtUsdCompact(250_000_000)).toBe("$250M");
    expect(fmtUsdCompact(840_000)).toBe("$840K");
    expect(fmtUsdCompact(52_480)).toBe("$52.5K");
    // adjacent ticks on a $5,000 base must not all read "$5K"
    expect([5000, 5200, 5400].map(fmtUsdCompact)).toEqual(["$5,000", "$5,200", "$5,400"]);
    expect(fmtUsdCompact(-2_500_000)).toBe("−$2.50M");
  });
});
