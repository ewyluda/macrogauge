"use client";
import { useMemo } from "react";
import { EChart } from "./EChart";
import { SegmentedControl } from "./SegmentedControl";
import { CopyLink } from "./CopyLink";
import { C, NBER_RECESSIONS, baseOption } from "@/lib/chartTheme";
import { codecs } from "@/lib/urlState";
import { useUrlState } from "@/lib/useUrlState";

type Pt = [string, number];
const pair = (xs: string[], ys: (number | null)[]): Pt[] => {
  const out: Pt[] = [];
  xs.forEach((x, i) => { const y = ys[i]; if (y != null) out.push([x, y]); });
  return out;
};

const VIEWS = [{ key: "yoy", label: "YoY" }, { key: "level", label: "INDEX LEVEL" }] as const;

/** One component, ours vs the official series, with the splice point and
 *  any gate holds drawn as reference lines — the receipts view. */
export function ComponentChart({
  dates, index, bls, yoy, blsYoy, spliceDate, gateDates, label,
}: {
  dates: string[];
  index: (number | null)[];
  bls: (number | null)[];
  yoy: (number | null)[];
  blsYoy: (number | null)[];
  spliceDate: string | null;
  gateDates: string[];
  label: string;
}) {
  const [view, setView] = useUrlState<"yoy" | "level">("view", "yoy", codecs.enumOf(["yoy", "level"] as const));
  const option = useMemo(() => {
    const base = baseOption();
    const level = view === "level";
    const marks = [
      ...(spliceDate ? [{ xAxis: spliceDate, name: "splice", label: { formatter: "splice → live", color: C.emerald, fontSize: 10, position: "insideEndTop" }, lineStyle: { color: C.emerald, type: "dashed" } }] : []),
      ...gateDates.map((d) => ({ xAxis: d, name: "gate", label: { formatter: "gate hold", color: C.amber, fontSize: 10, position: "insideEndBottom" }, lineStyle: { color: C.amber, type: "dotted" } })),
    ];
    return {
      ...base,
      tooltip: level ? { ...base.tooltip, valueFormatter: (v: unknown) => (typeof v === "number" ? v.toFixed(2) : "—") } : base.tooltip,
      yAxis: level ? { ...base.yAxis, axisLabel: { color: C.muted }, scale: true } : base.yAxis,
      series: [
        {
          name: `${label} — ours${level ? " (index)" : " (YoY)"}`, type: "line", showSymbol: false,
          data: pair(dates, level ? index : yoy), lineStyle: { width: 2, color: C.sky }, itemStyle: { color: C.sky },
          markArea: { silent: true, itemStyle: { color: "rgba(139, 152, 165, 0.08)" }, data: NBER_RECESSIONS.map(([a, b]) => [{ xAxis: a }, { xAxis: b }]) },
          markLine: { silent: true, symbol: "none", data: marks },
        },
        {
          name: `${label} — BLS${level ? " (index)" : " (YoY)"}`, type: "line", showSymbol: false, step: "end",
          data: pair(dates, level ? bls : blsYoy), lineStyle: { width: 1.5, type: "dashed", color: C.muted }, itemStyle: { color: C.muted },
        },
      ],
    };
  }, [view, dates, index, bls, yoy, blsYoy, spliceDate, gateDates, label]);
  return (
    <div>
      <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", margin: "4px 0 8px" }}>
        <SegmentedControl options={VIEWS} value={view} onChange={setView} />
        <CopyLink />
      </div>
      <EChart option={option} height={340} />
    </div>
  );
}
