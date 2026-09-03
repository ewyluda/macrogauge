"use client";
import { useMemo } from "react";
import { EChart } from "./EChart";
import { C, baseOption } from "@/lib/chartTheme";
import type { Rates } from "@/lib/types";

/** The Treasury curve today vs 30 days and a year ago — tenor on a
 *  category axis (the only chart in the tree that is not time-indexed). */
export function CurveChart({ curve }: { curve: Rates["curve"] }) {
  const option = useMemo(() => {
    const base = baseOption();
    const labels = curve.map((r) => r.label);
    const line = (name: string, ys: (number | null)[], color: string, dashed = false, width = 2) => ({
      name, type: "line", data: ys, smooth: 0.3, showSymbol: true, symbolSize: 6,
      lineStyle: { width, color, type: dashed ? "dashed" : "solid" }, itemStyle: { color },
    });
    return {
      ...base,
      tooltip: { ...base.tooltip, trigger: "axis", valueFormatter: (v: unknown) => (typeof v === "number" ? `${v.toFixed(2)}%` : "—") },
      xAxis: { ...base.xAxis, type: "category", data: labels, boundaryGap: true, axisLabel: { color: C.muted } },
      yAxis: { ...base.yAxis, scale: true },
      series: [
        line("Today", curve.map((r) => r.value), C.sky),
        line("30 days ago", curve.map((r) => r.value_30d_ago), C.amber, true, 1.5),
        line("1 year ago", curve.map((r) => r.value_1y_ago), C.muted, true, 1.5),
      ],
    };
  }, [curve]);
  return <EChart option={option} height={320} />;
}
