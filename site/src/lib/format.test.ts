import { describe, expect, it } from "vitest";
import { fmtDay, fmtMoney, fmtMonth, fmtNum, fmtPp, fmtQuarter, fmtStamp, trueMinus } from "./format";

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

describe("fmtNum", () => {
  it("prints a true minus, never the hyphen toFixed gives", () => {
    expect(fmtNum(-1.234, 2)).toBe("−1.23");
    expect(fmtNum(-1.234, 2)).not.toContain("-");
  });
  it("signs positives only when asked, from the rounded value", () => {
    expect(fmtNum(0.5, 1)).toBe("0.5");
    expect(fmtNum(0.5, 1, { signed: true, unit: "%" })).toBe("+0.5%");
    expect(fmtNum(-0.004, 2, { signed: true })).toBe("0.00");
    expect(fmtNum(0.004, 2, { signed: true })).toBe("0.00");
  });
  it("renders a missing value as a dash", () => {
    expect(fmtNum(null, 1)).toBe("—");
    expect(fmtNum(Number.NaN, 1)).toBe("—");
  });
});

describe("fmtPp", () => {
  it("keeps 2dp by default and takes 1dp beside 1dp KPIs", () => {
    expect(fmtPp(2.284)).toBe("+2.28pp");
    expect(fmtPp(2.284, 1)).toBe("+2.3pp");
    expect(fmtPp(-0.14, 1)).toBe("−0.1pp");
  });
});

describe("fmtMoney", () => {
  it("puts the dollar sign first and the per-unit after", () => {
    expect(fmtMoney(4170.1, "$/oz")).toBe("$4,170/oz");
    expect(fmtMoney(4.334, "$/gal")).toBe("$4.33/gal");
    expect(fmtMoney(4141.2, "$")).toBe("$4,141");
  });
});

describe("trueMinus", () => {
  it("fixes a leading hyphen-minus but leaves dates and words alone", () => {
    expect(trueMinus("-7.57%")).toBe("−7.57%");
    expect(trueMinus("spread (-0.4pp) since 2026-09-30")).toBe("spread (−0.4pp) since 2026-09-30");
    expect(trueMinus("12-month")).toBe("12-month");
  });
});

describe("fmtStamp", () => {
  it("reads publish stamps in ET, across the DST change", () => {
    expect(fmtStamp("2026-10-15T20:41:00Z")).toBe("Oct 15, 2026, 4:41 PM ET");
    expect(fmtStamp("2026-12-01T13:45:00Z")).toBe("Dec 1, 2026, 8:45 AM ET");
    // 02:30 UTC is the previous ET day
    expect(fmtStamp("2026-10-16T02:30:00Z")).toBe("Oct 15, 2026, 10:30 PM ET");
  });
});

describe("fmtQuarter", () => {
  it("names the quarter a first-of-quarter date stands for", () => {
    expect(fmtQuarter("2026-04-01")).toBe("Q2 2026");
    expect(fmtQuarter("2025-10")).toBe("Q4 2025");
  });
});
