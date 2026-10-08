"use client";
import { useMemo } from "react";
import { EChart } from "./EChart";
import { C, NBER_RECESSIONS, baseOption } from "@/lib/chartTheme";
import { rateLabel, rateSeries } from "@/lib/momentum";
import { RateModeControl, useRateMode } from "./RateModeControl";
import { SegmentedControl } from "./SegmentedControl";
import { sliceSince, windowStart } from "@/lib/chartWindow";
import { codecs } from "@/lib/urlState";
import { useUrlState } from "@/lib/useUrlState";

const WINDOWS = [{ key: "24m", label: "24M" }, { key: "all", label: "SINCE 2019" }] as const;


type Pt = [string, number];

function pair(xs: string[], ys: (number | null)[]): Pt[] {
  const out: Pt[] = [];
  xs.forEach((x, i) => {
    const y = ys[i];
    if (y !== null && y !== undefined) out.push([x, y]);
  });
  return out;
}

/** Cost of Living (orange) vs the headline gauge (sky), daily YoY, with the
 *  official CPI print stepped in dashed grey for the monthly ground truth.
 *  24 months by default: since 2019 the 2022 peak sets the scale. */
export function ColChart({
  dates,
  col,
  gauge,
  months,
  official,
  colIndex,
  gaugeIndex,
  markFrom,
}: {
  dates: string[];
  col: (number | null)[];
  gauge: (number | null)[];
  months: string[];
  official: (number | null)[];
  colIndex?: (number | null)[];
  gaugeIndex?: (number | null)[];
  /** a dated vertical marker (the start of a rate-driven jump) */
  markFrom?: { date: string; label: string } | null;
}) {
  const [rate, setRate] = useRateMode();
  const momentum = rate !== "yoy" && !!colIndex;
  const [win, setWin] = useUrlState<"24m" | "all">("win", "24m", codecs.enumOf(["24m", "all"] as const));
  const start = win === "24m" ? windowStart([dates], 24) : undefined;
  // momentum is computed on the full history first, then the window is cut
  const full = sliceSince(dates, [rateSeries(rate, col, colIndex, dates), rateSeries(rate, gauge, gaugeIndex, dates)], start);
  const [colS, gaugeS] = full.series;
  const offc = sliceSince(months, [official], start);
  const suffix = momentum ? ` · ${rateLabel(rate)}` : "";
  const option = useMemo(
    () => ({
      ...baseOption(),
      series: [
        {
          name: `Cost of Living${suffix}`,
          type: "line",
          data: pair(full.dates, colS),
          showSymbol: false,
          lineStyle: { width: 2, color: C.col },
          itemStyle: { color: C.col },
          markArea: {
            silent: true,
            itemStyle: { color: "rgba(139, 152, 165, 0.08)" },
            data: NBER_RECESSIONS.map(([a, b]) => [{ xAxis: a }, { xAxis: b }]),
          },
          ...(markFrom ? {
            markLine: {
              silent: true, symbol: "none",
              data: [{ xAxis: markFrom.date }],
              lineStyle: { color: C.muted, type: "solid", width: 1 },
              label: { formatter: markFrom.label, color: C.text, fontSize: 11, position: "insideEndTop" },
            },
          } : {}),
        },
        {
          name: `Macrogauge${suffix}`,
          type: "line",
          data: pair(full.dates, gaugeS),
          showSymbol: false,
          lineStyle: { width: 1.5, color: C.sky },
          itemStyle: { color: C.sky },
        },
        ...(momentum ? [] : [{
          name: "Official CPI",
          type: "line",
          step: "end",
          data: pair(offc.dates, offc.series[0]),
          showSymbol: false,
          lineStyle: { width: 1.5, type: "dashed", color: C.muted },
          itemStyle: { color: C.muted },
        }]),
      ],
    }),
    [full.dates, colS, gaugeS, offc, momentum, suffix, markFrom],
  );
  return (
    <div>
      <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
        {colIndex && <RateModeControl value={rate} onChange={setRate} />}
        <SegmentedControl options={WINDOWS} value={win} onChange={setWin} />
      </div>
      <EChart option={option} height={340} ariaTitle="Cost-of-living gauge vs macrogauge and official CPI" />
    </div>
  );
}
