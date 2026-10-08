import { describe, expect, it } from "vitest";
import { ratesHeadline } from "./ratesHeadline";

const ten = { value: 5.31, chg_1y_pp: 1.13 };
const yld = { value: 6.19, chg_1y: 1.19 };
const move = (y: number, o: number, as_of = "2026-10-06") => ({ as_of, base_date: "2025-10-06", yield_chg_1y: y, oas_chg_1y: o });

describe("ratesHeadline", () => {
  it("attributes the BBB move only from the shared window, naming its end date", () => {
    expect(ratesHeadline(ten, yld, move(1.19, 0.08))).toBe(
      "The 10-year Treasury is 5.31% (+113bp on the year) and the BBB corporate bond index yields 6.19% (+119bp); " +
      "over the year to Oct 6 the BBB spread moved +8bp of the index yield's +119bp, so most of the move tracks Treasury rates, not credit");
    expect(ratesHeadline(ten, yld, move(1.0, 0.9))).toContain("most of the move is the credit spread, not rates");
    expect(ratesHeadline(ten, yld, move(1.0, 0.5))).toContain("rates and the credit spread both moved");
  });
  it("uses the shared window's own changes when the spread lags the yield", () => {
    // yield's own 1y change is to Oct 6 (+119bp); the shared window ends Sep 8
    expect(ratesHeadline(ten, yld, move(1.1, 0.08, "2026-09-08")))
      .toContain("over the year to Sep 8 the BBB spread moved +8bp of the index yield's +110bp");
  });
  it("states no attribution without a shared window, a small move, or a BBB reading", () => {
    const base = "The 10-year Treasury is 5.31% (+113bp on the year) and the BBB corporate bond index yields 6.19% (+119bp)";
    expect(ratesHeadline(ten, yld, null)).toBe(base);
    expect(ratesHeadline(ten, yld, move(0.05, 0.04))).toBe(base);
    expect(ratesHeadline(ten)).toBe("The 10-year Treasury is 5.31% (+113bp on the year)");
    expect(ratesHeadline(ten, { value: null, chg_1y: null }, move(1.19, 0.08))).toBe("The 10-year Treasury is 5.31% (+113bp on the year)");
    expect(ratesHeadline(undefined)).toBeNull();
  });
});
