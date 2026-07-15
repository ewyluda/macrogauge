import { fmtSigned } from "@/lib/format";

export type GapRow = {
  code: string;
  label: string;
  source_id: string;
  yoy_pct: number | null;
  last_obs: string;
  in_basket: boolean;
};

// Diverging bars: red = rising costs, emerald = falling (page-wide semantic).
// Sorting is presentation-only (precedent: parity cheapest/priciest strips);
// null YoY sinks to the bottom.
export function HardwareGapPanel({ rows }: { rows: GapRow[] }) {
  const sorted = [...rows].sort(
    (a, b) => (b.yoy_pct ?? -Infinity) - (a.yoy_pct ?? -Infinity)
  );
  const max = Math.max(...rows.map((r) => Math.abs(r.yoy_pct ?? 0)), 0.01);
  return (
    <div className="table-card">
      <h2>Same hardware, eleven official answers <span className="subtitle">why the index uses transaction-sensitive series</span></h2>
      <table className="data-table">
        <thead><tr><th>Official series</th><th>ID</th><th></th><th>YoY</th><th>Last obs</th><th></th></tr></thead>
        <tbody>
          {sorted.map((r) => {
            const v = r.yoy_pct;
            return (
              <tr key={r.code}>
                <td>{r.label}</td>
                <td><span className="badge badge-muted">{r.source_id}</span></td>
                <td style={{ minWidth: 120 }}>
                  <span style={{ display: "inline-block", verticalAlign: "middle",
                                 height: 8, borderRadius: 2,
                                 width: `${(Math.abs(v ?? 0) / max) * 110}px`,
                                 background: (v ?? 0) >= 0 ? "var(--accent-red)" : "var(--accent-emerald)" }} />
                </td>
                <td style={{ fontVariantNumeric: "tabular-nums" }}>{fmtSigned(v)}</td>
                <td>{r.last_obs}</td>
                <td>{r.in_basket
                  ? <span className="badge badge-muted" style={{ color: "var(--accent-amber)" }}>in index</span>
                  : null}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
