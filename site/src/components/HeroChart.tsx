"use client";
import { useMemo } from "react";
import { EChart } from "./EChart";
import { C, NBER_RECESSIONS, baseOption } from "@/lib/chartTheme";
import { sliceSince, windowStart } from "@/lib/chartWindow";

type Pt = [string, number];

function pair(xs: string[], ys: (number | null)[]): Pt[] {
  const out: Pt[] = [];
  xs.forEach((x, i) => {
    const y = ys[i];
    if (y !== null && y !== undefined) out.push([x, y]);
  });
  return out;
}

export function HeroChart({
  dates,
  gauge,
  tracker,
  col,
  months,
  official,
  core,
  windowMonths,
}: {
  dates: string[];
  gauge: (number | null)[];
  tracker: (number | null)[];
  col?: (number | null)[];
  months: string[];
  official: (number | null)[];
  core: (number | null)[];
  windowMonths?: number;
}) {
  // The window is cut from the data, not just the axis: ECharts sizes the
  // y-axis from every point in a series, including those clipped by
  // `xAxis.min`, so the 2022 spike would otherwise crush the visible lines.
  // page.tsx already slices the home payload; this keeps the prop honest for
  // any caller that passes the full history.
  const start = useMemo(
    () => (windowMonths ? windowStart([dates, months], windowMonths) : undefined),
    [dates, months, windowMonths],
  );
  const daily = useMemo(
    () => sliceSince(dates, [gauge, tracker, col ?? []], start),
    [dates, gauge, tracker, col, start],
  );
  const monthly = useMemo(
    () => sliceSince(months, [official, core], start),
    [months, official, core, start],
  );

  const option = useMemo(
    () => {
      const base = baseOption();
      const [g, t, c] = daily.series;
      const [o, k] = monthly.series;
      return {
        ...base,
        xAxis: { ...base.xAxis, min: start },
        series: [
          {
            name: "Macrogauge (CPI-comparable)",
            type: "line",
            data: pair(daily.dates, g),
            showSymbol: false,
            lineStyle: { width: 2, color: C.sky },
            itemStyle: { color: C.sky },
            markArea: {
              silent: true,
              itemStyle: { color: "rgba(139, 152, 165, 0.08)" },
              data: NBER_RECESSIONS.map(([a, b]) => [{ xAxis: a }, { xAxis: b }]),
            },
          },
          {
            name: "CPI-Tracker",
            type: "line",
            data: pair(daily.dates, t),
            showSymbol: false,
            lineStyle: { width: 1.5, color: C.violet },
            itemStyle: { color: C.violet },
          },
          // optional: the col variant (marginal-buyer shelter) as a 5th series
          ...(col
            ? [
                {
                  name: "Cost of Living",
                  type: "line",
                  data: pair(daily.dates, c),
                  showSymbol: false,
                  lineStyle: { width: 1.5, color: C.col },
                  itemStyle: { color: C.col },
                },
              ]
            : []),
          {
            name: "Official CPI",
            type: "line",
            step: "end",
            data: pair(monthly.dates, o),
            showSymbol: false,
            lineStyle: { width: 1.5, type: "dashed", color: C.muted },
            itemStyle: { color: C.muted },
          },
          {
            name: "Official Core",
            type: "line",
            step: "end",
            data: pair(monthly.dates, k),
            showSymbol: false,
            lineStyle: { width: 1.5, type: "dashed", color: "#5B6873" },
            itemStyle: { color: "#5B6873" },
          },
        ],
      };
    },
    [daily, monthly, col, start],
  );
  return <EChart option={option} height={340} />;
}
