import { C, ogCard } from "@/lib/ogCard";
import { artifact } from "@/lib/artifact";
import { buildInputsHeadline } from "@/lib/buildInputs";
import type { Commodities } from "@/lib/types";
import commoditiesJson from "../../../public/data/commodities.json";
import { fmtSigned } from "@/lib/format";

export const dynamic = "force-static";
export const alt = "Macrogauge Build Inputs — what the AI data-center build-out is bidding for, priced daily";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

const data = artifact<"commodities", Commodities>("commodities", commoditiesJson);

/** the page's own price format */
function price(v: number | null): string {
  if (v == null) return "—";
  if (v >= 1000) return Math.round(v).toLocaleString("en-US");
  if (v >= 100) return v.toFixed(1);
  return v.toFixed(2);
}

export default function Image() {
  const headline = buildInputsHeadline(data.groups[0]?.rows ?? []);
  const row = (code: string) => data.groups.flatMap((g) => g.rows).find((r) => r.code === code);
  const copper = row("fmp_copper");
  const ddr5 = row("dramex_ddr5_16g");
  const h100 = row("vast_h100_sxm");
  // tile colours follow the page's KPI cards: copper amber, DDR5 violet, H100 sky
  return ogCard({
    kicker: "BUILD INPUTS",
    stamp: `published ${data.published_at.slice(0, 10)}`,
    headline: headline ? `${headline}.` : "What the AI data-center build-out is bidding for, priced daily.",
    tiles: [
      { label: "Copper", value: copper?.value != null ? `$${price(copper.value)}/lb` : "—", color: C.amber, ctx: `${fmtSigned(copper?.yoy_pct ?? null)} YoY` },
      { label: "DDR5 spot", value: ddr5?.value != null ? `$${price(ddr5.value)}` : "—", color: C.violet,
        ctx: `per 16-gigabit chip${ddr5?.chg_alt ? ` · ${fmtSigned(ddr5.chg_alt.pct)} ${ddr5.chg_alt.label}` : ""}` },
      { label: "H100 GPU-hour", value: h100?.value != null ? `$${price(h100.value)}` : "—", color: C.sky, ctx: "vast.ai market median" },
    ],
    spark: copper?.spark && copper.spark.length > 1
      ? { values: copper.spark, label: "Copper · daily", range: copper.spark_span ?? "", color: C.amber } : null,
  });
}
