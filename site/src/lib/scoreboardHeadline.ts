import type { LeaderboardData } from "@/components/Leaderboard";

export const FORECASTER_NAMES: Record<string, string> = { macrogauge: "Macrogauge", cleveland: "Cleveland Fed", kalshi: "Kalshi" };

/** /scoreboard's lead: who has the smallest mean absolute error head to head,
 *  over how many prints, with the small-sample caveat until the window is
 *  long enough to earn ensemble weights. */
export function headToHeadTakeaway(lb: LeaderboardData): string | null {
  const ranked = Object.entries(lb.stats)
    .filter(([, s]) => s.mae_pp != null && s.n > 0)
    .sort((a, b) => (a[1].mae_pp as number) - (b[1].mae_pp as number));
  if (ranked.length < 2) return null;
  const n = Math.min(...ranked.map(([, s]) => s.n));
  const name = (k: string) => FORECASTER_NAMES[k] ?? k;
  // three decimals: at two, 0.105 and 0.114 both read 0.11 and look like a tie
  const pp = (v: number | null) => `${(v as number).toFixed(3)}pp`;
  const [lead, ...rest] = ranked;
  const others = rest.map(([k, s]) => `${name(k)} ${pp(s.mae_pp)}`).join(", ");
  const head = `${name(lead[0])} has the smallest miss on CPI over the last ${n} graded print${n === 1 ? "" : "s"}: ${pp(lead[1].mae_pp)} mean absolute error, against ${others}.`;
  return n < lb.min_n_for_weights ? `${head} ${n} prints is too few to call a winner.` : head;
}
