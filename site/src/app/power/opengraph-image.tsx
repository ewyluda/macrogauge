import { C, monthSpan, ogCard } from "@/lib/ogCard";
import { powerSummary } from "@/lib/dcHub";
import type { PowerData } from "@/components/PowerPanel";
import dc from "../../../public/data/datacenter.json";
import { fmtSigned, etDay } from "@/lib/format";

export const dynamic = "force-static";
export const alt = "Macrogauge Power & Tariffs — wholesale power, capacity prices and large-load tariffs";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function Image() {
  // tile colours follow the page's PowerKpis: hub red, capacity violet, tariffs sky
  const { hub, capacity, tariffs, headline } = powerSummary((dc.power ?? null) as PowerData | null);
  // the hub's own [date, $/MWh] pairs, as the page's inline Spark reads them
  const pts = (hub?.spark ?? []).filter((p): p is [string, number] => typeof p[0] === "string" && typeof p[1] === "number");
  return ogCard({
    kicker: "POWER & TARIFFS",
    stamp: `published ${etDay(dc.published_at)}`,
    headline: headline ? `${headline}.` : "Wholesale power at every major US hub, capacity prices by grid operator, and large-load tariffs.",
    tiles: [
      ...(hub?.avg30 != null ? [{ label: hub.label, value: `$${hub.avg30.toFixed(2)}/MWh`, color: C.red, ctx: `30-day avg · ${fmtSigned(hub.avg30_yoy_pct ?? null)} vs a year earlier` }] : []),
      ...(capacity ? [{ label: `${capacity.iso} capacity · ${capacity.period}`, value: `$${Math.round(capacity.price).toLocaleString("en-US")}/MW-day`, color: C.violet, ctx: `from $${Math.round(capacity.firstPrice).toLocaleString("en-US")} for ${capacity.first}` }] : []),
      ...(tariffs > 0 ? [{ label: "Large-load tariffs", value: String(tariffs), color: C.sky, ctx: "each from a filing or order" }] : []),
    ],
    spark: pts.length > 1 ? {
      values: pts.map(([, v]) => v), label: `${hub!.label} · daily`, color: C.red,
      range: monthSpan(pts[0][0], pts.at(-1)![0]),
    } : null,
  });
}
