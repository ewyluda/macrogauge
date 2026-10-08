"use client";
import { EChart } from "./EChart";
import { C, baseOption } from "@/lib/chartTheme";

/** Wages vs inflation — WGT (emerald), AHE (violet), construction trades'
 *  AHE (sky, dashed, when published), gauge (amber, area). */
export function WageChart({
  months,
  wgt,
  ahe,
  construction,
  gaugeMonths,
  gaugeYoy,
}: {
  months: string[];
  wgt: (number | null)[];
  ahe: (number | null)[];
  construction?: (number | null)[];
  gaugeMonths: string[];
  gaugeYoy: (number | null)[];
}) {
  const pair = (ms: string[], vs: (number | null)[]) =>
    ms.map((m, i) => [m, vs[i]] as [string, number | null]);
  const option = {
    ...baseOption(),
    series: [
      {
        name: "Atlanta Fed wage growth",
        type: "line", showSymbol: false, lineStyle: { width: 1.5 },
        color: C.emerald, data: pair(months, wgt),
      },
      {
        name: "Avg hourly earnings YoY",
        type: "line", showSymbol: false, lineStyle: { width: 1.5 },
        color: C.violet, data: pair(months, ahe),
      },
      ...(construction ? [{
        name: "Construction trades AHE YoY",
        type: "line", showSymbol: false, lineStyle: { width: 1.5, type: "dashed" },
        color: C.sky, data: pair(months, construction),
      }] : []),
      {
        name: "Macrogauge YoY",
        type: "line", showSymbol: false, lineStyle: { width: 1.5 },
        color: C.amber, areaStyle: { opacity: 0.12 },
        data: pair(gaugeMonths, gaugeYoy),
      },
    ],
  };
  return <EChart option={option} height={340} ariaTitle="Wage growth vs macrogauge inflation, YoY %" />;
}
