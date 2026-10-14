import { describe, expect, it } from "vitest";
import { officialContext } from "./officialPrint";

const pct = (v: number) => `${v.toFixed(2)}%`;

describe("officialContext", () => {
  it("reads as a plain print in an ordinary month", () => {
    expect(officialContext({ month: "2026-09-01", prev_yoy_pct: 3.4, latest_month: "2026-09-01", prev_month: "2026-08-01" }, pct))
      .toBe("Sep 2026 print · previous 3.40%");
  });

  it("works on artifacts that predate latest_month / prev_month", () => {
    expect(officialContext({ month: "2026-09-01", prev_yoy_pct: 3.4 }, pct)).toBe("Sep 2026 print · previous 3.40%");
  });

  it("says the newest print had no year-ago base when the YoY walked back", () => {
    // October 2026 printed; October 2025 never was (BLS shutdown)
    expect(officialContext({ month: "2026-09-01", prev_yoy_pct: 3.4, latest_month: "2026-10-01", prev_month: "2026-08-01" }, pct))
      .toBe("Sep 2026 YoY · Oct 2026 printed, but Oct 2025 never was · previous 3.40%");
  });

  it("names the previous month when it is not the month before", () => {
    // November 2026 print: October 2026 has no YoY, so previous is September
    expect(officialContext({ month: "2026-11-01", prev_yoy_pct: 3.74, latest_month: "2026-11-01", prev_month: "2026-09-01" }, pct))
      .toBe("Nov 2026 print · previous (Sep 2026) 3.74%");
  });
});
