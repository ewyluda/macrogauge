import { describe, expect, it } from "vitest";
import { fmtSpread, sortMarkets, tightness } from "./dcMarkets";
import type { MarketRow } from "./types";

const row = (over: Partial<MarketRow>): MarketRow =>
  ({
    key: "k", name: "K", state: "VA", iso: "PJM", grid: null, utility: "U",
    note: "", as_of: "2025-10-01", base_date: "2024-10-01",
    available: true, thin_base: false,
    wage: 2000, wage_yoy_pct: 5, wage_spread_pp: 0,
    emp: 10000, emp_yoy_pct: 1, emp_spread_pp: 0,
    wage_cur: 2000, emp_cur_total: 10000, yoy_basis: "like_for_like",
    counties: [], counties_total: 1, counties_used: 1, counties_suppressed: [],
    sites: 0, mw_disclosed: 0, sites_mw_undisclosed: 0,
    ...over,
  }) as MarketRow;

describe("sortMarkets", () => {
  it("sorts unavailable markets last regardless of direction", () => {
    // A suppressed market has null metrics. It must never sort into the
    // middle of the table as if it were a zero.
    const rows = [
      row({ key: "sup", available: false, wage: null, wage_yoy_pct: null }),
      row({ key: "hi", wage_yoy_pct: 20 }),
      row({ key: "lo", wage_yoy_pct: 1 }),
    ];
    expect(sortMarkets(rows, "wageYoy", true).map((r) => r.key))
      .toEqual(["hi", "lo", "sup"]);
    expect(sortMarkets(rows, "wageYoy", false).map((r) => r.key))
      .toEqual(["lo", "hi", "sup"]);
  });

  it("does not mutate the input array", () => {
    const rows = [row({ key: "a", wage_yoy_pct: 1 }), row({ key: "b", wage_yoy_pct: 2 })];
    sortMarkets(rows, "wageYoy", true);
    expect(rows.map((r) => r.key)).toEqual(["a", "b"]);
  });

  it("sorts on emp_cur_total (true current size), not the like-for-like emp", () => {
    // Northern Virginia's published size must not depend on whether Loudoun
    // was disclosed a year ago. The emp sort key tracks the same field the
    // panel displays: emp_cur_total, not the narrower like-for-like emp.
    const rows = [
      row({ key: "small-cur-big-lfl", emp: 999999, emp_cur_total: 100 }),
      row({ key: "big-cur-small-lfl", emp: 1, emp_cur_total: 200 }),
    ];
    expect(sortMarkets(rows, "emp", true).map((r) => r.key))
      .toEqual(["big-cur-small-lfl", "small-cur-big-lfl"]);
  });
});

describe("tightness", () => {
  it("keys off the spread vs national, not the raw rate", () => {
    // +6% wage growth is slack when national is +5.1%. The panel exists to
    // make that distinction.
    expect(tightness(row({ wage_spread_pp: 8, emp_spread_pp: 10 }))).toBe("hot");
    expect(tightness(row({ wage_spread_pp: 3, emp_spread_pp: 4 }))).toBe("warm");
    expect(tightness(row({ wage_spread_pp: 0.5, emp_spread_pp: 0 }))).toBe("neutral");
    expect(tightness(row({ wage_spread_pp: -6, emp_spread_pp: -2 }))).toBe("slack");
  });

  it("returns na for an unavailable market", () => {
    expect(tightness(row({ available: false, wage_spread_pp: null, emp_spread_pp: null })))
      .toBe("na");
  });

  it("returns na when yoy_basis is null even if available", () => {
    // No YoY basis means no spread to key off — must not silently fall
    // through to "neutral".
    expect(tightness(row({ yoy_basis: null, wage_spread_pp: null, emp_spread_pp: null })))
      .toBe("na");
  });
});

describe("fmtSpread", () => {
  it("always carries an explicit sign and a pp unit", () => {
    expect(fmtSpread(4.8)).toBe("+4.8pp");
    expect(fmtSpread(-5.7)).toBe("−5.7pp");   // U+2212 minus, not hyphen
    expect(fmtSpread(0)).toBe("+0.0pp");
    expect(fmtSpread(null)).toBe("—");
  });
});
