import type { LeaderboardData } from "@/components/Leaderboard";

export const FORECASTER_NAMES: Record<string, string> = { macrogauge: "Macrogauge", cleveland: "Cleveland Fed", kalshi: "Kalshi" };

/** /scoreboard's lead: who has the smallest mean absolute error head to head,
 *  over how many prints, with the small-sample caveat until the window is
 *  long enough to earn ensemble weights. Head to head means the SAME prints:
 *  the published stats average each forecaster over whichever prints it
 *  called, so the ranking is recomputed from `rows` over the prints every
 *  graded forecaster called. Null under two forecasters or no shared print. */
export function headToHeadTakeaway(lb: LeaderboardData): string | null {
  const names = Object.keys(lb.stats).filter((k) => lb.stats[k].n > 0);
  if (names.length < 2) return null;
  const common = lb.rows.filter((r) => names.every((k) => r.forecasts[k] != null));
  const n = common.length;
  if (n === 0) return null;
  const mae = (k: string) => common.reduce((a, r) => a + Math.abs(r.forecasts[k].error), 0) / n;
  const ranked = names.map((k) => [k, mae(k)] as const).sort((a, b) => a[1] - b[1]);
  const name = (k: string) => FORECASTER_NAMES[k] ?? k;
  // three decimals: at two, 0.105 and 0.114 both read 0.11 and look like a tie
  const pp = (v: number) => `${v.toFixed(3)}pp`;
  const [lead, ...rest] = ranked;
  const others = rest.map(([k, v]) => `${name(k)} ${pp(v)}`).join(", ");
  const window = n === lb.rows.length
    ? `over the last ${n} graded print${n === 1 ? "" : "s"}`
    : `over the ${n} graded print${n === 1 ? "" : "s"} every forecaster called`;
  const head = `${name(lead[0])} has the smallest miss on CPI ${window}: ${pp(lead[1])} mean absolute error, against ${others}.`;
  return n < lb.min_n_for_weights ? `${head} ${n} prints is too few to call a winner.` : head;
}
