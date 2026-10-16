import { C, monthSpan, ogCard } from "@/lib/ogCard";
import { artifact } from "@/lib/artifact";
import type { LongLead } from "@/lib/types";
import llJson from "../../../public/data/longlead.json";
import { fmtSigned } from "@/lib/format";

export const dynamic = "force-static";
export const alt = "Macrogauge Long-Lead Board — vendor order books vs equipment prices";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

const data = artifact<"longlead", LongLead>("longlead", llJson);

export default function Image() {
  const pkg = (code: string) => data.packages.find((p) => p.code === code);
  const sw = pkg("switchgear");
  const tx = pkg("transformers");
  const b = data.backlog_months?.electrical;
  return ogCard({
    kicker: "LONG-LEAD BOARD",
    stamp: `published ${data.published_at.slice(0, 10)}`,
    headline: "Switchgear, transformers, generators, turbines and HVAC — equipment prices beside the vendors' own order books and lead times.",
    tiles: [
      { label: "Switchgear · price YoY", value: fmtSigned(sw?.price_yoy_pct ?? null), color: C.sky, ctx: sw?.price_last_obs ? `PPI, ${sw.price_last_obs.slice(0, 7)}` : "PPI" },
      { label: "Transformers · price YoY", value: fmtSigned(tx?.price_yoy_pct ?? null), color: C.violet, ctx: tx?.price_last_obs ? `PPI, ${tx.price_last_obs.slice(0, 7)}` : "PPI" },
      ...(b ? [{ label: "Electrical backlog", value: `${b.latest.toFixed(1)} mo`, color: C.amber, ctx: `unfilled orders ÷ shipments, ${b.latest_month}` }] : []),
    ],
    spark: b && { values: b.ratio, label: "Electrical backlog · months", range: monthSpan(b.months[0], b.months.at(-1)!), color: C.amber },
  });
}
