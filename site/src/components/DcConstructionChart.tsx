"use client";
import { useMemo, useRef } from "react";
import * as echarts from "echarts/core";
import { EChart } from "./EChart";
import { C, baseOption } from "@/lib/chartTheme";

function pair(months: string[], vals: (number | null)[]): [string, number | null][] {
  return months.map((m, i) => [m, vals[i]] as [string, number | null]);
}

export function DcConstructionChart({ months, saar, real }: {
  months: string[]; saar: number[]; real: (number | null)[];
}) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const option = useMemo(() => {
    const base = baseOption();
    return {
      ...base,
      // values arrive in $M; display in $B — presentation-only division
      tooltip: {
        ...base.tooltip,
        valueFormatter: (v: unknown) =>
          typeof v === "number" ? `$${(v / 1000).toFixed(1)}B/yr` : "—",
      },
      yAxis: {
        ...base.yAxis,
        scale: true,
        axisLabel: { color: C.muted, formatter: (v: number) => `$${v / 1000}B` },
      },
      series: [
        { name: "Nominal (SAAR)", type: "line", showSymbol: false,
          data: pair(months, saar),
          lineStyle: { width: 2, color: C.sky }, itemStyle: { color: C.sky } },
        { name: "Real, 2018-01 $ (DC Build deflator)", type: "line", showSymbol: false,
          data: pair(months, real),
          lineStyle: { width: 2, color: C.amber }, itemStyle: { color: C.amber } },
      ],
    };
  }, [months, saar, real]);

  const exportPng = () => {
    const dom = wrapRef.current?.firstElementChild;
    const chart =
      dom instanceof HTMLElement ? echarts.getInstanceByDom(dom) : undefined;
    if (!chart) {
      console.warn("DC construction PNG export: chart instance not found");
      return;
    }
    const url = chart.getDataURL({ type: "png", pixelRatio: 2, backgroundColor: C.bg });
    const a = document.createElement("a");
    a.href = url;
    a.download = "macrogauge-dc-construction.png";
    a.click();
  };

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "flex-end", margin: "12px 0 4px" }}>
        <button onClick={exportPng}
                style={{ border: "1px solid var(--border)", background: "var(--chip-bg)",
                         color: "var(--muted)", borderRadius: 999, padding: "2px 12px",
                         fontSize: 12, cursor: "pointer" }}>
          ⬇ Export PNG
        </button>
      </div>
      <div ref={wrapRef}>
        <EChart option={option} height={320} />
      </div>
    </div>
  );
}
