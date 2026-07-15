import type { Metadata } from "next";
import type { ReactNode } from "react";
import dc from "../../../public/data/datacenter.json";
import { KpiCard } from "@/components/KpiCard";
import { DcIndexChart } from "@/components/DcIndexChart";
import { ParityTable, type ParityRow } from "@/components/ParityTable";
import { StateTileMap } from "@/components/StateTileMap";
import { HardwareGapPanel, type GapRow } from "@/components/HardwareGapPanel";
import { fmtSigned, fmtPp } from "@/lib/format";

export const metadata: Metadata = {
  title: `Data Center Cost Index: build ${fmtSigned(dc.indexes.build.headline_yoy_pct)} · ops ${fmtSigned(dc.indexes.ops.headline_yoy_pct)} · hardware ${fmtSigned(dc.indexes.hardware.headline_yoy_pct)} YoY`,
  description: "Facility build & operating input costs, indexed daily — no official DC PPI exists, so we built one.",
};

type Comp = {
  code: string; label: string; group: string; weight: number; mode: string;
  last_obs: string; yoy_pct: number | null; contribution_pp: number | null;
};

const GROUPS = dc.group_labels as Record<string, string>;

function ComponentTable({ title, comps, groupHeaders = false }: {
  title: string; comps: Comp[]; groupHeaders?: boolean;
}) {
  const max = Math.max(...comps.map((c) => Math.abs(c.contribution_pp ?? 0)), 0.01);
  // Group header rows are presentation only — published rows rendered in
  // published order, no computed group sums.
  const rows: ReactNode[] = [];
  // insertion-order grouping (not run-length) so a publish that interleaves
  // groups can't emit duplicate header keys
  const byGroup = new Map<string, typeof comps>();
  for (const c of comps) {
    const bucket = byGroup.get(c.group);
    if (bucket) bucket.push(c);
    else byGroup.set(c.group, [c]);
  }
  for (const [group, groupComps] of byGroup) {
    if (groupHeaders) {
      rows.push(
        <tr key={`group-${group}`}>
          <td colSpan={7} style={{ textAlign: "left", color: "var(--muted)",
                                   fontSize: 11, fontWeight: 600, textTransform: "uppercase",
                                   letterSpacing: "0.08em", paddingTop: 12 }}>
            {GROUPS[group] ?? group}
          </td>
        </tr>
      );
    }
    for (const c of groupComps) {
    rows.push(
      <tr key={c.code}>
        <td>{c.label}</td>
        <td>{GROUPS[group] ?? group}</td>
        <td>{(c.weight * 100).toFixed(0)}%</td>
        <td>{fmtSigned(c.yoy_pct)}</td>
        <td>
          <span style={{ display: "inline-block", verticalAlign: "middle",
                         height: 8, borderRadius: 2,
                         width: `${(Math.abs(c.contribution_pp ?? 0) / max) * 90}px`,
                         background: (c.contribution_pp ?? 0) >= 0 ? "var(--accent-red)" : "var(--accent-emerald)" }} />
          <span style={{ marginLeft: 6 }}>{fmtPp(c.contribution_pp)}</span>
        </td>
        <td>{c.mode === "official+proxy" ? "monthly + futures tail" : "monthly official"}</td>
        <td>{c.last_obs}</td>
      </tr>
    );
    }
  }
  return (
    <div className="table-card">
      <h2>{title}</h2>
      <table className="data-table">
        <thead><tr><th>Component</th><th>Group</th><th>Weight</th><th>YoY</th><th>Contribution</th><th>Data</th><th>Last obs</th></tr></thead>
        <tbody>{rows}</tbody>
      </table>
    </div>
  );
}

