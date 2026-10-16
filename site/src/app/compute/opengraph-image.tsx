import { C, monthSpan, ogCard } from "@/lib/ogCard";
import { artifact } from "@/lib/artifact";
import type { Compute } from "@/lib/types";
import computeJson from "../../../public/data/compute.json";
import { fmtSigned } from "@/lib/format";

export const dynamic = "force-static";
export const alt = "Macrogauge Compute Prices — token and GPU-hour price indexes";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

const data = artifact<"compute", Compute>("compute", computeJson);
const idx = (v: number | null) => (v == null ? "—" : v.toFixed(1));

export default function Image() {
  const ti = data.token_index;
  const gi = data.gpu_index;
  const h = gi.history;
  return ogCard({
    kicker: "COMPUTE PRICES",
    stamp: `as of ${gi.as_of ?? "—"}`,
    headline: `What a token and a GPU-hour cost, indexed daily: list prices of the ${data.models.length} most-used models, cloud GPU-hours and marketplace rentals.`,
    tiles: [
      { label: "Token price index", value: idx(ti.value), color: (ti.chg_30d_pct ?? 0) > 0 ? C.red : C.emerald, ctx: `${ti.base_date ?? "—"} = 100 · 30d ${fmtSigned(ti.chg_30d_pct)}` },
      { label: "GPU-hour index", value: idx(gi.value), color: (gi.chg_30d_pct ?? 0) > 0 ? C.red : C.emerald, ctx: `${gi.base_date ?? "—"} = 100 · 30d ${fmtSigned(gi.chg_30d_pct)}` },
    ],
    spark: h.dates.length > 1 ? { values: h.index, label: "GPU-hour index · daily", range: monthSpan(h.dates[0], h.dates.at(-1)!), color: C.violet } : null,
  });
}
