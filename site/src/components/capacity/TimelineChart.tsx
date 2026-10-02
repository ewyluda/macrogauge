"use client";
import { useState } from "react";
import type { CapacityTimeline } from "@/lib/types";
import { useChartTip } from "./ChartTip";

const W = 1000, H = 300, M = { l: 64, r: 16, t: 26, b: 36 };
const BAR = 30;
const fmtMW = (mw: number) => (mw >= 1000 ? `${(mw / 1000).toFixed(1)} GW` : `${Math.round(mw).toLocaleString("en-US")} MW`);
const qLabel = (q: string) => `${q.slice(4)} ${q.slice(0, 4)}`;
const STEPS = [100, 250, 500, 1000, 2000, 2500, 5000, 10000];

/** Column with a 4px rounded data-end and a square baseline. */
const column = (x: number, y: number, w: number, base: number) => {
  const r = Math.min(4, (base - y) / 2);
  return `M ${x} ${base} V ${y + r} Q ${x} ${y} ${x + r} ${y} H ${x + w - r} Q ${x + w} ${y} ${x + w} ${y + r} V ${base} Z`;
};

export function TimelineChart({ timeline }: { timeline: CapacityTimeline }) {
  const { wrap, show, hide, node } = useChartTip();
  const [active, setActive] = useState<string | null>(null);
  const pts = timeline.points;
  const dated = pts.filter((p) => p.add_mw > 0);
  if (!dated.length) return <p className="cap-empty">No dated construction sites in this cohort. Undated sites are left off the timeline rather than guessed.</p>;

  const added = dated.reduce((s, p) => s + p.add_mw, 0);
  const peak = dated.reduce((a, b) => (b.add_mw > a.add_mw ? b : a));
  const nSites = Object.values(timeline.milestones).reduce((s, v) => s + v.length, 0);
  const maxAdd = Math.max(...pts.map((p) => p.add_mw));
  const step = STEPS.find((s) => maxAdd / s <= 5) ?? 10000;
  const ymax = Math.ceil((maxAdd * 1.08) / step) * step;
  const slot = (W - M.l - M.r) / pts.length;
  const X = (i: number) => M.l + slot * i + slot / 2;
  const Y = (v: number) => H - M.b - (v / ymax) * (H - M.t - M.b);
  const maxSite = Math.max(...Object.values(timeline.milestones).flat().map((m) => m[2]), 1);

  const tip = (q: string, add: number, cum: number) => (
    <>
      <strong>{qLabel(q)}</strong>
      <span>+{fmtMW(add)} energizing · {fmtMW(cum - timeline.base_mw)} above today&apos;s operational base</span>
      <ul>
        {(timeline.milestones[q] ?? []).slice().sort((a, b) => b[2] - a[2]).slice(0, 6).map(([t, site, mw], i) => (
          <li key={i}>{t} — {site}, {fmtMW(mw)}</li>
        ))}
        {(timeline.milestones[q]?.length ?? 0) > 6 && <li>and {(timeline.milestones[q]?.length ?? 0) - 6} more below</li>}
      </ul>
    </>
  );

  return (
    <div className="cap-viz">
      <dl className="cap-figures">
        <div><dt>Operational today</dt><dd>{fmtMW(timeline.base_mw)}</dd></div>
        <div><dt>Dated to energize by {qLabel(dated[dated.length - 1].q)}</dt><dd>+{fmtMW(added)}</dd></div>
        <div><dt>Biggest quarter</dt><dd>{qLabel(peak.q)} <small>+{fmtMW(peak.add_mw)}</small></dd></div>
        <div><dt>Construction sites with a date</dt><dd>{nSites}</dd></div>
      </dl>
      <div className="cap-viz-head">
        <div>
          <h3>Critical-IT capacity scheduled to energize, by quarter</h3>
          <p>Construction-stage sites with a disclosed first-power date. Undated sites are left out, so this understates the pipeline, and slippage is common.</p>
        </div>
      </div>
      <div className="dashboard-panel cap-chart" ref={wrap} onPointerLeave={() => { hide(); setActive(null); }}>
        <div className="cap-scroll">
        <svg viewBox={`0 0 ${W} ${H}`} role="img" style={{ minWidth: 640 }}
          aria-label={`MW energizing per quarter: ${dated.map((p) => `${qLabel(p.q)} ${fmtMW(p.add_mw)}`).join(", ")}.`}>
          {Array.from({ length: Math.round(ymax / step) + 1 }, (_, i) => i * step).map((v) => (
            <g key={v}>
              <line x1={M.l} y1={Y(v)} x2={W - M.r} y2={Y(v)} className={v === 0 ? "cap-axis" : "cap-grid"} />
              <text x={M.l - 8} y={Y(v) + 4} textAnchor="end" className="cap-tick">{v === 0 ? "0" : fmtMW(v)}</text>
            </g>
          ))}
          {pts.map((p, i) => {
            const on = active === p.q;
            return (
              <g key={p.q}>
                {p.add_mw > 0 && (
                  <>
                    <path d={column(X(i) - BAR / 2, Y(p.add_mw), BAR, Y(0))} className={`cap-col${active && !on ? " is-dim" : ""}`} />
                    {p.add_mw >= maxAdd * 0.15 && (
                      <text x={X(i)} y={Y(p.add_mw) - 7} textAnchor="middle" className="cap-col-value">{fmtMW(p.add_mw)}</text>
                    )}
                  </>
                )}
                <text x={X(i)} y={H - M.b + 20} textAnchor="middle" className={`cap-tick${on ? " is-on" : ""}`}>{qLabel(p.q)}</text>
                {/* full-height hit target, wider than the column */}
                <rect x={X(i) - slot / 2} y={M.t} width={slot} height={H - M.t - M.b} fill="transparent"
                  tabIndex={p.add_mw > 0 ? 0 : -1} aria-label={`${qLabel(p.q)}: ${fmtMW(p.add_mw)}`}
                  onPointerEnter={() => setActive(p.q)} onPointerMove={(e) => p.add_mw > 0 && show(e, tip(p.q, p.add_mw, p.cum_mw))}
                  onFocus={(e) => { setActive(p.q); if (p.add_mw > 0) show(e, tip(p.q, p.add_mw, p.cum_mw)); }} onBlur={() => { setActive(null); hide(); }}
                  onClick={() => document.getElementById(`cap-q-${p.q}`)?.scrollIntoView({ behavior: "smooth", block: "nearest" })} />
              </g>
            );
          })}
        </svg>
        </div>
        {node}
      </div>
      <ol className="cap-quarters">
        {Object.entries(timeline.milestones).map(([q, items]) => {
          const total = items.reduce((s, m) => s + m[2], 0);
          return (
            <li key={q} id={`cap-q-${q}`} className={active === q ? "is-on" : undefined}>
              <div className="cap-quarter-head">
                <strong>{qLabel(q)}</strong>
                <span>+{fmtMW(total)}</span>
                <small>{items.length} site{items.length > 1 ? "s" : ""}</small>
              </div>
              <table className="cap-quarter-sites">
                <tbody>
                  {items.slice().sort((a, b) => b[2] - a[2]).map(([t, site, mw], i) => (
                    <tr key={i}>
                      <td className="cap-ticker">{t}</td>
                      <td>{site}</td>
                      <td className="num">{fmtMW(mw)}</td>
                      <td className="cap-minibar-cell" aria-hidden><i className="cap-minibar" style={{ width: `${(mw / maxSite) * 100}%` }} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
