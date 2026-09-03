"use client";
import { EChart } from "./EChart";
import { C, baseOption } from "@/lib/chartTheme";
import { rateLabel, rateSeries } from "@/lib/momentum";
import { RateModeControl, useRateMode } from "./RateModeControl";

/** Daily step line (amber, light area) with a dashed 2% reference. */
export function StepChart({
  dates,
  values,
  refLine,
  refLabel,
  index,
  name = "Supercore YoY",
}: {
  dates: string[];
  values: (number | null)[];
  refLine: number;
  refLabel: string;
  /** daily index aligned with `dates` — enables the YoY | 3m | 6m control */
  index?: (number | null)[];
  name?: string;
}) {
  const [rate, setRate] = useRateMode();
  const series = rateSeries(rate, values, index);
  const label = rate === "yoy" || !index ? name : `${name.replace(/ YoY$/, "")} · ${rateLabel(rate)}`;
  const option = {
    ...baseOption(),
    legend: { show: false },
    series: [
      {
        name: label,
        type: "line",
        step: "end",
        showSymbol: false,
        lineStyle: { width: 1.5 },
        color: C.amber,
        areaStyle: { opacity: 0.12 },
        data: dates.map((d, i) => [d, series[i]] as [string, number | null]),
        markLine: {
          silent: true,
          symbol: "none",
          lineStyle: { type: "dashed", color: C.muted },
          label: { color: C.muted, formatter: refLabel, position: "insideEndTop" },
          data: [{ yAxis: refLine }],
        },
      },
    ],
  };
  return (
    <div>
      {index && <RateModeControl value={rate} onChange={setRate} note="annualized off the daily index — amplifies noise (3m ≈ ×4)" />}
      <EChart option={option} height={340} />
    </div>
  );
}
