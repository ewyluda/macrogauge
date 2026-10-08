import { describe, expect, it } from "vitest";
import { ratesHeadline } from "./ratesHeadline";

describe("ratesHeadline", () => {
  const ten = { value: 5.31, chg_1y_pp: 1.13 };
  it("splits the BBB yield's move into rates and credit", () => {
    expect(ratesHeadline(ten, { value: 6.19, chg_1y: 1.19 }, { value: 1.02, chg_1y: 0.08 })).toBe(
      "The 10-year Treasury is 5.31% (+113bp on the year) and BBB corporate debt yields 6.19% (+119bp); " +
      "almost all of that is rates, not credit: the BBB spread moved +8bp");
    expect(ratesHeadline(ten, { value: 7.1, chg_1y: 1.0 }, { value: 2.4, chg_1y: 0.9 }))
      .toContain("most of that is credit, not rates: the BBB spread moved +90bp");
    expect(ratesHeadline(ten, { value: 6.5, chg_1y: 1.0 }, { value: 1.5, chg_1y: 0.5 }))
      .toContain("rates and credit both moved");
  });
  it("drops clauses without inputs (an artifact before the credit series)", () => {
    expect(ratesHeadline(ten)).toBe("The 10-year Treasury is 5.31% (+113bp on the year)");
    expect(ratesHeadline(ten, { value: 6.19, chg_1y: 0.05 }, { value: 1.0, chg_1y: 0.04 }))
      .toBe("The 10-year Treasury is 5.31% (+113bp on the year) and BBB corporate debt yields 6.19% (+5bp)");
    expect(ratesHeadline(undefined)).toBeNull();
  });
});
