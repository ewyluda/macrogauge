"use client";
import { useMemo } from "react";
import { EChart } from "./EChart";
import { SegmentedControl } from "./SegmentedControl";
import { CopyLink } from "./CopyLink";
import { C, NBER_RECESSIONS, baseOption } from "@/lib/chartTheme";
import { codecs } from "@/lib/urlState";
import { useUrlState } from "@/lib/useUrlState";
import { sliceSince, windowStart } from "@/lib/chartWindow";

type Pt = [string, number];
const pair = (xs: string[], ys: (number | null)[]): Pt[] => {
  const out: Pt[] = [];
  xs.forEach((x, i) => { const y = ys[i]; if (y != null) out.push([x, y]); });
  return out;
};

const VIEWS = [{ key: "yoy", label: "YoY" }, { key: "level", label: "INDEX LEVEL" }] as const;
const WINDOWS = [{ key: "36m", label: "36M" }, { key: "all", label: "SINCE 2018" }] as const;

/** One component, ours vs the official series, with the splice point and
 *  any gate holds drawn as reference lines — the receipts view. */
export function ComponentChart({
  dates: allDates, index: allIndex, bls: allBls, yoy: allYoy, blsYoy: allBlsYoy, spliceDate, gateDates, label,
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
  // 36 months by default: since 2018 the 2022 spike sets the scale and flattens
  // today's story. Sliced from the data, not xAxis.min (lib/chartWindow.ts).
  const [win, setWin] = useUrlState<"36m" | "all">("win", "36m", codecs.enumOf(["36m", "all"] as const));
  const cut = useMemo(() => {
    const start = win === "36m" ? windowStart([allDates], 36) : undefined;
    const { dates: d, series: [i, b, y, by] } = sliceSince(allDates, [allIndex, allBls, allYoy, allBlsYoy], start);
    return { dates: d, index: i, bls: b, yoy: y, blsYoy: by, start };
  }, [win, allDates, allIndex, allBls, allYoy, allBlsYoy]);
  const { dates, index, bls, yoy, blsYoy } = cut;
  const option = useMemo(() => {
    const base = baseOption();
    const level = view === "level";
    const marks = [
      ...(spliceDate && (!cut.start || spliceDate >= cut.start) ? [{ xAxis: spliceDate, name: "splice", label: { formatter: "splice → live", color: C.emerald, fontSize: 10, position: "insideEndTop" }, lineStyle: { color: C.emerald, type: "dashed" } }] : []),
      ...gateDates.filter((d) => !cut.start || d >= cut.start).map((d) => ({ xAxis: d, name: "gate", label: { formatter: "gate hold", color: C.amber, fontSize: 10, position: "insideEndBottom" }, lineStyle: { color: C.amber, type: "dotted" } })),
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
  }, [view, dates, index, bls, yoy, blsYoy, spliceDate, gateDates, label, cut.start]);
  return (
    <div>
      <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", margin: "4px 0 8px" }}>
        <SegmentedControl options={VIEWS} value={view} onChange={setView} />
        <SegmentedControl options={WINDOWS} value={win} onChange={setWin} />
        <CopyLink />
      </div>
      <EChart option={option} height={340} ariaTitle={`${label}, ours vs official — ${view === "level" ? "index level (2018-01 = 100)" : "YoY %"}`} />
    </div>
  );
}
