"use client";
import { useMemo } from "react";
import { EChart } from "./EChart";
import { C, NBER_RECESSIONS, baseOption } from "@/lib/chartTheme";
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

/** Cost of Living (orange) vs the headline gauge (sky), daily YoY, with the
 *  official CPI print stepped in dashed amber for the monthly ground truth. */
export function ColChart({
  dates,
  col,
  gauge,
  months,
  official,
  colIndex,
  gaugeIndex,
}: {
  dates: string[];
  col: (number | null)[];
  gauge: (number | null)[];
  months: string[];
  official: (number | null)[];
  colIndex?: (number | null)[];
  gaugeIndex?: (number | null)[];
}) {
  const [rate, setRate] = useRateMode();
  const momentum = rate !== "yoy" && !!colIndex;
  const colS = rateSeries(rate, col, colIndex);
  const gaugeS = rateSeries(rate, gauge, gaugeIndex);
  const suffix = momentum ? ` · ${rateLabel(rate)}` : "";
  const option = useMemo(
    () => ({
      ...baseOption(),
      series: [
        {
          name: `Cost of Living${suffix}`,
          type: "line",
          data: pair(dates, colS),
          showSymbol: false,
          lineStyle: { width: 2, color: C.col },
          itemStyle: { color: C.col },
          markArea: {
            silent: true,
            itemStyle: { color: "rgba(139, 152, 165, 0.08)" },
            data: NBER_RECESSIONS.map(([a, b]) => [{ xAxis: a }, { xAxis: b }]),
          },
        },
        {
          name: `Macrogauge${suffix}`,
          type: "line",
          data: pair(dates, gaugeS),
          showSymbol: false,
          lineStyle: { width: 1.5, color: C.sky },
          itemStyle: { color: C.sky },
        },
        ...(momentum ? [] : [{
          name: "Official CPI",
          type: "line",
          step: "end",
          data: pair(months, official),
          showSymbol: false,
          lineStyle: { width: 1.5, type: "dashed", color: C.amber },
          itemStyle: { color: C.amber },
        }]),
      ],
    }),
    [dates, colS, gaugeS, months, official, momentum, suffix],
  );
  return (
    <div>
      {colIndex && <RateModeControl value={rate} onChange={setRate} />}
      <EChart option={option} height={340} />
    </div>
  );
}
