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
  ariaTitle,
  fitY = false,
  bands,
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
  /** chart text alternative's lead (B15); series + latest values follow */
  ariaTitle?: string;
  /** fit the y-axis to the data instead of starting at zero — for an index
   *  near 100 whose moves a zero-based axis flattens */
  fitY?: boolean;
  /** labelled date ranges shaded behind the lines (an episode the reader
   *  must not misread, e.g. a ratio spike from a shipments collapse) */
  bands?: { from: string; to: string; label: string }[];
}) {
  const option = useMemo(
    () => {
      const base = baseOption();
      const fmt = (v: number) => `${yPrefix}${Number.isInteger(v) ? v.toLocaleString("en-US") : v.toFixed(2)}${yUnit}`;
      const axis = yUnit === "%" && !yPrefix ? {} : {
        yAxis: { ...base.yAxis, axisLabel: { ...(base.yAxis as { axisLabel?: object }).axisLabel, formatter: fmt } },
        tooltip: { ...base.tooltip, valueFormatter: (v: unknown) => (typeof v === "number" ? fmt(v) : "—") },
      };
      if (fitY) {
        const y = ("yAxis" in axis ? axis.yAxis : base.yAxis) as object;
        // fitted to the data, but never so tight the reference line drops out
        const bounds = refLine == null ? {} : {
          min: (v: { min: number }) => Math.floor(Math.min(v.min, refLine)),
          max: (v: { max: number }) => Math.ceil(Math.max(v.max, refLine)),
        };
        Object.assign(axis, { yAxis: { ...y, scale: true, ...bounds } });
      }
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
        ...(i === 0 && (recessions || bands?.length)
          ? {
              markArea: {
                silent: true,
                itemStyle: { color: "rgba(139, 152, 165, 0.08)" },
                label: { color: C.muted, fontSize: 11, position: "insideTop" },
                data: [
                  ...(recessions ? NBER_RECESSIONS.map(([a, b]) => [{ xAxis: a }, { xAxis: b }]) : []),
                  ...(bands ?? []).map((b) => [
                    { xAxis: b.from, name: b.label, itemStyle: { color: "rgba(139, 152, 165, 0.16)" } },
                    { xAxis: b.to },
                  ]),
                ],
              },
            }
          : {}),
        ...(i === 0 && refLine !== undefined
          ? {
              markLine: {
                silent: true,
                symbol: "none",
                lineStyle: { type: "dashed", color: C.muted },
                // start, not end: at the right edge the label ran past the
                // plot and clipped ("flat" rendered as "fla")
                label: { formatter: refLabel ?? `${refLine}%`, color: C.muted, fontSize: 11, position: "insideStartTop",
                         // a backing box keeps it legible where lines cross the reference
                         backgroundColor: "rgba(255,255,255,0.85)", padding: [1, 4], borderRadius: 3 },
                data: [{ yAxis: refLine }],
              },
            }
          : {}),
      })),
      };
    },
    [series, recessions, refLine, refLabel, yUnit, yPrefix, fitY, bands],
  );
  return <EChart option={option} height={height} ariaTitle={ariaTitle} />;
}
