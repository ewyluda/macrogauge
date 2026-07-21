"use client";
import { useState } from "react";
import type { CapacityCompany } from "@/lib/types";

const SEG = { op: "var(--accent-amber, #f4c64a)", con: "var(--accent-sky, #5eb0ef)", plan: "var(--muted)" };
const fmtMW = (mw: number) => (mw >= 10_000 ? `${(mw / 1000).toFixed(1)} GW` : `${Math.round(mw).toLocaleString("en-US")} MW`);
const money = (b: number | null | undefined) =>
  b == null ? "—" : b >= 1000 ? `$${(b / 1000).toFixed(2)}T` : `$${b.toFixed(b < 10 ? 2 : 1)}B`;

function Detail({ c }: { c: CapacityCompany }) {
  const kv: [string, string][] = [
    ["Market cap", c.private ? `${money(c.valuation_b)} (last round, private)`
      : c.stale && c.cap != null ? `${money(c.cap)} (stale — priced ${c.priced_date})`
      : money(c.cap)],
    ["EV", money(c.ev)],
    ["EV / weighted MW", c.ev_per_mw != null ? `$${c.ev_per_mw.toFixed(1)}M` :
      c.private ? "— (private)" : c.role === "hyperscaler" ? "— (conglomerate EV; not meaningful per AI MW)" : "—"],
    ["% energized", c.pct_energized != null ? `${c.pct_energized}%` : "—"],
    ["Backlog coverage", c.coverage != null ? `${c.coverage}× EV` : "—"],
    ["Net debt", c.nd != null ? money(c.nd) : "—"],
    ...(Object.entries(c.econ ?? {}).map(([k, v]) => [k, v] as [string, string])),
  ];
  return (
    <div style={{ padding: "10px 14px 14px", borderTop: "1px solid var(--border)" }}>
      {c.ndflag && <p style={{ fontSize: 12, color: "var(--muted)", margin: "6px 0" }}>{c.ndflag}</p>}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 8, margin: "10px 0" }}>
        {kv.map(([k, v]) => (
          <div key={k} style={{ border: "1px solid var(--border)", borderRadius: 8, padding: "7px 10px" }}>
            <div style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: ".08em", color: "var(--muted)" }}>{k}</div>
            <div style={{ fontSize: 13 }}>{v}</div>
          </div>
        ))}
      </div>
      {c.sites.length > 0 && (
        <table style={{ width: "100%", fontSize: 12.5, borderCollapse: "collapse" }}>
          <tbody>
            {c.sites.map(([name, mw, st, when], i) => (
              <tr key={i} style={{ borderBottom: "1px dashed var(--border)" }}>
                <td style={{ padding: "3px 8px 3px 0", width: 90, color: "var(--muted)" }}>{mw != null ? fmtMW(mw) : "—"}</td>
                <td style={{ padding: "3px 8px 3px 0" }}>{name}</td>
                <td style={{ padding: "3px 0", color: "var(--muted)", whiteSpace: "nowrap" }}>
                  {{ o: "operational", c: "construction", p: "planned", s: "secured" }[st] ?? st} · {when}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {c.src.length > 0 && (
        <p style={{ fontSize: 11.5, color: "var(--muted)", marginTop: 8 }}>
          Sources:{" "}
          {c.src.map(([label, url], i) => (
            <span key={url}>{i > 0 && " · "}<a href={url} target="_blank" rel="noreferrer">{label}</a></span>
          ))}
        </p>
      )}
    </div>
  );
}

export function CapacityBars({ rows }: { rows: CapacityCompany[] }) {
  const [open, setOpen] = useState<string | null>(null);
  const max = Math.max(...rows.map((c) => c.op + c.con + c.plan), 1);
  return (
    <div>
      <p style={{ fontSize: 12, color: "var(--muted)" }}>
        <span style={{ color: SEG.op }}>■</span> operational{" "}
        <span style={{ color: SEG.con }}>■</span> construction{" "}
        <span style={{ color: SEG.plan }}>■</span> planned — critical-IT AI MW, verify-adjusted
      </p>
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        {rows.map((c, i) => {
          const total = c.op + c.con + c.plan;
          return (
            <div key={c.t} className="dashboard-panel" style={{ padding: 0 }}>
              <div onClick={() => setOpen(open === c.t ? null : c.t)}
                role="button" tabIndex={0} aria-expanded={open === c.t}
                onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setOpen(open === c.t ? null : c.t); } }}
                style={{ display: "grid", gridTemplateColumns: "230px 1fr 110px", gap: 12,
                         alignItems: "center", padding: "9px 14px", cursor: "pointer" }}>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 13.5, fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                    <span style={{ color: "var(--muted)", marginRight: 6 }}>{i + 1}</span>
                    {c.n}
                  </div>
                  <div style={{ fontSize: 11, color: "var(--muted)" }}>
                    {c.private ? "private" : c.t} · {c.role}
                    {c.confidence === "estimate" && <span title="MW footprint is an estimate, not filing-grade"> · est.</span>}
                    {c.flag && <span style={{ color: "var(--accent-amber, #f4c64a)" }}> · {c.flag}</span>}
                  </div>
                </div>
                <div style={{ display: "flex", height: 22, borderRadius: 5, overflow: "hidden",
                              border: "1px solid var(--border)" }}>
                  <div style={{ width: `${(c.op / max) * 100}%`, background: SEG.op }} />
                  <div style={{ width: `${(c.con / max) * 100}%`, background: SEG.con }} />
                  <div style={{ width: `${(c.plan / max) * 100}%`, background: SEG.plan, opacity: 0.45 }} />
                </div>
                <div style={{ textAlign: "right" }}>
                  <div style={{ fontSize: 13, fontWeight: 700 }}>{fmtMW(total)}</div>
                  <div style={{ fontSize: 10.5, color: "var(--muted)" }}>
                    {c.ev_per_mw != null ? (
                      c.stale
                        ? <span title={`Stale quote — last priced ${c.priced_date}`}>${c.ev_per_mw.toFixed(0)}M/MW*</span>
                        : `$${c.ev_per_mw.toFixed(0)}M/MW`
                    ) : c.stale ? (
                      c.cap != null
                        ? <span title={`Stale quote — last priced ${c.priced_date}`}>stale</span>
                        : "unpriced"
                    ) : <span title={c.private ? "Private — EV/MW not comparable" : "Conglomerate EV — not meaningful per AI MW"}>—</span>}
                  </div>
                </div>
              </div>
              {open === c.t && <Detail c={c} />}
            </div>
          );
        })}
      </div>
    </div>
  );
}
