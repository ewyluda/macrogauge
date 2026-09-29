import { C, ogCard } from "@/lib/ogCard";
import dc from "../../../public/data/datacenter.json";
import { fmtSigned } from "@/lib/format";

export const dynamic = "force-static";
export const alt = "MacroGauge Data Center Inflation — Build, Ops and Hardware cost indexes";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function Image() {
  const i = dc.indexes;
  return ogCard({
    kicker: "DATA CENTERS",
    stamp: `published ${dc.published_at.slice(0, 10)}`,
    headline: "What it costs to build, equip and operate a US data center — official PPIs, extended daily with market proxies.",
    tiles: [
      { label: "DC Build · YoY", value: fmtSigned(i.build.headline_yoy_pct), color: C.violet, ctx: `as of ${i.build.as_of}` },
      { label: "DC Hardware · YoY", value: fmtSigned(i.hardware.headline_yoy_pct), color: C.sky, ctx: `as of ${i.hardware.as_of}` },
      { label: "DC Ops · YoY", value: fmtSigned(i.ops.headline_yoy_pct), color: C.amber, ctx: `as of ${i.ops.as_of}` },
    ],
  });
}
