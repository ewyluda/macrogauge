import dc from "../../../../public/data/datacenter.json";
import { badgeSvg, svgResponse } from "@/lib/badge";
import { fmtNum } from "@/lib/format";

export const dynamic = "force-static";

export function GET() {
  const v = dc.indexes.build.headline_yoy_pct;
  return svgResponse(badgeSvg("DC Build cost YoY", `${fmtNum(v, 2, { signed: true, unit: "%" })} · ${dc.indexes.build.as_of}`, "#A78BFA"));
}
