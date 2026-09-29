import { C, ogCard } from "@/lib/ogCard";
import pulse from "../../public/data/pulse.json";
import dc from "../../public/data/datacenter.json";
import { fmtPct, fmtSigned } from "@/lib/format";

export const dynamic = "force-static";
export const alt = "MacroGauge — daily US inflation gauge vs official CPI";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

/** Social preview card, rendered at build from the same pulse.json the
 *  homepage KPIs read. Per-route cards use the same lib/ogCard helper. */
export default function Image() {
  return ogCard({
    kicker: "DAILY",
    stamp: `published ${pulse.published_at.slice(0, 10)}`,
    headline: "An independent daily gauge that re-prices the CPI basket from live market data — graded against every official print.",
    tiles: [
      { label: "Macrogauge · YoY", value: fmtPct(pulse.gauge.yoy_pct), color: C.sky, ctx: `as of ${pulse.gauge.as_of}` },
      { label: "Official CPI · YoY", value: fmtPct(pulse.official.yoy_pct), color: C.amber, ctx: `${pulse.official.month.slice(0, 7)} print` },
      { label: "DC Build · YoY", value: fmtSigned(dc.indexes.build.headline_yoy_pct), color: C.violet, ctx: `as of ${dc.indexes.build.as_of}` },
    ],
  });
}
