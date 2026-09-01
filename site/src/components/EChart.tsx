"use client";
import { useEffect, useRef } from "react";
import * as echarts from "echarts/core";
import { LineChart, TreemapChart } from "echarts/charts";
import {
  GridComponent,
  TooltipComponent,
  LegendComponent,
  MarkAreaComponent,
  MarkLineComponent,
} from "echarts/components";
import { CanvasRenderer } from "echarts/renderers";

// Every chart/component an option in this tree can reference MUST be
// registered here: ECharts silently drops an unregistered one in production
// (no console error, so the e2e zero-console-errors gate cannot see it).
// /supercore's dashed 2% markLine went missing this way (review 2026-09-01
// B1). src/components/echartsRegistry.test.ts audits this list against the
// option keys the wrappers actually use.
echarts.use([
  LineChart,
  TreemapChart,
  GridComponent,
  TooltipComponent,
  LegendComponent,
  MarkAreaComponent,
  MarkLineComponent,
  CanvasRenderer,
]);

/** Thin ECharts wrapper: init on mount (client-only — SSG renders an empty
 *  div), setOption on change, resize with the window, dispose on unmount.
 *  `notMerge` defaults to true (full reset per option change); pass false for
 *  rapid dynamic updates (e.g. treemap replay) so each setOption merges into
 *  the live chart and repaints immediately instead of tearing it down. */
export function EChart({
  option,
  height = 320,
  notMerge = true,
}: {
  option: Record<string, unknown>;
  height?: number;
  notMerge?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const chartRef = useRef<echarts.ECharts | null>(null);

  useEffect(() => {
    const chart = echarts.init(ref.current!);
    chartRef.current = chart;
    const onResize = () => chart.resize();
    window.addEventListener("resize", onResize);
    return () => {
      window.removeEventListener("resize", onResize);
      chart.dispose();
      chartRef.current = null;
    };
  }, []);

  useEffect(() => {
    chartRef.current?.setOption(option, { notMerge });
  }, [option, notMerge]);

  return <div ref={ref} style={{ width: "100%", height }} />;
}
