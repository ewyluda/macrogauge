// site/src/components/DcIndexChart.tsx
"use client";
import { useMemo, useRef, useState } from "react";
import * as echarts from "echarts/core";
import { EChart } from "./EChart";
import { SegmentedControl } from "./SegmentedControl";
import { C, baseOption } from "@/lib/chartTheme";

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

export function DcIndexChart({ series }: { series: DcSeries[] }) {
  const [mode, setMode] = useState<Mode>("level");
  const wrapRef = useRef<HTMLDivElement>(null);

  const option = useMemo(() => {
    const base = baseOption();
    const level = mode === "level";
    return {
      ...base,
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
    // The shared EChart wrapper doesn't expose its instance; recover it from
    // the DOM node echarts.init() ran on (the wrapper's own root div).
    const dom = wrapRef.current?.firstElementChild;
    const chart =
      dom instanceof HTMLElement ? echarts.getInstanceByDom(dom) : undefined;
    if (!chart) {
      // export silently degrading would be invisible to the e2e console check
      console.warn("DC index PNG export: chart instance not found");
      return;
    }
    const url = chart.getDataURL({
      type: "png",
      pixelRatio: 2,
      backgroundColor: C.bg,
    });
    const a = document.createElement("a");
    a.href = url;
    a.download = "macrogauge-dc-index.png";
    a.click();
  };

  return (
    <div>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          flexWrap: "wrap",
          gap: 8,
          margin: "12px 0 4px",
        }}
      >
        <SegmentedControl options={MODES} value={mode} onChange={setMode} />
        <button
          onClick={exportPng}
          style={{
            border: "1px solid var(--border)",
            background: "var(--chip-bg)",
            color: "var(--muted)",
            borderRadius: 999,
            padding: "2px 12px",
            fontSize: 12,
            cursor: "pointer",
          }}
        >
          ⬇ Export PNG
        </button>
      </div>
      <div ref={wrapRef}>
        <EChart option={option} height={340} />
      </div>
    </div>
  );
}
