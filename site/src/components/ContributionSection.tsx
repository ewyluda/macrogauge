"use client";
import { useMemo } from "react";
import Link from "next/link";
import { componentHref } from "@/lib/components";
import { EChart } from "./EChart";
import { SegmentedControl } from "./SegmentedControl";
import { CopyLink } from "./CopyLink";
import { DataUnavailable } from "./DataUnavailable";
import { DownloadData } from "./DownloadData";
import { C, baseOption } from "@/lib/chartTheme";
import { contributionGrid, contributionsAt, type ContribMode, type ReplayComponent } from "@/lib/contribution";
import { annualizedChange, lastChange, RATE_LOOKBACK_DAYS } from "@/lib/momentum";
import { fmtPp, fmtSigned, yoyColor } from "@/lib/format";
import { codecs } from "@/lib/urlState";
import { useUrlState } from "@/lib/useUrlState";
import { useJson } from "@/lib/useJson";

type Replay = {
  dates: string[];
  components: (ReplayComponent & { index: (number | null)[]; bls_index: (number | null)[]; mode: string })[];
};

const MODES = [
  { key: "ours", label: "OURS" },
  { key: "bls", label: "BLS" },
  { key: "gap", label: "GAP (ours − BLS)" },
] as const;
const WINDOWS = [
  { key: "24", label: "24M" },
  { key: "48", label: "48M" },
  { key: "all", label: "FULL HISTORY" },
] as const;

/** 14 distinguishable component colours; shelter first so the two largest
 *  weights read as one family. */
export const COMPONENT_COLORS = [
  "#38BDF8", "#0EA5E9", "#A78BFA", "#F59E0B", "#FB923C", "#34D399", "#F87171",
  "#E879F9", "#FBBF24", "#2DD4BF", "#94A3B8", "#C084FC", "#4ADE80", "#F472B6",
];

/** Stacked contribution-to-YoY bars (month-end sampling) plus the
 *  component momentum table: weight × own YoY per component sums to the
 *  headline exactly (lib/contribution.ts, parity pinned by test). Reads
 *  replay.json at runtime — the same file the treemap fetches, so the
 *  browser cache serves the second request. */
