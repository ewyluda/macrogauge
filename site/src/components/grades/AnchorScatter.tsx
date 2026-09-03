"use client";
import { useMemo } from "react";
import { EChart } from "@/components/EChart";
import { Section } from "@/components/Section";
import { SegmentedControl } from "@/components/SegmentedControl";
import { CopyLink } from "@/components/CopyLink";
import { C, baseOption } from "@/lib/chartTheme";
import { anchorBases, anchorPoints, anchorStats } from "@/lib/dcAnchors";
import { BASIS_LABELS } from "@/lib/dcGrades";
import { codecs } from "@/lib/urlState";
import { useUrlState } from "@/lib/useUrlState";
import type { DcGradesAnchor, Leg } from "@/lib/types";

const LEGS = [
  { key: "strict", label: "Strict (vintage-true)" },
  { key: "extended", label: "Extended (final-revision)" },
] as const;

/** Expected-vs-realized scatter over the vintage anchors: one dot per
 *  anchor month, x = what the chosen basis said the annualized escalation
 *  would be at that vintage, y = what the index actually did over the next
 *  h months. Dots above the 45° line are windows the basis under-provisioned.
 *  The caption recomputes the leg's published statistics from the same dots
 *  (pinned equal by dcAnchors.test.ts). */
export function AnchorScatter({
  anchors,
  legs,
}: {
  anchors: DcGradesAnchor[];
  legs: Record<string, Leg> | undefined;
}) {
  const [legKey, setLegKey] = useUrlState<"strict" | "extended">("leg", "strict", codecs.enumOf(["strict", "extended"] as const));
  const leg = legs?.[legKey];
  const horizons = leg?.published_horizons ?? [12, 24];
  const bases = anchorBases(anchors, legKey);
  const [basis, setBasis] = useUrlState("sb", bases[0] ?? "long_run", codecs.str(30));
  const [h, setH] = useUrlState("sh", horizons[0] ?? 12, codecs.int(1, 120));

  const basisKey = bases.includes(basis) ? basis : bases[0];
  const hKey = horizons.includes(h) ? h : horizons[0];
  const points = useMemo(() => anchorPoints(anchors, legKey, basisKey, hKey), [anchors, legKey, basisKey, hKey]);
  const stats = anchorStats(points);

  const option = useMemo(() => {
    const base = baseOption();
    const vals = points.flatMap((p) => [p.expected, p.realized]);
    const lo = Math.floor(Math.min(0, ...vals)) - 1;
    const hi = Math.ceil(Math.max(0, ...vals)) + 1;
    return {
      ...base,
      legend: { show: false },
      tooltip: {
        ...base.tooltip,
        trigger: "item",
        formatter: (p: { data: { value: [number, number]; m?: string } }) =>
          p.data.m
            ? `${p.data.m}<br/>basis said ${p.data.value[0].toFixed(2)}%/yr<br/>realized ${p.data.value[1].toFixed(2)}%/yr`
            : "",
      },
      xAxis: { ...base.xAxis, type: "value", min: lo, max: hi, name: "basis carry, %/yr", nameLocation: "middle", nameGap: 26, nameTextStyle: { color: C.muted }, axisLabel: { color: C.muted } },
      yAxis: { ...base.yAxis, min: lo, max: hi, name: `realized over ${hKey} months, %/yr`, nameTextStyle: { color: C.muted } },
      series: [
        {
          name: "parity",
          type: "line",
          data: [[lo, lo], [hi, hi]],
          showSymbol: false,
          silent: true,
          lineStyle: { type: "dashed", color: C.muted, width: 1 },
        },
        {
          name: "anchors",
          type: "scatter",
          symbolSize: 7,
          data: points.map((p) => ({
            value: [p.expected, p.realized],
            m: p.m,
            itemStyle: { color: p.shortfallPp > 0 ? C.red : C.emerald, opacity: 0.8 },
          })),
        },
      ],
    };
  }, [points, hKey]);

  return (
    <Section title="Expected vs realized — every vintage anchor">
      <p className="lede">
        Each dot is one month the harness stood at, carried the basis forward, and then watched what the index
        did. Above the dashed line the basis ran short (red); below it the basis over-provisioned (green). This is
        the picture behind the shortfall rates in the table above.
      </p>
      <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "center", margin: "6px 0 10px" }}>
        <SegmentedControl options={LEGS} value={legKey} onChange={setLegKey} />
        <SegmentedControl
          options={bases.map((b) => ({ key: b, label: BASIS_LABELS[b] ?? b }))}
          value={basisKey}
          onChange={setBasis}
        />
        <SegmentedControl
          options={horizons.map((x) => ({ key: String(x), label: `${x}mo` }))}
          value={String(hKey)}
          onChange={(k) => setH(Number(k))}
        />
        <CopyLink />
      </div>
      <div className="chart-card">
        <EChart option={option} height={380} />
      </div>
      {stats ? (
        <p style={{ fontSize: 12, color: "var(--muted)", margin: "8px 0 0" }}>
          {stats.n} anchors · shortfall in {stats.shortfallRatePct.toFixed(1)}% of windows
          {stats.meanShortfallPp != null ? ` (mean ${stats.meanShortfallPp.toFixed(2)}pp, worst ${stats.worstShortfallPp!.toFixed(2)}pp)` : ""}{" "}
          · bias {stats.biasPp >= 0 ? "+" : "−"}{Math.abs(stats.biasPp).toFixed(2)}pp · MAE {stats.maePp.toFixed(2)}pp — recomputed from the dots,
          equal to the published grade for this cell.
        </p>
      ) : (
        <p style={{ fontSize: 12, color: "var(--muted)" }}>No anchors reach this horizon on this leg.</p>
      )}
    </Section>
  );
}
