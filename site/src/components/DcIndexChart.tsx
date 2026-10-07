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
import type { Surge } from "@/lib/dcHub";

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

/** title: the takeaway (falls back to a label). surge: one series' run-up
 *  from its recent low, shaded and labelled on that series. */
export function DcIndexChart({ series, actions, exportData, title, surge }: {
  series: DcSeries[]; actions?: ReactNode; exportData?: ReactNode;
  title?: string | null; surge?: (Surge & { seriesKey: string }) | null;
}) {
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
      series: series.map((s, i) => {
        const color = LINE_COLORS[i % LINE_COLORS.length];
        const mark = surge && surge.seriesKey === s.key ? {
          markArea: {
            silent: true,
            itemStyle: { color, opacity: 0.08 },
            // the shaded run-up is narrow at full history, so the note sits to
            // its LEFT, right-aligned against the shading
            label: { show: true, position: [-6, 10], align: "right", color, fontSize: 11, fontWeight: 600,
                     formatter: surge.label },
            data: [[{ xAxis: surge.from }, { xAxis: surge.to }]],
          },
        } : {};
        return {
          name: s.label, type: "line", showSymbol: false,
          data: pair(s.dates, level ? s.index : s.yoy),
          lineStyle: { width: 2, color },
          itemStyle: { color },
          ...mark,
        };
      }),
    };
  }, [mode, series, surge]);

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
        <h2 id="dc-trend-title" className="section-title">{title ?? "The cost of building and operating"}</h2>
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
      <EChart option={option} height={340} instanceRef={chartRef} ariaTitle="Data Center Cost Index, YoY %" />
    </div>
  );
}