export default function Datacenter() {
  const build = dc.indexes.build;
  const ops = dc.indexes.ops;
  const hardware = dc.indexes.hardware;
  const gateFlags = [
    ...(build.gate_flags as string[]),
    ...(ops.gate_flags as string[]),
    ...(hardware.gate_flags as string[]),
  ];
  const states = dc.parity.states as ParityRow[];
  const rankedOps = states
    .filter((s) => s.ops_mult != null)
    .sort((a, b) => a.ops_mult - b.ops_mult);
  const cheapest = rankedOps.slice(0, 5);
  const priciest = rankedOps.slice(-5).reverse();
  const strip = (label: string, rows: ParityRow[], color: string) => (
    <div>
      <div style={{ fontSize: 11, color: "var(--muted)", textTransform: "uppercase",
                    letterSpacing: "0.08em", marginBottom: 6 }}>{label}</div>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
        {rows.map((s) => (
          <span key={s.state} className="badge badge-muted" style={{ color }}>
            {s.state} {s.ops_mult.toFixed(3)}×
          </span>
        ))}
      </div>
    </div>
  );
  return (
    <div>
      <h1>Data Center Cost Index <span className="subtitle">facility build & operating input costs — no official DC PPI exists</span></h1>
      <div className="kpi-row">
        <KpiCard label="DC Build YoY" value={fmtSigned(build.headline_yoy_pct)}
                 context={`construction input costs · as of ${build.as_of}`} accent="sky" />
        <KpiCard label="DC Ops YoY" value={fmtSigned(ops.headline_yoy_pct)}
                 context={`operating input costs · as of ${ops.as_of}`} accent="violet" />
        <KpiCard label="DC Hardware YoY" value={fmtSigned(hardware.headline_yoy_pct)}
                 context={`IT hardware input costs · as of ${hardware.as_of}`} accent="amber" />
      </div>
      {gateFlags.length > 0 && (
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", margin: "8px 0" }}>
          {gateFlags.map((f) => (
            <span key={f} className="badge badge-muted"
                  style={{ color: "var(--accent-amber)", borderColor: "rgba(245,158,11,0.4)" }}>
              quality hold: {f}
            </span>
          ))}
        </div>
      )}
      <DcIndexChart series={[
        { key: "build", label: "DC Build", dates: build.dates, index: build.index, yoy: build.yoy_pct },
        { key: "ops", label: "DC Ops", dates: ops.dates, index: ops.index, yoy: ops.yoy_pct },
        { key: "hardware", label: "DC Hardware", dates: hardware.dates, index: hardware.index, yoy: hardware.yoy_pct },
      ]} />
      <ComponentTable title="DC Build components" comps={build.components as Comp[]} groupHeaders />
      <ComponentTable title="DC Ops components" comps={ops.components as Comp[]} />
      <ComponentTable title="DC Hardware components" comps={hardware.components as Comp[]} groupHeaders />
      <HardwareGapPanel rows={dc.hardware_gap as GapRow[]} />
      <h2>State cost parity <span className="subtitle">multipliers vs national average</span></h2>
      <StateTileMap states={states} national={dc.parity.national} />
      <div style={{ display: "flex", flexWrap: "wrap", gap: 24, margin: "12px 0" }}>
        {strip("Cheapest to operate", cheapest, "var(--accent-emerald)")}
        {strip("Priciest to operate", priciest, "var(--accent-red)")}
      </div>
      <ParityTable states={states} mode={dc.parity.mode} />
      <p className="method">
        Input-price indexes ({dc.rebase}), not turnkey build quotes: each component is an
        official PPI/CES/EIA series weighted by published industry cost breakdowns (facility
        only — no servers/GPUs; IT hardware indexes are hedonically adjusted and would mislead
        in the GPU era). Copper and aluminum components carry a live futures tail spliced onto
        the PPI at the last print and re-anchored every print, so futures never overwrite
        official history. Parity multipliers pin nationally-priced inputs at 1.0:
        build = {dc.parity.w_labor} × state construction wage relative (QCEW NAICS-23) + {(1 - dc.parity.w_labor).toFixed(2)};
        ops = {dc.parity.w_power} × state industrial power relative (EIA) + {(1 - dc.parity.w_power).toFixed(2)}.
        Weight citations in the methodology page pattern; sources refresh monthly (power, PPI, CES) and quarterly (QCEW, ~2-quarter lag).
        {" "}The DC Hardware index uses only transaction-sensitive official series; the
        hedonically quality-adjusted series (domestic servers PPI, CPI computers, the headline
        semiconductor PPI) are shown above as contrast, not averaged in — the selection rule is
        transaction-based, not hot: imported semiconductors ride in the basket at whatever they
        print. No official DRAM or memory price index exists (BLS catalogs verified 2026-07-15;
        the microprocessor PPI was discontinued in 2015), which is why a market-data memory
        nowcast tail is the planned upgrade. Hardware is nationally priced — it does not enter
        the state parity table. Weights are cited in the methodology notes; group shares:
        compute 0.65, storage &amp; memory 0.15, network 0.20.
      </p>
    </div>
  );
}
