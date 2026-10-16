import { C, ogCard } from "@/lib/ogCard";
import { artifact } from "@/lib/artifact";
import { siteCostsHeadline } from "@/lib/siteCosts";
import type { Geo } from "@/lib/types";
import geoJson from "../../../public/data/geo.json";
import { fmtMonth, fmtSigned } from "@/lib/format";

export const dynamic = "force-static";
export const alt = "Macrogauge Site Costs — industrial power, construction wages and more by state";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

const data = artifact<"geo", Geo>("geo", geoJson);
const quarter = (d: string | null) => (d ? `Q${Math.ceil(Number(d.slice(5, 7)) / 3)} ${d.slice(0, 4)}` : "—");

export default function Image() {
  const nat = data.national;
  const headline = siteCostsHeadline(data.states, nat);
  const ind = nat.elec_ind_cents;
  return ogCard({
    kicker: "SITE COSTS",
    stamp: `published ${data.published_at.slice(0, 10)}`,
    headline: headline ? `${headline.title}.` : "Industrial power, construction wages and more, state by state.",
    tiles: [
      { label: "US industrial power", value: ind.value != null ? `${ind.value.toFixed(2)}¢` : "—", color: C.sky,
        ctx: `per kWh · ${fmtSigned(ind.yoy_pct)} YoY · ${ind.as_of ? fmtMonth(ind.as_of) : "—"}` },
      { label: "US construction wage", value: nat.wage_weekly.value != null ? `$${Math.round(nat.wage_weekly.value).toLocaleString("en-US")}` : "—",
        color: C.violet, ctx: `per week · ${quarter(nat.wage_weekly.as_of)}` },
      { label: "US residential power", value: nat.elec_res_cents.value != null ? `${nat.elec_res_cents.value.toFixed(2)}¢` : "—",
        color: C.amber, ctx: `per kWh · ${fmtSigned(nat.elec_res_cents.yoy_pct)} YoY` },
    ],
    takeaway: headline?.detail ?? null,
  });
}
