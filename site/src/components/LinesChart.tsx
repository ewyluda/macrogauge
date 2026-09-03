"use client";
import { useMemo } from "react";
import { EChart } from "./EChart";
import { C, NBER_RECESSIONS, baseOption } from "@/lib/chartTheme";

export type LineSeries = {
  name: string;
  x: string[];
  y: (number | null)[];
  color: string;
  dashed?: boolean;
  /** step-end (monthly official prints) */
  step?: boolean;
  width?: number;
};

type Pt = [string, number];
function pair(xs: string[], ys: (number | null)[]): Pt[] {
  const out: Pt[] = [];
  xs.forEach((x, i) => {
    const y = ys[i];
    if (y !== null && y !== undefined) out.push([x, y]);
  });
  return out;
}

/** Generic ours-vs-official line chart: any number of series, NBER shading
 *  on the first, optional dashed reference line. ColChart/HeroChart keep
 *  their bespoke layouts; new pages compose this instead of copying them. */
export function LinesChart({
  series,
  height = 340,
  recessions = true,
  refLine,
  refLabel,
  yUnit = "%",
  yPrefix = "",
}: {
  series: LineSeries[];
  height?: number;
  recessions?: boolean;
  refLine?: number;
  refLabel?: string;
  /** axis/tooltip suffix — baseOption() assumes "%"; pass "" for an index,
   *  "bn" for $bn etc. Strings only: this is rendered from server pages. */
  yUnit?: string;
  yPrefix?: string;
}) {
  const option = useMemo(
    () => {
      const base = baseOption();
      const fmt = (v: number) => `${yPrefix}${Number.isInteger(v) ? v.toLocaleString("en-US") : v.toFixed(2)}${yUnit}`;
      const axis = yUnit === "%" && !yPrefix ? {} : {
        yAxis: { ...base.yAxis, axisLabel: { ...(base.yAxis as { axisLabel?: object }).axisLabel, formatter: fmt } },
        tooltip: { ...base.tooltip, valueFormatter: (v: unknown) => (typeof v === "number" ? fmt(v) : "—") },
      };
      return {
      ...base,
      ...axis,
      series: series.map((s, i) => ({
        name: s.name,
        type: "line",
        data: pair(s.x, s.y),
        showSymbol: false,
        step: s.step ? "end" : undefined,
        lineStyle: { width: s.width ?? (i === 0 ? 2 : 1.5), color: s.color, type: s.dashed ? "dashed" : "solid" },
        itemStyle: { color: s.color },
        ...(i === 0 && recessions
          ? {
              markArea: {
                silent: true,
                itemStyle: { color: "rgba(139, 152, 165, 0.08)" },
                data: NBER_RECESSIONS.map(([a, b]) => [{ xAxis: a }, { xAxis: b }]),
              },
            }
          : {}),
        ...(i === 0 && refLine !== undefined
          ? {
              markLine: {
                silent: true,
                symbol: "none",
                lineStyle: { type: "dashed", color: C.muted },
                label: { formatter: refLabel ?? `${refLine}%`, color: C.muted, fontSize: 11, position: "insideEndTop" },
                data: [{ yAxis: refLine }],
              },
            }
          : {}),
      })),
      };
    },
    [series, recessions, refLine, refLabel, yUnit, yPrefix],
  );
  return <EChart option={option} height={height} />;
}
