import { C, ogCard } from "@/lib/ogCard";
import { artifact } from "@/lib/artifact";
import { capacityHeadline } from "@/lib/capacityCohort";
import type { Capacity } from "@/lib/types";
import capacityJson from "../../../public/data/capacity.json";
import { fmtDay } from "@/lib/format";

export const dynamic = "force-static";
export const alt = "Macrogauge AI Capacity — who has the AI megawatts, repriced daily";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

const data = artifact<"capacity", Capacity>("capacity", capacityJson);
const gw = (mw: number) => (mw / 1000).toFixed(1);

export default function Image() {
  const all = data.cohorts.all;
  // the page's own EV row count (see capacity/page.tsx)
  const evRows = data.companies.filter((c) => c.dupe == null && c.ev_per_mw != null).length;
  const headline = capacityHeadline(data.cohorts, data.reference, evRows, fmtDay(data.as_of_curated));
  // tile colours follow the page's KPI cards: tracked sky, operational amber, construction violet
  return ogCard({
    kicker: "AI CAPACITY",
    stamp: `curated ${data.as_of_curated}`,
    headline: headline ? `${headline.title}.` : "Who has the AI megawatts — neoclouds, ex-miners and hyperscalers, repriced daily.",
    tiles: [
      { label: "Tracked capacity", value: `${gw(all.op + all.con + all.plan)} GW`, color: C.sky, ctx: `${all.companies} companies` },
      { label: "Operational today", value: `${gw(all.op)} GW`, color: C.amber, ctx: "critical-IT MW, energized" },
      { label: "Under construction", value: `${gw(all.con)} GW`, color: C.violet, ctx: "not revenue until energized" },
    ],
    takeaway: headline ? `${headline.detail}.`.replace(/\.\.$/, ".") : null,
  });
}
