"use client";
import { useMemo } from "react";
import { EChart } from "./EChart";
import { C, baseOption } from "@/lib/chartTheme";
import { addMonths, monthDiff } from "@/lib/dcEscalation";
import { fmtUsd } from "@/lib/format";

/** "$9.6M" / "$840K" / "$950" — axis and end labels, where full dollars crowd. */
export function compactUsd(v: number): string {
  const a = Math.abs(v);
  const s = v < 0 ? "−" : "";
  if (a >= 1e9) return `${s}$${(a / 1e9).toFixed(2)}B`;
  if (a >= 1e6) return `${s}$${(a / 1e6).toFixed(a >= 1e8 ? 0 : 2)}M`;
  if (a >= 1e3) return `${s}$${(a / 1e3).toFixed(0)}K`;
  return `${s}$${a.toFixed(0)}`;
}

export type ForwardPath = {
  deliveryMonth: string;
  /** the chosen basis, %/yr */
  ratePct: number;
  label: string;
  /** realized-window percentiles at this horizon, %/yr — null under 12 months */
  band: { p10: number; p80: number; p90: number } | null;
};

/** Your cost along the DC Build index from the base month to the last
 *  complete print, then — when a delivery month is set — carried at the
 *  chosen basis, with the p10–p90 range of realized windows of the same
 *  length shaded and the P80 line dashed. Every point is the same arithmetic
 *  the KPI cards use: base cost × index ratio, then compound at a %/yr. */
export function EscalationPathChart({
  months, index, baseMonth, endMonth, baseCost, forward,
}: {
  months: string[];
  index: number[];
  baseMonth: string;
  endMonth: string;
  baseCost: number;
  forward: ForwardPath | null;
}) {
  const option = useMemo(() => {
    const bi = months.indexOf(baseMonth);
    const ei = months.indexOf(endMonth);
    if (bi < 0 || ei < bi) return null;
    const measured = months.slice(bi, ei + 1).map((m, k) => [m, baseCost * (index[bi + k] / index[bi])] as [string, number]);
    const startCost = measured[measured.length - 1][1];
    const fwdMonths = forward ? Array.from({ length: monthDiff(endMonth, forward.deliveryMonth) + 1 }, (_, k) => addMonths(endMonth, k)) : [];
    const at = (rate: number) => fwdMonths.map((m, k) => [m, startCost * Math.pow(1 + rate / 100, k / 12)] as [string, number]);
    const axis = [...measured.map((p) => p[0]), ...fwdMonths.slice(1)];
    // endLabel, not a per-point label: a line with showSymbol:false drops
    // item labels along with the symbols
    const endLabel = (color: string) => ({
      show: true, color, fontSize: 12, fontWeight: 600, distance: 6,
      formatter: (p: { value: [string, number] }) => compactUsd(p.value[1]),
    });

    const base = baseOption();
    const series: object[] = [
      { name: "DC Build index, measured", type: "line", showSymbol: false, data: measured,
        endLabel: endLabel(C.sky),
        lineStyle: { width: 2.5, color: C.sky }, itemStyle: { color: C.sky }, z: 3 },
    ];
    if (forward && fwdMonths.length > 1) {
      const central = at(forward.ratePct);
      if (forward.band) {
        const lo = at(forward.band.p10);
        const hi = at(forward.band.p90);
        // stacked pair: an invisible floor at p10, then the p10→p90 gap shaded
        series.push(
          { name: "p10", type: "line", stack: "band", showSymbol: false, data: lo,
            lineStyle: { opacity: 0 }, tooltip: { show: false }, silent: true },
          { name: "Realized range (p10–p90)", type: "line", stack: "band", showSymbol: false,
            data: hi.map((p, i) => [p[0], p[1] - lo[i][1]]), lineStyle: { opacity: 0 },
            areaStyle: { color: "rgba(115, 86, 168, 0.14)" }, itemStyle: { color: "rgba(115, 86, 168, 0.35)" },
            tooltip: { show: false }, silent: true },
          { name: "P80 allowance", type: "line", showSymbol: false, data: at(forward.band.p80),
            lineStyle: { width: 1.5, type: "dotted", color: C.amber }, itemStyle: { color: C.amber } },
        );
      }
      series.push({ name: `Carried at ${forward.label}`, type: "line", showSymbol: false,
        data: central, endLabel: endLabel(C.violet),
        lineStyle: { width: 2.5, type: "dashed", color: C.violet }, itemStyle: { color: C.violet }, z: 3 });
    }
    return {
      ...base,
      grid: { ...base.grid, left: 64, right: 72, top: 52 },
      legend: { ...base.legend, data: series.map((s) => (s as { name: string }).name).filter((n) => n !== "p10") },
      tooltip: { ...base.tooltip, valueFormatter: (v: unknown) => (typeof v === "number" ? fmtUsd(v) : "—") },
      xAxis: { ...base.xAxis, type: "category", data: axis, boundaryGap: false },
      yAxis: { ...base.yAxis, type: "value", scale: true,
        axisLabel: { color: C.muted, formatter: (v: number) => compactUsd(v) } },
      series: [
        ...series,
        // the hand-off from history to the carried leg
        ...(forward ? [{ type: "line", data: [], markLine: { silent: true, symbol: "none",
          lineStyle: { color: C.border, type: "solid" },
          label: { color: C.muted, fontSize: 11, position: "insideEndTop", formatter: `last full print · ${endMonth}` },
          data: [{ xAxis: endMonth }] } }] : []),
      ],
    };
  }, [months, index, baseMonth, endMonth, baseCost, forward]);

  if (!option) return null;
  return (
    <EChart option={option} height={340}
      ariaTitle={forward ? `Escalated cost from ${baseMonth} to ${forward.deliveryMonth}` : `Escalated cost from ${baseMonth} to ${endMonth}`} />
  );
}
