"use client";
import { EChart } from "./EChart";
import { C, baseOption } from "@/lib/chartTheme";

/** Daily step line (amber, light area) with a dashed 2% reference. */
export function StepChart({
  dates,
  values,
  refLine,
  refLabel,
}: {
  dates: string[];
  values: (number | null)[];
  refLine: number;
  refLabel: string;
}) {
  const option = {
    ...baseOption(),
    legend: { show: false },
    series: [
      {
        name: "Supercore YoY",
        type: "line",
        step: "end",
        showSymbol: false,
        lineStyle: { width: 1.5 },
        color: C.amber,
        areaStyle: { opacity: 0.12 },
        data: dates.map((d, i) => [d, values[i]] as [string, number | null]),
        markLine: {
          silent: true,
          symbol: "none",
          lineStyle: { type: "dashed", color: C.muted },
          label: { color: C.muted, formatter: refLabel, position: "insideEndTop" },
          data: [{ yAxis: refLine }],
        },
      },
    ],
  };
  return <EChart option={option} height={340} />;
}
