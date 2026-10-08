import { describe, expect, it } from "vitest";
import { headToHeadTakeaway } from "./scoreboardHeadline";
import type { LeaderboardData } from "@/components/Leaderboard";

const lb = (stats: LeaderboardData["stats"], min = 6): LeaderboardData =>
  ({ basis: "SA", window: 12, min_n_for_weights: min, weights_earned: false, stats, rows: [] });

describe("headToHeadTakeaway", () => {
  it("names the smallest error and flags a small sample", () => {
    expect(headToHeadTakeaway(lb({
      macrogauge: { n: 3, mae_pp: 0.105, bias_pp: 0.035 },
      cleveland: { n: 3, mae_pp: 0.138, bias_pp: 0.114 },
      kalshi: { n: 3, mae_pp: 0.114, bias_pp: 0.04 },
    }))).toBe("Macrogauge has the smallest miss on CPI over the last 3 graded prints: 0.105pp mean absolute error, against Kalshi 0.114pp, Cleveland Fed 0.138pp. 3 prints is too few to call a winner.");
  });
  it("drops the caveat once the window earns weights, and needs two forecasters", () => {
    const s = headToHeadTakeaway(lb({ kalshi: { n: 8, mae_pp: 0.1, bias_pp: 0 }, macrogauge: { n: 8, mae_pp: 0.2, bias_pp: 0 } }))!;
    expect(s.startsWith("Kalshi has the smallest miss")).toBe(true);
    expect(s).not.toContain("too few");
    expect(headToHeadTakeaway(lb({ macrogauge: { n: 3, mae_pp: 0.1, bias_pp: 0 } }))).toBeNull();
  });
});
