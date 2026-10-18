import { C, ogCard } from "@/lib/ogCard";
import { artifact } from "@/lib/artifact";
import { tightnessScore } from "@/lib/dcMarkets";
import type { DcMarkets } from "@/lib/types";
import marketsJson from "../../../public/data/dc_markets.json";
import { fmtNum } from "@/lib/format";

export const dynamic = "force-static";
export const alt = "Macrogauge DC Market Panel — construction labor across data-center markets";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

const data = artifact<"dc_markets", DcMarkets>("dc_markets", marketsJson);

export default function Image() {
  const nat = data.national;
  const live = data.markets.filter((m) => m.available);
  // the page's ranking: the same composite as the table's tightness badge
  const hottest = live.filter((m) => tightnessScore(m) !== null)
    .sort((a, b) => tightnessScore(b)! - tightnessScore(a)!)[0];
  const signed = (v: number) => fmtNum(v, 1, { signed: true });
  return ogCard({
    kicker: "DC MARKETS",
    stamp: `QCEW quarter ${data.as_of ?? "—"}`,
    headline: `Construction wages and headcount where the data centers are — county resolution, against the national rate, across ${live.length} markets.`,
    tiles: [
      { label: "US construction wage", value: nat.wage != null ? `$${nat.wage.toLocaleString("en-US")}/wk` : "—", color: C.sky,
        ctx: nat.wage_yoy_pct != null ? `${signed(nat.wage_yoy_pct)}% YoY · private NAICS 23` : "awaiting first QCEW quarter" },
      { label: "Tightest market", value: hottest ? hottest.name : "—", color: C.violet,
        ctx: hottest?.wage_spread_pp != null ? `${signed(hottest.wage_spread_pp)}pp wage vs national` : "—" },
      { label: "Markets covered", value: `${live.length} / ${data.markets.length}`, color: C.sky, ctx: "the rest are BLS disclosure-suppressed" },
    ],
    takeaway: nat.emp != null
      ? `${(nat.emp / 1e6).toFixed(2)}M construction workers nationally${nat.emp_yoy_pct != null ? `, ${signed(nat.emp_yoy_pct)}% on the year` : ""} — QCEW publishes about 5–6 months after the quarter ends.`
      : null,
  });
}
