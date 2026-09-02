"use client";

import dynamic from "next/dynamic";
import type { EChartClientProps } from "./EChartClient";

export type EChartProps = EChartClientProps & {
  height?: number;
};

// Keep the large ECharts runtime out of every chart route's initial bundle.
// All wrappers cross this one lazy seam, so a new chart cannot accidentally
// restore the eager import by choosing its own loading strategy.
const LazyEChart = dynamic(
  () => import("./EChartClient").then((mod) => mod.EChartClient),
  { ssr: false },
);

export function EChart({
  option,
  height = 320,
  notMerge = true,
  instanceRef,
}: EChartProps) {
  // The stable outer box reserves the chart's final space while the async
  // runtime loads, avoiding a layout shift on slower clients.
  return (
    <div style={{ width: "100%", height }}>
      <LazyEChart
        option={option}
        notMerge={notMerge}
        instanceRef={instanceRef}
      />
    </div>
  );
}
