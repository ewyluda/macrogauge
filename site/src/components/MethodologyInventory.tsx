"use client";
import { useState } from "react";

type Row = {
  code: string;
  name: string;
  source: string;
  route: string;
  cadence: string;
  latest_obs: string | null;
  fresh: boolean;
};

export function MethodologyInventory({ rows }: { rows: Row[] }) {
  const sources = Array.from(new Set(rows.map((r) => r.source))).sort();
  const [filter, setFilter] = useState<string | null>(null);
  const shown = filter ? rows.filter((r) => r.source === filter) : rows;
  const chip = (active: boolean): React.CSSProperties => ({
    border: `1px solid ${active ? "rgba(56,189,248,0.5)" : "var(--border)"}`,
    background: active ? "rgba(56,189,248,0.12)" : "var(--chip-bg)",
    color: active ? "var(--accent-sky)" : "var(--muted)",
    borderRadius: 999,
    padding: "2px 10px",
    fontSize: 12,
    cursor: "pointer",
  });
  const td: React.CSSProperties = {
    padding: "6px 12px",
    fontSize: 13,
    borderBottom: "1px solid var(--border)",
  };
  return (
    <div>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 10 }}>
        <button style={chip(filter === null)} onClick={() => setFilter(null)}>
          All ({rows.length})
        </button>
        {sources.map((s) => (
          <button key={s} style={chip(filter === s)} onClick={() => setFilter(s)}>
            {s}
          </button>
        ))}
      </div>
      <div
        style={{
          background: "var(--card)",
          border: "1px solid var(--border)",
          borderRadius: 10,
          overflow: "hidden",
        }}
      >
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <tbody>
            {shown.map((r) => (
              <tr key={r.code}>
                <td style={{ ...td, width: 14 }}>
                  <span
                    style={{
                      display: "inline-block",
                      width: 7,
                      height: 7,
                      borderRadius: 999,
                      background: r.fresh
                        ? "var(--accent-emerald)"
                        : "var(--accent-red)",
                    }}
                  />
                </td>
                <td style={{ ...td, fontFamily: "ui-monospace, monospace", fontSize: 12 }}>
                  {r.code}
                </td>
                <td style={td}>{r.name}</td>
                <td style={{ ...td, color: "var(--muted)", fontSize: 12 }}>
                  {r.source} · {r.route} · {r.cadence}
                </td>
                <td style={{ ...td, textAlign: "right", color: "var(--muted)", fontSize: 12 }}>
                  {r.latest_obs ?? "never"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
