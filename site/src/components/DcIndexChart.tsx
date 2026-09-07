// site/src/components/DcIndexChart.tsx
"use client";
import { useMemo, useRef, type ReactNode } from "react";
import { useUrlState } from "@/lib/useUrlState";
import { codecs } from "@/lib/urlState";
import { CopyLink } from "./CopyLink";
import type { ECharts } from "echarts/core";
import { EChart } from "./EChart";
import { SegmentedControl } from "./SegmentedControl";
import { C, baseOption } from "@/lib/chartTheme";
import { ToolDisclosure } from "./ToolDisclosure";

type Mode = "level" | "yoy";
const MODES = [
  { key: "level", label: "LEVEL" },
  { key: "yoy", label: "YOY" },
] as const;

function pair(
  dates: string[],
  vals: (number | null)[]
): [string, number | null][] {
  return dates.map((d, i) => [d, vals[i]] as [string, number | null]);
}

export type DcSeries = {
  key: string;
  label: string;
  dates: string[];
  index: number[];
  yoy: (number | null)[];
};

const LINE_COLORS = [C.sky, C.violet, C.amber];

export function DcIndexChart({ series, actions, exportData }: { series: DcSeries[]; actions?: ReactNode; exportData?: ReactNode }) {
  const [mode, setMode] = useUrlState<Mode>("view", "level", codecs.enumOf(["level", "yoy"] as const));
  const chartRef = useRef<ECharts | null>(null);

  const option = useMemo(() => {
    const base = baseOption();
    const level = mode === "level";
    return {
      ...base,
      xAxis: { ...base.xAxis, splitNumber: 4 },
      // LEVEL plots the unitless rebased index, not a percent — drop
      // baseOption()'s "%" valueFormatter/axisLabel. YOY keeps them.
      tooltip: level
        ? {
            ...base.tooltip,
            valueFormatter: (v: unknown) =>
              typeof v === "number" ? v.toFixed(2) : "—",
          }
        : base.tooltip,
      yAxis: level
        ? { ...base.yAxis, axisLabel: { color: C.muted }, scale: true }
        : { ...base.yAxis, scale: true },
      series: series.map((s, i) => ({
        name: s.label, type: "line", showSymbol: false,
        data: pair(s.dates, level ? s.index : s.yoy),
        lineStyle: { width: 2, color: LINE_COLORS[i % LINE_COLORS.length] },
        itemStyle: { color: LINE_COLORS[i % LINE_COLORS.length] },
      })),
    };
  }, [mode, series]);

  const exportPng = () => {
    const chart = chartRef.current;
    if (!chart) {
      // export silently degrading would be invisible to the e2e console check
      console.warn("DC index PNG export: chart instance not found");
      return;
    }
    const url = chart.getDataURL({
      type: "png",
      pixelRatio: 2,
      backgroundColor: getComputedStyle(chart.getDom()).getPropertyValue("--card").trim() || C.bg,
    });
    const a = document.createElement("a");
    a.href = url;
    a.download = "macrogauge-dc-index.png";
    a.click();
  };

  return (
    <div>
      <div className="section-heading">
        <h2 id="dc-trend-title" className="section-title">The cost of building and operating</h2>
        <div className="chart-actions">
        {actions}
        <CopyLink plain />
        <ToolDisclosure label="Export">
        <div className="tool-row">
        {exportData}
        <button
          type="button"
          className="tool-btn"
          onClick={exportPng}
        >
          Export PNG
        </button>
        </div>
        </ToolDisclosure>
        </div>
      </div>
      <p className="research-chart-subtitle">{mode === "level" ? "Index · January 2018 = 100" : "Year-over-year change · %"}</p>
      <div className="research-chart-controls">
        <SegmentedControl options={MODES} value={mode} onChange={setMode} />
      </div>
      <EChart option={option} height={340} instanceRef={chartRef} />
    </div>
  );
}
