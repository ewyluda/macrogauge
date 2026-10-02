"use client";
import { useState } from "react";
import type { Capacity } from "@/lib/types";
import { useChartTip } from "./ChartTip";

const W = 1000, PAD = 28, GAP = 14, MIN_SLOT = 34, BAR = 10;
const XL = 300, XR = W - 300;
const fmtMW = (mw: number | null) =>
  mw == null ? "MW undisclosed" : mw >= 1000 ? `${(mw / 1000).toFixed(1)} GW` : `${Math.round(mw).toLocaleString("en-US")} MW`;
const inferred = (terms: string) => /MW inferred/i.test(terms);
const short = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

type Edge = { i: number; tenant: string; prov: string; mw: number | null; terms: string; w: number };
type Node = { key: string; edges: Edge[]; total: number; y: number; h: number };

export function DemandMap({ data, visible }: { data: Capacity; visible: Set<string> }) {
  const { wrap, show, hide, node: tipNode } = useChartTip();
  const [focus, setFocus] = useState<string | null>(null);
  const names = new Map(data.companies.map((c) => [c.t, c.n]));
  const raw = data.tenants.filter(([, prov]) => visible.has(prov));
  if (!raw.length) return <p className="cap-empty">No disclosed tenant relationships in this cohort. Switch to All to see every disclosed deal.</p>;

  // Ribbon width on a square-root scale: one multi-GW deal no longer turns
  // every other relationship into a hairline.
  const maxMW = Math.max(...raw.map((e) => e[2] ?? 0), 1);
  const edges: Edge[] = raw.map(([tenant, prov, mw, terms], i) => ({
    i, tenant, prov, mw, terms, w: mw == null ? 2 : Math.max(3, Math.sqrt(mw / maxMW) * 34),
  }));
  const build = (key: (e: Edge) => string): Node[] => {
    const m = new Map<string, Node>();
    for (const e of edges) {
      const k = key(e);
      const n = m.get(k) ?? { key: k, edges: [], total: 0, y: 0, h: 0 };
      n.edges.push(e); n.total += e.mw ?? 0; m.set(k, n);
    }
    return [...m.values()];
  };
  const tenants = build((e) => e.tenant).sort((a, b) => b.total - a.total || b.edges.length - a.edges.length);
  const provs = build((e) => e.prov);
  // Providers sit at the MW-weighted mean position of their tenants, which
  // untangles most crossings in one pass.
  const tIdx = new Map(tenants.map((n, i) => [n.key, i]));
  const bary = (n: Node) => {
    const wsum = n.edges.reduce((s, e) => s + e.w, 0);
    return n.edges.reduce((s, e) => s + (tIdx.get(e.tenant) as number) * e.w, 0) / wsum;
  };
  provs.sort((a, b) => bary(a) - bary(b));

  const layout = (col: Node[]) => {
    let y = 0;
    for (const n of col) {
      n.h = n.edges.reduce((s, e) => s + e.w, 0) + (n.edges.length - 1) * 1;
      const slot = Math.max(n.h, MIN_SLOT);
      n.y = y + (slot - n.h) / 2;
      y += slot + GAP;
    }
    return y - GAP;
  };
  const hL = layout(tenants), hR = layout(provs);
  const H = PAD * 2 + Math.max(hL, hR);
  const offL = PAD + (Math.max(hL, hR) - hL) / 2, offR = PAD + (Math.max(hL, hR) - hR) / 2;
  const pIdx = new Map(provs.map((n, i) => [n.key, i]));

  // Ports: each node stacks its ribbons ordered by the far end's position.
  const portL = new Map<number, number>(), portR = new Map<number, number>();
  for (const n of tenants) {
    let y = offL + n.y;
    for (const e of [...n.edges].sort((a, b) => (pIdx.get(a.prov) as number) - (pIdx.get(b.prov) as number))) { portL.set(e.i, y); y += e.w + 1; }
  }
  for (const n of provs) {
    let y = offR + n.y;
    for (const e of [...n.edges].sort((a, b) => (tIdx.get(a.tenant) as number) - (tIdx.get(b.tenant) as number))) { portR.set(e.i, y); y += e.w + 1; }
  }
  const ribbon = (e: Edge) => {
    const y0 = portL.get(e.i) as number, y1 = portR.get(e.i) as number;
    const a = XL + BAR, b = XR, mx = (a + b) / 2;
    return `M ${a} ${y0} C ${mx} ${y0}, ${mx} ${y1}, ${b} ${y1} L ${b} ${y1 + e.w} C ${mx} ${y1 + e.w}, ${mx} ${y0 + e.w}, ${a} ${y0 + e.w} Z`;
  };
  const lit = (e: Edge) => !focus || focus === e.tenant || focus === `p:${e.prov}`;
  const nodeTip = (n: Node, side: "t" | "p") => (
    <>
      <strong>{side === "p" ? names.get(n.key) ?? n.key : n.key}</strong>
      <span>{n.total > 0 ? `${fmtMW(n.total)} disclosed` : "MW undisclosed"} across {n.edges.length} deal{n.edges.length > 1 ? "s" : ""}</span>
      <ul>
        {n.edges.map((e) => <li key={e.i}>{side === "t" ? names.get(e.prov) ?? e.prov : e.tenant} — {fmtMW(e.mw)}</li>)}
      </ul>
    </>
  );
  const edgeTip = (e: Edge) => (
    <>
      <strong>{e.tenant} → {names.get(e.prov) ?? e.prov}</strong>
      <span>{fmtMW(e.mw)}{e.mw != null && inferred(e.terms) ? " (inferred)" : ""}</span>
      {e.terms && <p>{e.terms}</p>}
    </>
  );

  return (
    <div className="cap-viz">
      <div className="cap-viz-head">
        <div>
          <h3>Who has signed for whose capacity</h3>
          <p>Disclosed leases and compute contracts, from the buyer on the left to the provider on the right. Ribbon width follows committed critical-IT MW.</p>
        </div>
        <ul className="cap-key">
          <li><i className="cap-ribbon-key" aria-hidden />MW disclosed</li>
          <li><i className="cap-ribbon-key cap-ribbon-key-inf" aria-hidden />MW inferred from deal value</li>
          <li><i className="cap-ribbon-key cap-ribbon-key-nd" aria-hidden />MW undisclosed</li>
        </ul>
      </div>
      <div className="dashboard-panel cap-chart" ref={wrap} onPointerLeave={() => { hide(); setFocus(null); }}>
        <div className="cap-scroll">
        <svg viewBox={`0 0 ${W} ${H}`} role="img" style={{ minWidth: 760 }}
          aria-label={`${edges.length} disclosed capacity deals between ${tenants.length} buyers and ${provs.length} providers. Full list in the table below.`}>
          <text x={XL + BAR} y={14} textAnchor="end" className="cap-col-head">Buyer</text>
          <text x={XR} y={14} className="cap-col-head">Provider</text>
          {edges.map((e) => (
            e.mw == null ? (
              <path key={e.i} className={`cap-flow-nd${lit(e) ? "" : " is-dim"}`}
                d={`M ${XL + BAR} ${(portL.get(e.i) as number) + 1} C ${(XL + XR) / 2} ${(portL.get(e.i) as number) + 1}, ${(XL + XR) / 2} ${(portR.get(e.i) as number) + 1}, ${XR} ${(portR.get(e.i) as number) + 1}`}
                onPointerMove={(ev) => show(ev, edgeTip(e))} />
            ) : (
              <path key={e.i} d={ribbon(e)} className={`cap-flow${inferred(e.terms) ? " cap-flow-inf" : ""}${lit(e) ? "" : " is-dim"}`}
                onPointerMove={(ev) => show(ev, edgeTip(e))} />
            )
          ))}
          {tenants.map((n) => {
            const cy = offL + n.y + n.h / 2;
            return (
              <g key={n.key} className="cap-node" tabIndex={0} aria-label={`${n.key}: ${fmtMW(n.total || null)}, ${n.edges.length} deals`}
                onPointerEnter={() => setFocus(n.key)} onPointerMove={(ev) => show(ev, nodeTip(n, "t"))}
                onFocus={(ev) => { setFocus(n.key); show(ev, nodeTip(n, "t")); }} onBlur={() => { setFocus(null); hide(); }}>
                <rect x={XL} y={offL + n.y} width={BAR} height={Math.max(n.h, 2)} rx={2} className="cap-node-bar" />
                <rect x={XL - 290} y={cy - 16} width={300} height={32} fill="transparent" />
                <text x={XL - 8} y={cy - 2} textAnchor="end" className="cap-node-name">{short(n.key, 34)}</text>
                <text x={XL - 8} y={cy + 13} textAnchor="end" className="cap-node-sub">
                  {n.total > 0 ? fmtMW(n.total) : "MW undisclosed"} · {n.edges.length} deal{n.edges.length > 1 ? "s" : ""}
                </text>
              </g>
            );
          })}
          {provs.map((n) => {
            const cy = offR + n.y + n.h / 2;
            return (
              <g key={n.key} className="cap-node" tabIndex={0} aria-label={`${names.get(n.key) ?? n.key}: ${fmtMW(n.total || null)} contracted`}
                onPointerEnter={() => setFocus(`p:${n.key}`)} onPointerMove={(ev) => show(ev, nodeTip(n, "p"))}
                onFocus={(ev) => { setFocus(`p:${n.key}`); show(ev, nodeTip(n, "p")); }} onBlur={() => { setFocus(null); hide(); }}>
                <rect x={XR} y={offR + n.y} width={BAR} height={Math.max(n.h, 2)} rx={2} className="cap-node-bar" />
                <rect x={XR} y={cy - 16} width={290} height={32} fill="transparent" />
                <text x={XR + BAR + 8} y={cy - 2} className="cap-node-name">{short(names.get(n.key) ?? n.key, 30)}</text>
                <text x={XR + BAR + 8} y={cy + 13} className="cap-node-sub">{n.key} · {n.total > 0 ? fmtMW(n.total) : "MW undisclosed"}</text>
              </g>
            );
          })}
        </svg>
        </div>
        {tipNode}
      </div>
      <div className="capacity-site-table">
        <table className="cap-table">
          <caption>Every disclosed deal, largest first</caption>
          <thead>
            <tr><th scope="col">Buyer</th><th scope="col">Provider</th><th scope="col" className="num">MW</th><th scope="col">Terms</th></tr>
          </thead>
          <tbody>
            {[...edges].sort((a, b) => (b.mw ?? -1) - (a.mw ?? -1)).map((e) => (
              <tr key={e.i}>
                <td>{e.tenant}</td>
                <td>{names.get(e.prov) ?? e.prov} <span className="cap-muted">{e.prov}</span></td>
                <td className="num">{e.mw != null ? `${e.mw.toLocaleString("en-US")}${inferred(e.terms) ? "*" : ""}` : "n/d"}</td>
                <td className="cap-terms">{e.terms}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="cap-viz-note">Disclosed deals only. * MW inferred from deal value, not stated by either party. Hyperscalers&apos; self-built capacity isn&apos;t a deal and doesn&apos;t appear here.</p>
    </div>
  );
}
