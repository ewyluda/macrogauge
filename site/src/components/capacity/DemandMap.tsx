"use client";
import type { Capacity } from "@/lib/types";

const W = 1000, ROW = 46, PAD = 30;
const fmtMW = (mw: number) => `${Math.round(mw).toLocaleString("en-US")} MW`;

export function DemandMap({ data, visible }: { data: Capacity; visible: Set<string> }) {
  const edges = data.tenants.filter(([, landlord]) => visible.has(landlord));
  if (!edges.length) return <p style={{ color: "var(--muted)" }}>No disclosed tenant relationships in this cohort.</p>;
  const tenants = [...new Set(edges.map((e) => e[0]))];
  const landlords = [...new Set(edges.map((e) => e[1]))];
  const H = PAD * 2 + Math.max(tenants.length, landlords.length) * ROW;
  const ty = (t: string) => PAD + tenants.indexOf(t) * ROW + ROW / 2;
  const ly = (l: string) => PAD + landlords.indexOf(l) * ROW + ROW / 2;
  const maxMW = Math.max(...edges.map((e) => e[2]), 1);
  const xL = 250, xR = W - 190;
  return (
    <div className="dashboard-panel" style={{ overflowX: "auto" }}>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Tenant to landlord capacity commitments">
        <text x={xL - 10} y={14} textAnchor="end" fontSize="10" fill="var(--muted)" letterSpacing=".1em">TENANT / ANCHOR</text>
        <text x={xR + 10} y={14} fontSize="10" fill="var(--muted)" letterSpacing=".1em">LANDLORD / OPERATOR</text>
        {edges.map(([tenant, landlord, mw, terms], i) => (
          <path key={i}
            d={`M ${xL} ${ty(tenant)} C ${xL + 180} ${ty(tenant)}, ${xR - 180} ${ly(landlord)}, ${xR} ${ly(landlord)}`}
            fill="none" stroke="var(--accent-sky, #5eb0ef)" strokeOpacity="0.45"
            strokeWidth={Math.max(1.5, (mw / maxMW) * 14)}>
            <title>{`${tenant} → ${landlord}: ${fmtMW(mw)}${terms ? ` · ${terms}` : ""}`}</title>
          </path>
        ))}
        {tenants.map((t) => (
          <text key={t} x={xL - 10} y={ty(t) + 4} textAnchor="end" fontSize="12" fill="var(--text)">{t}</text>
        ))}
        {landlords.map((l) => (
          <text key={l} x={xR + 10} y={ly(l) + 4} fontSize="12" fill="var(--text)">{l}</text>
        ))}
      </svg>
      <p style={{ fontSize: 11.5, color: "var(--muted)", margin: "6px 8px" }}>
        Edge width = committed critical-IT MW. Hover an edge for lease terms. Disclosed deals only.
      </p>
    </div>
  );
}
