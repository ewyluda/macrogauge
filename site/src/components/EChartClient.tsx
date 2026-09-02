"use client";

import { useEffect, useRef, type MutableRefObject } from "react";
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

export type EChartClientProps = {
  option: Record<string, unknown>;
  notMerge?: boolean;
  instanceRef?: MutableRefObject<echarts.ECharts | null>;
};

/** ECharts implementation loaded asynchronously by the public EChart wrapper.
 *  Init on mount, update when options change, resize with the window, and
 *  dispose on unmount. The wrapper owns the numeric height; this module fills
 *  that reserved box only after its runtime has loaded. */
export function EChartClient({
  option,
  notMerge = true,
  instanceRef,
}: EChartClientProps) {
  const ref = useRef<HTMLDivElement>(null);
  const ownedInstanceRef = useRef<echarts.ECharts | null>(null);

  useEffect(() => {
    const chart = echarts.init(ref.current!);
    ownedInstanceRef.current = chart;
    if (instanceRef) instanceRef.current = chart;
    const onResize = () => chart.resize();
    window.addEventListener("resize", onResize);
    return () => {
      window.removeEventListener("resize", onResize);
      chart.dispose();
      ownedInstanceRef.current = null;
      if (instanceRef) instanceRef.current = null;
    };
  }, [instanceRef]);

  useEffect(() => {
    ownedInstanceRef.current?.setOption(option, { notMerge });
  }, [option, notMerge]);

  return <div ref={ref} style={{ width: "100%", height: "100%" }} />;
}
