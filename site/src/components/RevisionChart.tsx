"use client";
import { useMemo } from "react";
import { EChart } from "./EChart";
import { C, baseOption } from "@/lib/chartTheme";

/** First-print vs latest, per reference period, as bars of the revision
 *  (pp of YoY for the price indexes, thousands of jobs for payrolls). */
export function RevisionChart({ months, values, unit }: { months: string[]; values: (number | null)[]; unit: "pp" | "k" }) {
  const option = useMemo(() => {
    const base = baseOption();
    const fmt = (v: number) => `${v > 0 ? "+" : ""}${unit === "pp" ? v.toFixed(2) : v.toFixed(0)}${unit}`;
    return {
      ...base,
      legend: { show: false },
      tooltip: { ...base.tooltip, trigger: "axis", axisPointer: { type: "shadow" }, valueFormatter: (v: unknown) => (typeof v === "number" ? fmt(v) : "—") },
      xAxis: { ...base.xAxis, type: "category", data: months, axisLabel: { color: C.muted } },
      yAxis: { ...base.yAxis, axisLabel: { color: C.muted, formatter: (v: number) => fmt(v) } },
      series: [{
        name: "revision", type: "bar", barMaxWidth: 22,
        data: values.map((v) => ({ value: v, itemStyle: { color: v == null ? C.muted : v > 0 ? C.red : v < 0 ? C.emerald : C.muted } })),
      }],
    };
  }, [months, values, unit]);
  return <EChart option={option} height={240} />;
}