export function ContributionSection({
  defaultMode = "ours",
  showTable = true,
}: {
  defaultMode?: ContribMode;
  showTable?: boolean;
}) {
  const { data, failed } = useJson<Replay>("/data/replay.json");
  const [mode, setMode] = useUrlState<ContribMode>("cm", defaultMode, codecs.enumOf(MODES.map((m) => m.key)));
  const [win, setWin] = useUrlState<(typeof WINDOWS)[number]["key"]>("cw", "24", codecs.enumOf(WINDOWS.map((w) => w.key)));

  const grid = useMemo(
    () => (data ? contributionGrid(data.dates, data.components, mode, win === "all" ? undefined : Number(win)) : null),
    [data, mode, win],
  );

  const option = useMemo(() => {
    if (!data || !grid) return null;
    const base = baseOption();
    return {
      ...base,
      tooltip: {
        ...base.tooltip,
        trigger: "axis",
        axisPointer: { type: "shadow" },
        valueFormatter: (v: unknown) => (typeof v === "number" ? `${v >= 0 ? "+" : ""}${v.toFixed(2)}pp` : "—"),
      },
      legend: { ...base.legend, type: "scroll", top: 0 },
      grid: { ...(base.grid as object), top: 56 },
      xAxis: { ...base.xAxis, type: "category", data: grid.months },
      yAxis: { ...base.yAxis, axisLabel: { color: C.muted, formatter: (v: number) => `${v}pp` } },
      series: [
        ...data.components.map((c, k) => ({
          name: c.label,
          type: "bar",
          stack: "contrib",
          data: grid.byCode[c.code],
          itemStyle: { color: COMPONENT_COLORS[k % COMPONENT_COLORS.length] },
          emphasis: { focus: "series" },
          barMaxWidth: 28,
        })),
        {
          name: mode === "gap" ? "Total gap" : "Headline YoY",
          type: "line",
          data: grid.total,
          showSymbol: false,
          lineStyle: { width: 2, color: C.text },
          itemStyle: { color: C.text },
          z: 10,
        },
      ],
    };
  }, [data, grid, mode]);

  if (failed) return <DataUnavailable what="component replay data" />;
  if (!data || !grid || !option) {
    return <div style={{ color: "var(--muted)", fontSize: 13, padding: 24 }}>loading component contributions…</div>;
  }

  const last = data.dates.length - 1;
  const ours = contributionsAt(data.components, "ours", last);
  const bls = contributionsAt(data.components, "bls", last);
  const rows = data.components.map((c, k) => {
    // Momentum at each component's OWN last observation, never the grid
    // end: a lagging monthly series is forward-filled, so at the grid end
    // "index today vs 91 days ago" compares the same print with itself and
    // reads 0.0% (the like-month rule CLAUDE.md applies to YoY). The last
    // index change on the grid is that observation.
    const own = lastChange(c.index);
    const a3 = annualizedChange(c.index, RATE_LOOKBACK_DAYS.ann3)[own];
    const a6 = annualizedChange(c.index, RATE_LOOKBACK_DAYS.ann6)[own];
    return {
      code: c.code, label: c.label, weight: c.weight, mode: c.mode, color: COMPONENT_COLORS[k % COMPONENT_COLORS.length],
      ownDate: data.dates[own],
      yoy: c.yoy[last], ann3: a3, ann6: a6, bls_yoy: c.bls_yoy[last],
      contribution_pp: ours ? ours[k].pp : null, bls_contribution_pp: bls ? bls[k].pp : null,
    };
  }).sort((a, b) => Math.abs(b.contribution_pp ?? 0) - Math.abs(a.contribution_pp ?? 0));
  const csvRows = grid.months.map((m, i) => {
    const row: Record<string, unknown> = { month: m, total_pp: grid.total[i] };
    for (const c of data.components) row[c.code] = grid.byCode[c.code][i];
    return row;
  });

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 8, flexWrap: "wrap", alignItems: "center", marginBottom: 8 }}>
        <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "center" }}>
          <SegmentedControl options={MODES} value={mode} onChange={setMode} />
          <SegmentedControl options={WINDOWS} value={win} onChange={setWin} />
          <CopyLink />
        </div>
        <DownloadData rows={csvRows} filename={`macrogauge-contribution-${mode}`} json="replay.json"
          citation={`MacroGauge contribution to YoY (${mode}), pp, month-end sampling, as of ${data.dates[last]}`} />
      </div>
      <div className="chart-card">
        <EChart option={option} height={380} />
      </div>
      <p style={{ fontSize: 11, color: "var(--muted)", margin: "6px 0 0" }}>
        Each bar segment is weight × that component&apos;s own year-over-year change, in percentage points; the
        segments sum to the headline line exactly. BLS = the same arithmetic over the official component indexes
        (the 14-component reconstruction the gap table grades against). Sampled on each month&apos;s last grid day.
      </p>
      {showTable && (
        <div className="table-card" style={{ marginTop: 14 }}>
          <table className="data-table">
            <thead>
              <tr>
                <th style={{ textAlign: "left" }}>Component</th>
                <th>Weight</th>
                <th>Data</th>
                <th>YoY</th>
                <th>3m ann.</th>
                <th>6m ann.</th>
                <th>Contribution</th>
                <th>BLS YoY</th>
                <th>Gap contrib.</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.code}>
                  <td style={{ textAlign: "left" }}>
                    <span style={{ display: "inline-block", width: 9, height: 9, borderRadius: 2, background: r.color, marginRight: 7 }} />
                    <Link href={componentHref(r.code)}>{r.label}</Link>
                  </td>
                  <td>{(r.weight * 100).toFixed(1)}%</td>
                  <td><span className="badge badge-muted">{r.mode === "live" ? "live" : "BLS carry"}</span></td>
                  <td style={{ color: yoyColor(r.yoy) }}>{fmtSigned(r.yoy)}</td>
                  <td style={{ color: yoyColor(r.ann3) }} title={`at own last obs ${r.ownDate}`}>{fmtSigned(r.ann3)}</td>
                  <td style={{ color: yoyColor(r.ann6) }} title={`at own last obs ${r.ownDate}`}>{fmtSigned(r.ann6)}</td>
                  <td>{fmtPp(r.contribution_pp)}</td>
                  <td style={{ color: "var(--muted)" }}>{fmtSigned(r.bls_yoy)}</td>
                  <td>{r.contribution_pp != null && r.bls_contribution_pp != null ? fmtPp(r.contribution_pp - r.bls_contribution_pp) : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div style={{ fontSize: 11, color: "var(--muted)", padding: "6px 10px 8px" }}>
            As of {data.dates[last]} · 3m/6m annualized off each component&apos;s daily index (91/182 grid days,
            compounded to a year), read at the component&apos;s own last observation (hover a cell for the date) so a
            lagging monthly print is never compared with its own forward-fill — noisier than YoY by construction ·
            sorted by |contribution|.
          </div>
        </div>
      )}
    </div>
  );
}
