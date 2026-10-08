import { describe, expect, it } from "vitest";
import { ratesHeadline } from "./ratesHeadline";

const ten = { value: 5.31, chg_1y_pp: 1.13 };
const yld = { value: 6.19, chg_1y: 1.19 };
const move = (y: number, o: number, as_of = "2026-10-06") => ({ as_of, base_date: "2025-10-06", yield_chg_1y: y, oas_chg_1y: o });

describe("ratesHeadline", () => {
  it("leads with the BBB yield and attributes its move only from the shared window, dated in the detail", () => {
    expect(ratesHeadline(ten, yld, move(1.19, 0.08))).toEqual({
      title: "BBB corporate debt yields 6.19%, up 119bp on the year, mostly from Treasury rates",
      detail: "The 10-year Treasury is 5.31% (+113bp on the year); over the year to Oct 6 the BBB spread moved +8bp of the index yield's +119bp.",
    });
    expect(ratesHeadline(ten, yld, move(1.0, 0.9))?.title).toContain("mostly from the credit spread");
    expect(ratesHeadline(ten, yld, move(1.0, 0.5))?.title).toContain("from both rates and the credit spread");
  });
  it("uses the shared window's own changes when the spread lags the yield", () => {
    // yield's own 1y change is to Oct 6 (+119bp); the shared window ends Sep 8
    expect(ratesHeadline(ten, yld, move(1.1, 0.08, "2026-09-08"))?.detail)
      .toContain("over the year to Sep 8 the BBB spread moved +8bp of the index yield's +110bp");
  });
  it("states no attribution without a shared window, a small move, or a BBB reading", () => {
    const base = { title: "BBB corporate debt yields 6.19%, up 119bp on the year",
      detail: "The 10-year Treasury is 5.31% (+113bp on the year)." };
    expect(ratesHeadline(ten, yld, null)).toEqual(base);
    expect(ratesHeadline(ten, yld, move(0.05, 0.04))).toEqual(base);
    const tenOnly = { title: "The 10-year Treasury yields 5.31%, up 113bp on the year", detail: null };
    expect(ratesHeadline(ten)).toEqual(tenOnly);
    expect(ratesHeadline(ten, { value: null, chg_1y: null }, move(1.19, 0.08))).toEqual(tenOnly);
    expect(ratesHeadline({ value: 5.31, chg_1y_pp: -0.004 }, { value: 6.19, chg_1y: -0.5 })?.title)
      .toBe("BBB corporate debt yields 6.19%, down 50bp on the year");
    expect(ratesHeadline(undefined)).toBeNull();
  });
});
