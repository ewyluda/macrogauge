import type { Metadata } from "next";
import dc from "../../../public/data/datacenter.json";
import { KpiCard } from "@/components/KpiCard";
import { DcIndexChart } from "@/components/DcIndexChart";
import { ParityTable, type ParityRow } from "@/components/ParityTable";
import { fmtSigned, fmtPp } from "@/lib/format";

export const metadata: Metadata = {
  title: `Data Center Cost Index: build ${fmtSigned(dc.indexes.build.headline_yoy_pct)} · ops ${fmtSigned(dc.indexes.ops.headline_yoy_pct)} YoY`,
  description: "Facility build & operating input costs, indexed daily — no official DC PPI exists, so we built one.",
};

type Comp = {
  code: string; label: string; group: string; weight: number; mode: string;
  last_obs: string; yoy_pct: number | null; contribution_pp: number | null;
};

const GROUPS = dc.group_labels as Record<string, string>;

function ComponentTable({ title, comps }: { title: string; comps: Comp[] }) {
  const max = Math.max(...comps.map((c) => Math.abs(c.contribution_pp ?? 0)), 0.01);
  return (
    <div className="table-card">
      <h2>{title}</h2>
      <table className="data-table">
        <thead><tr><th>Component</th><th>Group</th><th>Weight</th><th>YoY</th><th>Contribution</th><th>Data</th><th>Last obs</th></tr></thead>
        <tbody>{comps.map((c) => (
          <tr key={c.code}>
            <td>{c.label}</td>
            <td>{GROUPS[c.group] ?? c.group}</td>
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
        ))}</tbody>
      </table>
    </div>
  );
}

export default function Datacenter() {
  const build = dc.indexes.build;
  const ops = dc.indexes.ops;
  return (
    <div>
      <h1>Data Center Cost Index <span className="subtitle">facility build & operating input costs — no official DC PPI exists</span></h1>
      <div className="kpi-row">
        <KpiCard label="DC Build YoY" value={fmtSigned(build.headline_yoy_pct)}
                 context={`construction input costs · as of ${build.as_of}`} accent="sky" />
        <KpiCard label="DC Ops YoY" value={fmtSigned(ops.headline_yoy_pct)}
                 context={`operating input costs · as of ${ops.as_of}`} accent="violet" />
      </div>
      <DcIndexChart buildDates={build.dates} buildIndex={build.index}
                    opsDates={ops.dates} opsIndex={ops.index} />
      <ComponentTable title="DC Build components" comps={build.components as Comp[]} />
      <ComponentTable title="DC Ops components" comps={ops.components as Comp[]} />
      <h2>State cost parity <span className="subtitle">multipliers vs national average</span></h2>
      <ParityTable states={dc.parity.states as ParityRow[]} mode={dc.parity.mode} />
      <p className="method">
        Input-price indexes (2018-01 = 100), not turnkey build quotes: each component is an
        official PPI/CES/EIA series weighted by published industry cost breakdowns (facility
        only — no servers/GPUs; IT hardware indexes are hedonically adjusted and would mislead
        in the GPU era). Copper and aluminum components carry a live futures tail spliced onto
        the PPI at the last print and re-anchored every print, so futures never overwrite
        official history. Parity multipliers pin nationally-priced inputs at 1.0:
        build = {dc.parity.w_labor} × state construction wage relative (QCEW NAICS-23) + {(1 - dc.parity.w_labor).toFixed(2)};
        ops = {dc.parity.w_power} × state industrial power relative (EIA) + {(1 - dc.parity.w_power).toFixed(2)}.
        Weight citations in the methodology page pattern; sources refresh monthly (power, PPI, CES) and quarterly (QCEW, ~2-quarter lag).
      </p>
    </div>
  );
}
