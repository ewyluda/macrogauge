"use client";

import dynamic from "next/dynamic";
import type { EChartClientProps } from "./EChartClient";
import { chartAriaLabel } from "@/lib/chartAria";

export type EChartProps = EChartClientProps & {
  height?: number;
  /** What the chart shows ("Macrogauge vs official CPI, YoY %"); the text
   *  alternative appends each series' name and latest value to it. */
  ariaTitle?: string;
  /** Full text alternative, replacing the generated one (rarely needed). */
  ariaLabel?: string;
};

// Keep the large ECharts runtime out of every chart route's initial bundle.
// All wrappers cross this one lazy seam, so a new chart cannot accidentally
// restore the eager import by choosing its own loading strategy.
const LazyEChart = dynamic(
  () => import("./EChartClient").then((mod) => mod.EChartClient),
  {
    ssr: false,
    // A visible state inside the reserved box, so a slow runtime load reads
    // as "loading" rather than a blank panel (review 2026-09-01 B24).
    loading: () => (
      <div
        role="status"
        aria-live="polite"
        className="chart-loading"
        style={{ height: "100%" }}
      >
        loading chart…
      </div>
    ),
  },
);

export function EChart({
  option,
  height = 320,
  notMerge = true,
  instanceRef,
  ariaTitle,
  ariaLabel,
}: EChartProps) {
  // The stable outer box reserves the chart's final space while the async
  // runtime loads, avoiding a layout shift on slower clients. It is also the
  // chart's text alternative (B15): a canvas is invisible to assistive tech,
  // so the box is an image labelled with the series and their latest values.
  return (
    <div
      role="img"
      aria-label={ariaLabel ?? chartAriaLabel(option, ariaTitle)}
      style={{ width: "100%", height }}
    >
      <LazyEChart
        option={option}
        notMerge={notMerge}
        instanceRef={instanceRef}
      />
    </div>
  );
}
