// site/src/components/DcIndexChart.tsx
"use client";
import { useMemo } from "react";
import { EChart } from "./EChart";
import { C, baseOption } from "@/lib/chartTheme";

function pair(dates: string[], vals: number[]): [string, number][] {
  return dates.map((d, i) => [d, vals[i]] as [string, number]);
}

export function DcIndexChart({
  buildDates, buildIndex, opsDates, opsIndex,
}: {
  buildDates: string[]; buildIndex: number[];
  opsDates: string[]; opsIndex: number[];
}) {
  const option = useMemo(
    () => ({
      ...baseOption(),
      series: [
        { name: "DC Build", type: "line", showSymbol: false,
          data: pair(buildDates, buildIndex),
          lineStyle: { width: 2, color: C.sky }, itemStyle: { color: C.sky } },
        { name: "DC Ops", type: "line", showSymbol: false,
          data: pair(opsDates, opsIndex),
          lineStyle: { width: 2, color: C.violet }, itemStyle: { color: C.violet } },
      ],
    }),
    [buildDates, buildIndex, opsDates, opsIndex],
  );
  return <EChart option={option} height={340} />;
}
