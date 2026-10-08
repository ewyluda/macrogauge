"use client";
import Link from "next/link";
import { useState } from "react";
import { fmtSigned, fmtPp } from "@/lib/format";

export type DriverComp = {
  code: string; label: string; group: string; weight: number; mode: string;
  last_obs: string; yoy_pct: number | null; contribution_pp: number | null;
  stale?: boolean;
};
export type DriverGroup = { group: string; weight: number; contribution_pp: number | null };
export type DriverIndex = {
  key: "build" | "ops" | "hardware";
  label: string;
  headline: number | null;
  asOf: string;
  comps: DriverComp[];
  groups?: DriverGroup[];
};

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
// Monthly series carry a first-of-month date; daily-tail components carry the
// actual day. Format both without Date parsing (no locale/hydration drift).
const fmtObs = (d: string) => {
  const [y, m, day] = d.split("-");
  const mon = MONTHS[Number(m) - 1] ?? m;
  return day === "01" ? `${mon} ${y}` : `${mon} ${Number(day)}, ${y}`;
};

/** One table for all three indexes, switched by a segmented control: what each
 *  component weighs, how much it moved, and how much of the headline it
 *  explains. Group rows carry the group's weight and contribution. */
export function DcDrivers({ indexes, groupLabels }: { indexes: DriverIndex[]; groupLabels: Record<string, string> }) {
  const [key, setKey] = useState<DriverIndex["key"]>("build");
  const idx = indexes.find((i) => i.key === key) ?? indexes[0];
  const sums = new Map((idx.groups ?? []).map((g) => [g.group, g]));
  const max = Math.max(...idx.comps.map((c) => Math.abs(c.contribution_pp ?? 0)), 0.01);
  // Center the bars on zero only when something pulls the index down;
  // otherwise half the track would sit empty.
  const twoSided = idx.comps.some((c) => (c.contribution_pp ?? 0) < 0);
  const span = twoSided ? 50 : 100;
  const byGroup = new Map<string, DriverComp[]>();
  for (const c of idx.comps) byGroup.set(c.group, [...(byGroup.get(c.group) ?? []), c]);
  // Group header rows only earn their space when a group holds several lines.
  const showGroups = [...byGroup.values()].some((g) => g.length > 1);

  return (
    <div className="dc-drivers">
      <div className="dc-drivers-head">
        <div className="dc-switch" role="group" aria-label="Index">
          {indexes.map((i) => (
            <button key={i.key} type="button" aria-pressed={i.key === key} onClick={() => setKey(i.key)}>
              {i.label} <span>{fmtSigned(i.headline)}</span>
            </button>
          ))}
        </div>
        <p>Weight, year-over-year move, and percentage-point contribution to the {idx.label} headline (as of {fmtObs(idx.asOf)}).{twoSided ? " Bars run right for components pushing costs up, left for components pulling them down." : " Every component is adding to costs right now."}</p>
      </div>
      <div className="table-card dc-drivers-table">
        <table className="data-table">
          <caption className="sr-only">{idx.label} components</caption>
          <thead>
            <tr>
              <th scope="col">Component</th>
              <th scope="col" className="num">Weight</th>
              <th scope="col" className="num">YoY</th>
              <th scope="col" className="dc-contrib-col">Contribution</th>
              <th scope="col">Last reading</th>
            </tr>
          </thead>
          <tbody>
            {[...byGroup].map(([group, comps]) => {
              const g = sums.get(group);
              return [
                showGroups && (
                  <tr key={`g-${group}`} className="dc-group-row">
                    <th scope="rowgroup" colSpan={5}>
                      {groupLabels[group] ?? group}
                      {g && <span>{(g.weight * 100).toFixed(0)}% of the index · {fmtPp(g.contribution_pp)}</span>}
                    </th>
                  </tr>
                ),
                ...comps.map((c) => {
                  const v = c.contribution_pp ?? 0;
                  const w = (Math.abs(v) / max) * span;
                  const origin = twoSided ? "50%" : "0%";
                  return (
                    <tr key={c.code}>
                      <td><Link href={`/datacenter/components/${c.code}`}>{c.label}</Link></td>
                      <td className="num">{(c.weight * 100).toFixed(0)}%</td>
                      <td className="num">{fmtSigned(c.yoy_pct)}</td>
                      <td className="dc-contrib-col">
                        <span className="dc-contrib">
                          <span className={`dc-contrib-track${twoSided ? " two-sided" : ""}`} aria-hidden>
                            <i className={v >= 0 ? "up" : "down"} style={{ width: `${w}%`, [v >= 0 ? "left" : "right"]: origin }} />
                          </span>
                          <span className="num">{fmtPp(c.contribution_pp)}</span>
                        </span>
                      </td>
                      <td className="dc-obs">
                        {fmtObs(c.last_obs)}
                        {c.mode === "official+proxy" && <span className="dc-tag" title="Monthly official series with a daily market tail spliced on">live tail</span>}
                        {c.stale && <span className="dc-tag dc-tag-stale">stale</span>}
                      </td>
                    </tr>
                  );
                }),
              ];
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
