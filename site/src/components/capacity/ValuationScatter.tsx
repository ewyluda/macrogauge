"use client";
import type { CapacityCompany } from "@/lib/types";
import { useChartTip } from "./ChartTip";

const W = 1000, H = 500, M = { l: 64, r: 24, t: 24, b: 48 };

type Group = "cloud" | "landlord" | "other";
const GROUP: Record<Group, { label: string; short: string; color: string }> = {
  cloud: { label: "GPU clouds and operators", short: "GPU cloud / operator", color: "var(--cap-cloud)" },
  landlord: { label: "Powered-shell landlords", short: "Landlord", color: "var(--cap-landlord)" },
  other: { label: "Exploratory or context rows", short: "Exploratory / context", color: "var(--cap-plan)" },
};
const groupOf = (c: CapacityCompany): Group =>
  c.role === "landlord" ? "landlord"
    : c.role === "exploratory" || c.dupe === "context" ? "other" : "cloud";

const LOG_TICKS = [1, 2, 5, 10, 20, 50, 100, 200, 500, 1000, 2000];
const fmtM = (v: number) => `$${v >= 100 ? Math.round(v) : v.toFixed(1)}M`;
const fmtMW = (mw: number) => (mw >= 1000 ? `${(mw / 1000).toFixed(1)} GW` : `${Math.round(mw).toLocaleString("en-US")} MW`);

function medianOf(v: number[]): number {
  const s = [...v].sort((a, b) => a - b);
  return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
}

type Box = { x: number; y: number; w: number; h: number };
const hit = (a: Box, b: Box) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

