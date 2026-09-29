import { C, ogCard } from "@/lib/ogCard";
import accountability from "../../../public/data/accountability_cpi.json";
import type { LeaderboardData } from "@/components/Leaderboard";

export const dynamic = "force-static";
export const alt = "MacroGauge forecast scoreboard — graded in public against every CPI print";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

const NAMES: Record<string, string> = { macrogauge: "Macrogauge", cleveland: "Cleveland Fed", kalshi: "Kalshi" };
const COLORS = [C.sky, C.amber, C.violet];

export default function Image() {
  const lb = (accountability as unknown as { leaderboard?: LeaderboardData }).leaderboard;
  const stats = lb ? Object.entries(lb.stats) : [];
  return ogCard({
    kicker: "SCOREBOARD",
    stamp: lb ? `${lb.basis} · last ${lb.window} prints` : "graded against first prints",
    headline: "Every CPI call graded in public against the first print — ours, the Cleveland Fed's and Kalshi's, on one basis.",
    tiles: stats.length
      ? stats.map(([name, s], i) => ({ label: `${NAMES[name] ?? name} · MAE`, value: s.mae_pp == null ? "—" : `${s.mae_pp.toFixed(2)}pp`, color: COLORS[i % COLORS.length], ctx: `${s.n} graded prints` }))
      : [{ label: "Graded prints", value: String(accountability.graded.length), color: C.sky, ctx: "live calls" }],
  });
}
