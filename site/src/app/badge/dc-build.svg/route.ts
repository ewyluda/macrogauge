import dc from "../../../../public/data/datacenter.json";
import { badgeSvg, svgResponse } from "@/lib/badge";

export const dynamic = "force-static";

export function GET() {
  const v = dc.indexes.build.headline_yoy_pct;
  return svgResponse(badgeSvg("DC Build cost YoY", `${v >= 0 ? "+" : ""}${v.toFixed(2)}% · ${dc.indexes.build.as_of}`, "#A78BFA"));
}