export function ValuationScatter({ rows }: { rows: CapacityCompany[] }) {
  const { wrap, show, hide, node } = useChartTip();
  // BTBT-style parent rows repeat their subsidiary's MW and EV — plotting both
  // would stack two dots on one point.
  const pts = rows.filter((c) => c.ev_per_mw != null && c.pct_energized != null && c.dupe !== "parent");
  const excluded = rows.filter((c) => !pts.includes(c));
  if (!pts.length) {
    return <p className="cap-empty">No priced rows in this cohort. EV per MW is withheld for hyperscalers and private builders, whose enterprise value isn&apos;t tied to AI megawatts.</p>;
  }
  const evs = pts.map((c) => c.ev_per_mw as number);
  const lo = Math.max(1, Math.min(...evs) * 0.7), hi = Math.max(...evs) * 1.4;
  const ticks = LOG_TICKS.filter((t) => t >= lo && t <= hi);
  const xmax = Math.max(50, Math.ceil((Math.max(...pts.map((c) => c.pct_energized as number)) + 6) / 10) * 10);
  const INSET = 16; // keep 0%-energized dots off the y-axis line
  const X = (v: number) => M.l + INSET + (v / xmax) * (W - M.l - M.r - INSET);
  const Y = (v: number) => H - M.b - ((Math.log(v) - Math.log(lo)) / (Math.log(hi) - Math.log(lo))) * (H - M.t - M.b);
  const maxW = Math.max(...pts.map((c) => c.wmw), 1);
  const R = (c: CapacityCompany) => 5 + Math.sqrt(c.wmw / maxW) * 20;
  const median = medianOf(evs);

  // Greedy label placement: biggest dots claim space first; a label that
  // can't find a clear slot is dropped (the tooltip and the table carry it).
  const placed: Box[] = [];
  const labels = new Map<string, { x: number; y: number; anchor: "start" | "end" | "middle" }>();
  for (const c of [...pts].sort((a, b) => b.wmw - a.wmw)) {
    const cx = X(c.pct_energized as number), cy = Y(c.ev_per_mw as number), r = R(c);
    const w = c.t.length * 7.4 + 4, h = 13;
    const cands: [number, number, "start" | "end" | "middle", Box][] = [
      [cx + r + 4, cy + 4, "start", { x: cx + r + 3, y: cy - 8, w, h }],
      [cx - r - 4, cy + 4, "end", { x: cx - r - 3 - w, y: cy - 8, w, h }],
      [cx, cy - r - 5, "middle", { x: cx - w / 2, y: cy - r - 17, w, h }],
      [cx, cy + r + 13, "middle", { x: cx - w / 2, y: cy + r + 1, w, h }],
    ];
    const ok = cands.find(([, , , b]) => b.x >= M.l && b.x + b.w <= W - M.r && b.y >= M.t - 4 && b.y + b.h <= H - M.b && !placed.some((p) => hit(p, b)));
    if (ok) { placed.push(ok[3]); labels.set(c.t, { x: ok[0], y: ok[1], anchor: ok[2] }); }
  }

  const groups = (Object.keys(GROUP) as Group[]).filter((g) => pts.some((c) => groupOf(c) === g));
  const tipBody = (c: CapacityCompany) => (
    <>
      <strong>{c.n}</strong>
      <span>{GROUP[groupOf(c)].short}</span>
      <dl>
        <dt>EV per MW</dt><dd>{fmtM(c.ev_per_mw as number)}{c.stale ? " (stale quote)" : ""}</dd>
        <dt>Energized</dt><dd>{c.pct_energized}%</dd>
        <dt>Weighted MW</dt><dd>{fmtMW(c.wmw)}</dd>
        <dt>Backlog ÷ EV</dt><dd>{c.coverage != null ? `${c.coverage}×` : "—"}</dd>
      </dl>
    </>
  );

  return (
    <div className="cap-viz">
      <div className="cap-viz-head">
        <div>
          <h3>What the market pays per megawatt, against how much is already live</h3>
          <p>Each dot is a company: enterprise value per weighted MW (log scale) against the share of its capacity that is energized. Dot area is weighted MW.</p>
        </div>
        <ul className="cap-key">
          {groups.map((g) => (
            <li key={g}><i className={`cap-dot cap-dot-${g}`} aria-hidden />{GROUP[g].label}</li>
          ))}
        </ul>
      </div>
      <div className="dashboard-panel cap-chart" ref={wrap} onPointerLeave={hide}>
        <svg viewBox={`0 0 ${W} ${H}`} role="img"
          aria-label={`EV per megawatt against percent energized for ${pts.length} companies; median ${fmtM(median)} per MW. Full values in the table below.`}>
          {ticks.map((t) => (
            <g key={t}>
              <line x1={M.l} y1={Y(t)} x2={W - M.r} y2={Y(t)} className="cap-grid" />
              <text x={M.l - 8} y={Y(t) + 4} textAnchor="end" className="cap-tick">${t}M</text>
            </g>
          ))}
          {Array.from({ length: xmax / 10 + 1 }, (_, i) => i * 10).map((v) => (
            <g key={v}>
              {v > 0 && <line x1={X(v)} y1={M.t} x2={X(v)} y2={H - M.b} className="cap-grid" />}
              <text x={X(v)} y={H - M.b + 20} textAnchor="middle" className="cap-tick">{v}%</text>
            </g>
          ))}
          <line x1={M.l} y1={H - M.b} x2={W - M.r} y2={H - M.b} className="cap-axis" />
          <line x1={M.l} y1={Y(median)} x2={W - M.r} y2={Y(median)} className="cap-ref" />
          <text x={W - M.r - 4} y={Y(median) - 6} textAnchor="end" className="cap-ref-label">median {fmtM(median)} per MW</text>
          <text x={M.l + 8} y={M.t + 12} className="cap-corner">Priced for capacity not yet built</text>
          <text x={W - M.r - 8} y={H - M.b - 10} textAnchor="end" className="cap-corner">Energized and cheaper per MW</text>
          <text x={(M.l + W - M.r) / 2} y={H - 8} textAnchor="middle" className="cap-axis-title">Share of capacity energized (operational ÷ total)</text>
          {[...pts].sort((a, b) => b.wmw - a.wmw).map((c) => {
            const g = groupOf(c);
            const hollow = g === "other";
            return (
              <circle key={c.t} cx={X(c.pct_energized as number)} cy={Y(c.ev_per_mw as number)} r={R(c)}
                className="cap-mark" tabIndex={0} aria-label={`${c.n}: ${fmtM(c.ev_per_mw as number)} per MW, ${c.pct_energized}% energized`}
                fill={GROUP[g].color} fillOpacity={hollow ? 0 : 0.78}
                stroke={hollow ? GROUP[g].color : "var(--card)"} strokeWidth={2}
                onPointerMove={(e) => show(e, tipBody(c))} onFocus={(e) => show(e, tipBody(c))} onBlur={hide} />
            );
          })}
          {pts.map((c) => {
            const l = labels.get(c.t);
            return l && <text key={c.t} x={l.x} y={l.y} textAnchor={l.anchor} className="cap-label">{c.t}</text>;
          })}
        </svg>
        {node}
      </div>
      <div className="capacity-site-table">
        <table className="cap-table">
          <caption>Cheapest per megawatt first, within each business type</caption>
          <thead>
            <tr>
              <th scope="col">Company</th><th scope="col">Type</th>
              <th scope="col" className="num">EV per MW</th><th scope="col" className="num">Energized</th>
              <th scope="col" className="num">Weighted MW</th><th scope="col" className="num">Backlog ÷ EV</th>
            </tr>
          </thead>
          {/* GPU clouds rent out compute; landlords lease powered shells.
              Different businesses, so EV per MW is only compared within a type,
              each with its own median. */}
          {groups.map((g) => {
            const grp = pts.filter((c) => groupOf(c) === g)
              .sort((a, b) => (a.ev_per_mw as number) - (b.ev_per_mw as number));
            return (
              <tbody key={g}>
                <tr className="cap-table-group">
                  <th scope="colgroup" colSpan={6}>
                    <i className={`cap-dot cap-dot-${g}`} aria-hidden /> {GROUP[g].label}
                    <span className="cap-muted"> · {grp.length} · median {fmtM(medianOf(grp.map((c) => c.ev_per_mw as number)))} per MW</span>
                  </th>
                </tr>
                {grp.map((c) => (
                  <tr key={c.t}>
                    <td><i className={`cap-dot cap-dot-${g}`} aria-hidden /> {c.n} <span className="cap-muted">{c.t}</span></td>
                    <td className="cap-muted">{GROUP[g].short}</td>
                    <td className="num">{fmtM(c.ev_per_mw as number)}{c.stale ? "*" : ""}</td>
                    <td className="num">{c.pct_energized}%</td>
                    <td className="num">{fmtMW(c.wmw)}</td>
                    <td className="num">{c.coverage != null ? `${c.coverage}×` : "—"}</td>
                  </tr>
                ))}
              </tbody>
            );
          })}
        </table>
      </div>
      <p className="cap-viz-note">
        Weighted MW = operational + half of construction + a quarter of planned. Valuations reprice every morning.
        {excluded.length > 0 && <> Not plotted: {excluded.map((c) => c.t).join(", ")} — EV per MW is withheld for hyperscalers and private builders (enterprise value isn&apos;t tied to AI megawatts){excluded.some((c) => c.ev_note) ? <>, for companies whose EV prices a much larger business than their AI megawatts ({excluded.filter((c) => c.ev_note).map((c) => c.t).join(", ")})</> : ""}{excluded.some((c) => c.dupe === "parent") ? ", and parent rows that repeat a subsidiary" : ""}.</>}
      </p>
    </div>
  );
}
