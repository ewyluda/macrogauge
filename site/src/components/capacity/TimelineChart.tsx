"use client";
import type { CapacityTimeline } from "@/lib/types";

const W = 1000, H = 420, M = { l: 70, r: 26, t: 20, b: 44 };
const fmtMW = (mw: number) => (mw >= 10_000 ? `${(mw / 1000).toFixed(1)} GW` : `${Math.round(mw).toLocaleString("en-US")} MW`);

export function TimelineChart({ timeline }: { timeline: CapacityTimeline }) {
  const pts = timeline.points;
  if (!pts.length) return <p style={{ color: "var(--muted)" }}>No dated construction sites in this cohort.</p>;
  const ymax = Math.max(...pts.map((p) => p.cum_mw)) * 1.08;
  const X = (i: number) => M.l + ((i + 1) / (pts.length + 1)) * (W - M.l - M.r);
  const Y = (v: number) => H - M.b - (v / ymax) * (H - M.t - M.b);
  let d = `M ${M.l} ${Y(timeline.base_mw)}`;
  let prev = timeline.base_mw;
  pts.forEach((p, i) => { d += ` L ${X(i)} ${Y(prev)} L ${X(i)} ${Y(p.cum_mw)}`; prev = p.cum_mw; });
  const area = `${d} L ${X(pts.length - 1)} ${Y(0)} L ${M.l} ${Y(0)} Z`;
  return (
    <div>
      <div className="dashboard-panel" style={{ overflowX: "auto" }}>
        <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Cumulative MW energizing by quarter">
          {[0.25, 0.5, 0.75, 1].map((f) => (
            <g key={f}>
              <line x1={M.l} y1={Y(ymax * f)} x2={W - M.r} y2={Y(ymax * f)} stroke="var(--border)" />
              <text x={M.l - 8} y={Y(ymax * f) + 4} textAnchor="end" fontSize="11" fill="var(--muted)">{fmtMW(ymax * f)}</text>
            </g>
          ))}
          <path d={area} fill="var(--accent-sky, #5eb0ef)" fillOpacity="0.10" />
          <path d={d} fill="none" stroke="var(--accent-sky, #5eb0ef)" strokeWidth="2" />
          {pts.map((p, i) => (
            <g key={p.q}>
              {(i % 2 === 0 || i === pts.length - 1) && (
                <text x={X(i)} y={H - M.b + 18} textAnchor="middle" fontSize="11" fill="var(--muted)">{p.q}</text>
              )}
              <circle cx={X(i)} cy={Y(p.cum_mw)} r="3.5" fill="var(--accent-sky, #5eb0ef)">
                <title>{`${p.q}: +${fmtMW(p.add_mw)} → ${fmtMW(p.cum_mw)} cumulative`}</title>
              </circle>
            </g>
          ))}
        </svg>
      </div>
      <p style={{ fontSize: 11.5, color: "var(--muted)", margin: "8px 2px" }}>
        Cumulative critical-IT MW coming online, from disclosed construction-stage energization dates
        (operational MW is the {fmtMW(timeline.base_mw)} baseline; undated sites excluded, so the curve
        understates the pipeline — and slippage is common).
      </p>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: 8 }}>
        {Object.entries(timeline.milestones).map(([q, items]) => (
          <div key={q} className="dashboard-panel" style={{ padding: "10px 12px" }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: "var(--accent-sky, #5eb0ef)", marginBottom: 4 }}>{q}</div>
            {items.map(([t, site, mw], i) => (
              <div key={i} style={{ fontSize: 12, color: "var(--muted)", padding: "1px 0" }}>
                <b style={{ color: "var(--text)" }}>{t}</b> {site} — {fmtMW(mw)}
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
