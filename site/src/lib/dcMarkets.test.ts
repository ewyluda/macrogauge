import { describe, expect, it, vi } from "vitest";
import { fmtSpread, sortMarkets, tightness, tightnessScore } from "./dcMarkets";
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
    mw_construction: 0, mw_planned: 0, mw_secured: 0, mw_operating: 0,
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

  it("sorts mw on mw_construction (the displayed column), not mw_disclosed (all-status total)", () => {
    // The review finding this fixes: mw_disclosed sums every status
    // (operating + construction + planned + secured), so a fully-built,
    // zero-construction site (e.g. New Carlisle, 1,725 MW operational) would
    // outrank a real construction site (e.g. Richland Parish, 1,440 MW under
    // construction) if the sort key stayed on the all-status total. This
    // test would fail against the old `mw: (r) => r.mw_disclosed` mapping.
    const rows = [
      row({ key: "all-operating", mw_disclosed: 1725, mw_construction: 0, mw_operating: 1725 }),
      row({ key: "under-construction", mw_disclosed: 1440, mw_construction: 1440, mw_operating: 0 }),
    ];
    expect(sortMarkets(rows, "mw", true).map((r) => r.key))
      .toEqual(["under-construction", "all-operating"]);
  });

  it("sorts an undisclosed-MW zero as null (sinks), a fully-disclosed zero as a real 0", () => {
    // A market whose only tracked sites don't state MW (e.g. Northern
    // Virginia: sites 1, mw_construction 0, sites_mw_undisclosed 1) is an
    // unknown, not a measured zero — it must sink below genuine zeros in
    // both directions instead of ranking beside them, mirroring the "—"
    // the panel renders for it.
    const rows = [
      row({ key: "undisclosed", sites: 1, mw_construction: 0, sites_mw_undisclosed: 1 }),
      row({ key: "real-zero", sites: 1, mw_construction: 0, sites_mw_undisclosed: 0 }),
      row({ key: "building", sites: 1, mw_construction: 300 }),
    ];
    expect(sortMarkets(rows, "mw", true).map((r) => r.key))
      .toEqual(["building", "real-zero", "undisclosed"]);
    expect(sortMarkets(rows, "mw", false).map((r) => r.key))
      .toEqual(["real-zero", "building", "undisclosed"]);
  });

  it("tightnessScore is the badge composite (wage + emp/2), null without a wage spread", () => {
    // The "Tightest market" KPI ranks by this exported score so it can never
    // crown a different market than the table's hottest badge.
    expect(tightnessScore(row({ wage_spread_pp: 8, emp_spread_pp: 6 }))).toBe(11);
    expect(tightnessScore(row({ wage_spread_pp: 8, emp_spread_pp: null }))).toBe(8);
    expect(tightnessScore(row({ wage_spread_pp: null }))).toBeNull();
    expect(tightnessScore(row({ available: false, wage_spread_pp: 8 }))).toBeNull();
  });

  it("treats two equal-availability rows with a null sort value as equal, not an arbitrary swap", () => {
    // An AVAILABLE market can have a null wageYoy/empYoy: the pipeline's
    // documented fallback regime where no county clears the like-for-like
    // bar but a level still resolves (pipeline/engine/dcmarkets.py). Two
    // such rows must compare equal (cmp === 0) so the comparator stays a
    // valid total order.
    //
    // NOTE: this pins the *output* order going forward (a forward contract),
    // it does not reproduce the pre-fix regression. V8's sort never queries
    // both cmp(a,b) and cmp(b,a) for a 2-element array, so a comparator
    // that returns 1 both ways is never exercised as a contradiction here —
    // the asymmetry is real (see the "is antisymmetric" test below) but not
    // observable through this array's output order.
    const rows = [row({ key: "a", wage_yoy_pct: null }), row({ key: "b", wage_yoy_pct: null })];
    expect(sortMarkets(rows, "wageYoy", true).map((r) => r.key)).toEqual(["a", "b"]);
    expect(sortMarkets(rows, "wageYoy", false).map((r) => r.key)).toEqual(["a", "b"]);
  });

  it("the comparator sortMarkets hands to Array.prototype.sort is antisymmetric for tied (both-null) rows", () => {
    // This is the test that actually reproduces the pre-fix regression: a
    // comparator returning 1 from both cmp(a,b) and cmp(b,a) violates the
    // total order Array.prototype.sort's spec requires, but (per the note
    // above) that violation doesn't surface through sortMarkets' output for
    // a 2-row array — V8 only ever queries one direction. So spy on
    // Array.prototype.sort, capture the actual comparator sortMarkets
    // builds, and call it both ways directly.
    const a = row({ key: "a", wage_yoy_pct: null });
    const b = row({ key: "b", wage_yoy_pct: null });
    let cmp: ((x: MarketRow, y: MarketRow) => number) | undefined;
    const spy = vi
      .spyOn(Array.prototype, "sort")
      .mockImplementation(function (
        this: MarketRow[],
        compareFn?: (x: MarketRow, y: MarketRow) => number
      ) {
        cmp = compareFn;
        return this;
      });
    sortMarkets([a, b], "wageYoy", true);
    spy.mockRestore();

    expect(cmp).toBeDefined();
    const forward = cmp!(a, b);
    const backward = cmp!(b, a);
    // Antisymmetry: forward === -backward. Compared as a plain number
    // equality (not `.toBe`) because the tied case is 0 === -0, and
    // `.toBe`'s Object.is semantics treat +0 and -0 as distinct.
    expect(forward === -backward).toBe(true);
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

  it("returns na for an available market with a null wage_spread_pp", () => {
    // tightness() itself never reads yoy_basis — it keys off wage_spread_pp,
    // which the pipeline (pipeline/engine/dcmarkets.py) guarantees is null
    // in exactly the same cases yoy_basis is null. This test covers the
    // available:true side of that null check; it cannot exercise the
    // yoy_basis correlation itself, which is the pipeline's invariant, not
    // this module's.
    expect(tightness(row({ available: true, wage_spread_pp: null, emp_spread_pp: null })))
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
