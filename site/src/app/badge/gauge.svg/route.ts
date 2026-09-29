import pulse from "../../../../public/data/pulse.json";
import { badgeSvg, svgResponse } from "@/lib/badge";

export const dynamic = "force-static";

export function GET() {
  return svgResponse(badgeSvg("MacroGauge CPI YoY", `${pulse.gauge.yoy_pct.toFixed(2)}% · ${pulse.gauge.as_of}`, "#38BDF8"));
}
