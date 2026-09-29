import { C, ogCard } from "@/lib/ogCard";
import nextprintJson from "../../../public/data/nextprint.json";
import type { NextPrint } from "@/lib/types";

export const dynamic = "force-static";
export const alt = "MacroGauge CPI preview — nowcast vs Cleveland Fed and Kalshi";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

const np = nextprintJson as NextPrint;
const pct = (v: number | null | undefined) => (v == null ? "—" : `${v.toFixed(2)}%`);

export default function Image() {
  const core = np.core?.ensemble.value;
  return ogCard({
    kicker: "CPI PREVIEW",
    stamp: np.release_date ? `releases ${np.release_date}` : "next release TBA",
    headline: `Bottom-up CPI nowcast for ${np.reference_month ?? "the next print"} — frozen before the release and graded against the first print.`,
    tiles: [
      { label: `Ensemble CPI · MoM${np.basis ? ` (${np.basis})` : ""}`, value: pct(np.ensemble.value), color: C.sky, ctx: `${np.forecasters.length} forecasters` },
      { label: "Core CPI · MoM (SA)", value: pct(core), color: C.violet, ctx: "ex food & energy" },
      ...np.forecasters.slice(0, 1).map((f) => ({ label: f.name, value: pct(f.value), color: C.amber, ctx: `as of ${f.as_of}` })),
    ],
  });
}
