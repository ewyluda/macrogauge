"use client";
import type { CapacityCompany } from "@/lib/types";

const W = 1000, H = 460, M = { l: 70, r: 30, t: 20, b: 50 };

export function ValuationScatter({ rows }: { rows: CapacityCompany[] }) {
  const pts = rows.filter((c) => c.ev_per_mw != null && c.pct_energized != null);
  const excluded = rows.filter((c) => !pts.includes(c)).map((c) => c.t);
  if (!pts.length) return <p style={{ color: "var(--muted)" }}>No priced rows in this cohort — EV/MW is suppressed for hyperscalers and private builders.</p>;
  const ymax = Math.max(...pts.map((c) => c.ev_per_mw as number)) * 1.15;
  const X = (v: number) => M.l + (v / 100) * (W - M.l - M.r);
  const Y = (v: number) => H - M.b - (v / ymax) * (H - M.t - M.b);
  const R = (c: CapacityCompany) => Math.max(5, Math.sqrt(c.wmw) / 3);
  return (
    <div className="dashboard-panel" style={{ overflowX: "auto" }}>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="EV per megawatt vs percent energized">
        {[0, 25, 50, 75, 100].map((v) => (
          <g key={v}>
            <line x1={X(v)} y1={M.t} x2={X(v)} y2={H - M.b} stroke="var(--border)" />
            <text x={X(v)} y={H - M.b + 18} textAnchor="middle" fontSize="11" fill="var(--muted)">{v}%</text>
          </g>
        ))}
        {[0.25, 0.5, 0.75, 1].map((f) => (
          <g key={f}>
            <line x1={M.l} y1={Y(ymax * f)} x2={W - M.r} y2={Y(ymax * f)} stroke="var(--border)" />
            <text x={M.l - 8} y={Y(ymax * f) + 4} textAnchor="end" fontSize="11" fill="var(--muted)">
              ${Math.round(ymax * f)}M
            </text>
          </g>
        ))}
        <text x={W / 2} y={H - 8} textAnchor="middle" fontSize="11" fill="var(--muted)">% ENERGIZED (op / total) →</text>
        <text x={16} y={H / 2} transform={`rotate(-90 16 ${H / 2})`} textAnchor="middle" fontSize="11" fill="var(--muted)">EV / WEIGHTED MW ($M) →</text>
        {pts.map((c) => (
          <g key={c.t}>
            <circle cx={X(c.pct_energized as number)} cy={Y(c.ev_per_mw as number)} r={R(c)}
              fill="var(--accent-sky, #5eb0ef)" fillOpacity="0.25" stroke="var(--accent-sky, #5eb0ef)">
              <title>{`${c.n} — $${(c.ev_per_mw as number).toFixed(1)}M/MW · ${c.pct_energized}% energized · ${Math.round(c.wmw)} weighted MW`}</title>
            </circle>
            <text x={X(c.pct_energized as number)} y={Y(c.ev_per_mw as number) - R(c) - 4}
              textAnchor="middle" fontSize="10.5" fontWeight="700" fill="var(--text)">{c.t}</text>
          </g>
        ))}
      </svg>
      <p style={{ fontSize: 11.5, color: "var(--muted)", margin: "6px 8px" }}>
        Dot size = weighted MW (op + 0.5·construction + 0.25·planned). Priced daily.
        {excluded.length > 0 && <> Not plotted (EV/MW suppressed or unpriced): {excluded.join(", ")}.</>}
      </p>
    </div>
  );
}
