import { C, monthSpan, ogCard } from "@/lib/ogCard";
import pulse from "../../public/data/pulse.json";
import dc from "../../public/data/datacenter.json";
import { fmtPct, fmtSigned } from "@/lib/format";

export const dynamic = "force-static";
export const alt = "Macrogauge — daily AI infrastructure cost indexes beside a live US inflation gauge";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

/** Social preview card, rendered at build from the same pulse.json and
 *  datacenter.json the homepage KPIs read. Every route without its own card
 *  inherits this one; per-route cards use the same lib/ogCard helper. */
export default function Image() {
  const build = dc.indexes.build;
  const m = build.monthly;
  const from = Math.max(0, m.months.length - 61);
  return ogCard({
    kicker: "AI INFRASTRUCTURE · INFLATION",
    stamp: `published ${pulse.published_at.slice(0, 10)}`,
    headline: "What it costs to build and run AI infrastructure, indexed daily — beside a live gauge of US inflation, graded against every official print.",
    tiles: [
      { label: "DC Build · YoY", value: fmtSigned(build.headline_yoy_pct), color: C.sky, ctx: `as of ${build.as_of}` },
      { label: "Macrogauge · YoY", value: fmtPct(pulse.gauge.yoy_pct), color: C.violet, ctx: `as of ${pulse.gauge.as_of}` },
      { label: "Official CPI · YoY", value: fmtPct(pulse.official.yoy_pct), color: C.amber, ctx: `${pulse.official.month.slice(0, 7)} print` },
    ],
    spark: { values: m.index.slice(from), label: "DC Build index · monthly", range: monthSpan(m.months[from], m.months.at(-1)!) },
  });
}
