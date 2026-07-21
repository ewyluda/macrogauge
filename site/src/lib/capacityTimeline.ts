// Aggregate per-company parsed timeline events (`tl`, published by
// pipeline/publish/capacity.py) into a cumulative curve for the rows the
// user has filtered to. Quarter parsing stays in the pipeline — the client
// only sums already-parsed "YYYYQn" labels, mirroring _timeline()'s
// semantics: dupes excluded, base = operational MW, gaps filled from 2026Q2.
import type { CapacityCompany, CapacityTimeline } from "./types";

const QMIN = 2026 * 4 + 1; // timeline window opens 2026Q2 (matches _QMIN)
const ord = (q: string) => Number(q.slice(0, 4)) * 4 + (Number(q[5]) - 1);
const label = (o: number) => `${Math.floor(o / 4)}Q${(o % 4) + 1}`;

export function buildTimeline(rows: CapacityCompany[]): CapacityTimeline {
  const live = rows.filter((r) => r.dupe === null);
  const base = live.reduce((s, r) => s + r.op, 0);
  const adds = new Map<number, number>();
  const miles = new Map<number, [string, string, number][]>();
  for (const r of live) {
    for (const [q, site, mw] of r.tl ?? []) {
      const o = ord(q);
      adds.set(o, (adds.get(o) ?? 0) + mw);
      if (!miles.has(o)) miles.set(o, []);
      miles.get(o)!.push([r.t, site, mw]);
    }
  }
  if (!adds.size) return { base_mw: base, points: [], milestones: {} };
  const max = Math.max(...adds.keys());
  const points: CapacityTimeline["points"] = [];
  let cum = base;
  for (let o = QMIN; o <= max; o++) {
    cum += adds.get(o) ?? 0;
    points.push({ q: label(o), add_mw: adds.get(o) ?? 0, cum_mw: cum });
  }
  const milestones: CapacityTimeline["milestones"] = {};
  for (const o of [...miles.keys()].sort((a, b) => a - b)) milestones[label(o)] = miles.get(o)!;
  return { base_mw: base, points, milestones };
}
