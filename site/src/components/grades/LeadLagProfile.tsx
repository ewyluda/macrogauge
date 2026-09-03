"use client";
import { useMemo } from "react";
import { EChart } from "@/components/EChart";
import { C, baseOption } from "@/lib/chartTheme";
import type { LeadLagMapping } from "@/lib/types";

const COLORS = [C.sky, C.amber, C.violet, C.emerald, C.red, C.col];

/** Correlation-by-lag curves behind the lead-lag table: one line per
 *  driver→component mapping, lag in months on x. A curve that peaks at
 *  lag 0 and decays is contemporaneous co-movement, not a lead — which is
 *  what the verdict above says in words. */
export function LeadLagProfile({ mappings }: { mappings: LeadLagMapping[] }) {
  const option = useMemo(() => {
    const base = baseOption();
    return {
      ...base,
      tooltip: { ...base.tooltip, valueFormatter: (v: unknown) => (typeof v === "number" ? v.toFixed(3) : "—") },
      xAxis: { ...base.xAxis, type: "value", name: "lag, months", nameLocation: "middle", nameGap: 26, nameTextStyle: { color: C.muted }, axisLabel: { color: C.muted }, minInterval: 1 },
      yAxis: { ...base.yAxis, name: "correlation", nameTextStyle: { color: C.muted }, axisLabel: { color: C.muted } },
      series: mappings.map((m, i) => ({
        name: `${m.driver_label} → ${m.component_label}`,
        type: "line",
        showSymbol: false,
        data: m.profile.filter((p) => p.corr != null).map((p) => [p.lag, p.corr]),
        lineStyle: { width: m.stable ? 2.5 : 1.5, color: COLORS[i % COLORS.length], type: m.stable ? "solid" : "dashed" },
        itemStyle: { color: COLORS[i % COLORS.length] },
      })),
    };
  }, [mappings]);
  if (!mappings.some((m) => m.profile?.length)) return null;
  return (
    <div className="chart-card" style={{ marginBottom: 12 }}>
      <EChart option={option} height={300} />
      <div style={{ fontSize: 11, color: "var(--muted)", padding: "4px 8px 6px" }}>
        Solid = cleared the gate; dashed = not stable across the split halves. Peak position is the best lag in the
        table; peak height is its correlation.
      </div>
    </div>
  );
}
