import { describe, expect, it } from "vitest";
import { headToHeadTakeaway } from "./scoreboardHeadline";
import type { LeaderboardData } from "@/components/Leaderboard";

type Errors = Record<string, (number | null)[]>;
/** one row per print; a null error is a forecaster that did not call it.
 *  stats.n counts each forecaster's own calls, as the producer does */
const lb = (errors: Errors, min = 6): LeaderboardData => {
  const len = Math.max(...Object.values(errors).map((e) => e.length));
  const rows = Array.from({ length: len }, (_, i) => ({
    reference_period: `2026-${String(i + 1).padStart(2, "0")}`, release_date: "", actual_sa_mom_pct: 0.2,
    forecasts: Object.fromEntries(Object.entries(errors).flatMap(([k, e]) =>
      e[i] == null ? [] : [[k, { value: 0.2 + (e[i] as number), error: e[i] as number, converted: false }]])),
  }));
  const stats = Object.fromEntries(Object.entries(errors).map(([k, e]) => {
    const own = e.filter((x): x is number => x != null);
    return [k, { n: own.length, mae_pp: own.length ? own.reduce((a, x) => a + Math.abs(x), 0) / own.length : null, bias_pp: 0 }];
  }));
  return { basis: "SA", window: 12, min_n_for_weights: min, weights_earned: false, stats, rows };
};

describe("headToHeadTakeaway", () => {
  it("names the smallest error and flags a small sample", () => {
    expect(headToHeadTakeaway(lb({
      macrogauge: [0.105, -0.105, 0.105],
      cleveland: [0.138, 0.138, -0.138],
      kalshi: [0.114, 0.114, 0.114],
    }))).toBe("Macrogauge has the smallest miss on CPI over the last 3 graded prints: 0.105pp mean absolute error, against Kalshi 0.114pp, Cleveland Fed 0.138pp. 3 prints is too few to call a winner.");
  });
  it("drops the caveat once the window earns weights, and needs two forecasters", () => {
    const s = headToHeadTakeaway(lb({ kalshi: Array(8).fill(0.1), macrogauge: Array(8).fill(0.2) }))!;
    expect(s.startsWith("Kalshi has the smallest miss")).toBe(true);
    expect(s).not.toContain("too few");
    expect(headToHeadTakeaway(lb({ macrogauge: [0.1, 0.1, 0.1] }))).toBeNull();
  });
  it("ranks only the prints every forecaster called when the samples differ", () => {
    // own-sample MAEs would rank Macrogauge 0.500 over Cleveland 0.600; on the one shared print Cleveland wins
    expect(headToHeadTakeaway(lb({ macrogauge: [0, 1], cleveland: [null, 0.6] })))
      .toBe("Cleveland Fed has the smallest miss on CPI over the 1 graded print every forecaster called: 0.600pp mean absolute error, against Macrogauge 1.000pp. 1 prints is too few to call a winner.");
  });
  it("uses the shared prints when counts match but the missing months differ, and is null without one", () => {
    // n is 2 each, but only the middle print is shared
    expect(headToHeadTakeaway(lb({ macrogauge: [0.1, 0.5, null], cleveland: [null, 0.2, 0.9] })))
      .toContain("Cleveland Fed has the smallest miss on CPI over the 1 graded print every forecaster called: 0.200pp");
    expect(headToHeadTakeaway(lb({ macrogauge: [0.1, null], cleveland: [null, 0.2] }))).toBeNull();
  });
});
