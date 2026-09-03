"use client";
import { useMemo } from "react";
import { EChart } from "./EChart";
import { C, NBER_RECESSIONS, baseOption } from "@/lib/chartTheme";
import { sliceSince, windowStart } from "@/lib/chartWindow";
import { rateLabel, rateSeries } from "@/lib/momentum";
import { RateModeControl, useRateMode } from "./RateModeControl";

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
  gaugeIndex,
  trackerIndex,
  colIndex,
  markers,
}: {
  dates: string[];
  gauge: (number | null)[];
  tracker: (number | null)[];
  col?: (number | null)[];
  months: string[];
  official: (number | null)[];
  core: (number | null)[];
  windowMonths?: number;
  /** Daily index levels aligned with `dates`; when present the chart gains a
   *  YoY | 3m ann. | 6m ann. control (momentum computed here, before the
   *  window cut, so the lookback can reach behind the window start). */
  gaugeIndex?: (number | null)[];
  trackerIndex?: (number | null)[];
  colIndex?: (number | null)[];
  /** vertical rules — CPI release days and the next scheduled print (batch 5d) */
  markers?: { date: string; label: string }[];
}) {
  const [rate, setRate] = useRateMode();
  const momentum = rate !== "yoy" && !!gaugeIndex;
  const gaugeS = useMemo(() => rateSeries(rate, gauge, gaugeIndex), [rate, gauge, gaugeIndex]);
  const trackerS = useMemo(() => rateSeries(rate, tracker, trackerIndex), [rate, tracker, trackerIndex]);
  const colS = useMemo(() => (col ? rateSeries(rate, col, colIndex) : undefined), [rate, col, colIndex]);
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
    () => sliceSince(dates, [gaugeS, trackerS, colS ?? []], start),
    [dates, gaugeS, trackerS, colS, start],
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
      const suffix = momentum ? ` · ${rateLabel(rate)}` : "";
      return {
        ...base,
        xAxis: { ...base.xAxis, min: start },
        series: [
          {
            name: `Macrogauge (CPI-comparable)${suffix}`,
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
            ...(markers && markers.length
              ? {
                  markLine: {
                    silent: true,
                    symbol: "none",
                    lineStyle: { color: "rgba(139, 152, 165, 0.35)", type: "dotted", width: 1 },
                    label: { show: false },
                    data: markers.filter((m) => !start || m.date >= start).map((m) => ({ xAxis: m.date, name: m.label })),
                  },
                }
              : {}),
          },
          {
            name: `CPI-Tracker${suffix}`,
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
                  name: `Cost of Living${suffix}`,
                  type: "line",
                  data: pair(daily.dates, c),
                  showSymbol: false,
                  lineStyle: { width: 1.5, color: C.col },
                  itemStyle: { color: C.col },
                },
              ]
            : []),
          ...(momentum ? [] : [{
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
          }]),
        ],
      };
    },
    [daily, monthly, col, start, momentum, rate, markers],
  );
  return (
    <div>
      {gaugeIndex && <RateModeControl value={rate} onChange={setRate} />}
      <EChart option={option} height={340} />
    </div>
  );
}
