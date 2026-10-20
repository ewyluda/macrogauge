import { C, monthSpan, ogCard } from "@/lib/ogCard";
import { artifact } from "@/lib/artifact";
import { gasHeadline } from "@/lib/gasHeadline";
import { fmtSigned } from "@/lib/format";
import gasJson from "../../../public/data/gas.json";

export const dynamic = "force-static";
export const alt = "Macrogauge Natural Gas — Henry Hub, storage, power burn and each power hub against gas";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function Image() {
  // tile colours follow the page's KPIs: Henry Hub amber, storage sky, top hub red
  const data = artifact("gas", gasJson);
  const { henry_hub: hh, storage: st } = data;
  const hub = (data.power_vs_gas ?? []).find((r) => r.ratio != null && r.ratio_year_ago != null);
  const headline = gasHeadline(hh, data.power_vs_gas);
  // the last year of daily spot prints for the spark
  const n = data.history.dates.length;
  const dates = data.history.dates.slice(Math.max(0, n - 260));
  const vals = data.history.henry_hub.slice(Math.max(0, n - 260));
  const pts = dates.map((d, i) => [d, vals[i]] as const).filter((p): p is readonly [string, number] => typeof p[1] === "number");
  return ogCard({
    kicker: "NATURAL GAS",
    stamp: `published ${data.published_at.slice(0, 10)}`,
    headline: headline ? `${headline.title}.` : "Henry Hub, storage, power burn and the gas behind AI power.",
    tiles: [
      ...(hh ? [{ label: "Henry Hub spot", value: `$${hh.latest.toFixed(2)}/MMBtu`, color: C.amber, ctx: `30-day avg ${fmtSigned(hh.avg30_yoy_pct)} on the year` }] : []),
      ...(st ? [{ label: "Gas in storage", value: `${Math.round(st.bcf).toLocaleString("en-US")} Bcf`, color: C.sky, ctx: `${fmtSigned(st.vs_avg5_pct)} vs the 5-year average` }] : []),
      ...(hub ? [{ label: `${hub.label} · MMBtu per MWh`, value: hub.ratio!.toFixed(1), color: C.red, ctx: `from ${hub.ratio_year_ago!.toFixed(1)} a year earlier` }] : []),
    ],
    spark: pts.length > 1 ? {
      values: pts.map(([, v]) => v), label: "Henry Hub spot · daily", color: C.amber,
      range: monthSpan(pts[0][0], pts.at(-1)![0]),
    } : null,
  });
}
