"use client";
import { useMemo } from "react";
import { EChart } from "./EChart";
import { C, NBER_RECESSIONS, baseOption } from "@/lib/chartTheme";

type Pt = [string, number];

function pair(xs: string[], ys: (number | null)[]): Pt[] {
  const out: Pt[] = [];
  xs.forEach((x, i) => {
    const y = ys[i];
    if (y !== null && y !== undefined) out.push([x, y]);
  });
  return out;
}

export function HeroChart({
  dates,
  gauge,
  tracker,
  col,
  months,
  official,
  core,
}: {
  dates: string[];
  gauge: (number | null)[];
  tracker: (number | null)[];
  col?: (number | null)[];
  months: string[];
  official: (number | null)[];
  core: (number | null)[];
}) {
  const option = useMemo(
    () => ({
      ...baseOption(),
      series: [
        {
          name: "Macrogauge (CPI-comparable)",
          type: "line",
          data: pair(dates, gauge),
          showSymbol: false,
          lineStyle: { width: 2, color: C.sky },
          itemStyle: { color: C.sky },
          markArea: {
            silent: true,
            itemStyle: { color: "rgba(139, 152, 165, 0.08)" },
            data: NBER_RECESSIONS.map(([a, b]) => [{ xAxis: a }, { xAxis: b }]),
          },
        },
        {
          name: "CPI-Tracker",
          type: "line",
          data: pair(dates, tracker),
          showSymbol: false,
          lineStyle: { width: 1.5, color: C.violet },
          itemStyle: { color: C.violet },
        },
        // optional: the col variant (marginal-buyer shelter) as a 5th series
        ...(col
          ? [
              {
                name: "Cost of Living",
                type: "line",
                data: pair(dates, col),
                showSymbol: false,
                lineStyle: { width: 1.5, color: C.col },
                itemStyle: { color: C.col },
              },
            ]
          : []),
        {
          name: "Official CPI",
          type: "line",
          step: "end",
          data: pair(months, official),
          showSymbol: false,
          lineStyle: { width: 1.5, type: "dashed", color: C.muted },
          itemStyle: { color: C.muted },
        },
        {
          name: "Official Core",
          type: "line",
          step: "end",
          data: pair(months, core),
          showSymbol: false,
          lineStyle: { width: 1.5, type: "dashed", color: "#5B6873" },
          itemStyle: { color: "#5B6873" },
        },
      ],
    }),
    [dates, gauge, tracker, col, months, official, core],
  );
  return <EChart option={option} height={340} />;
}
