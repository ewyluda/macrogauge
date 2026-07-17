import { fmtMonth, fmtPp, fmtSigned, yoyColor } from "@/lib/format";

const th: React.CSSProperties = {
  textAlign: "right",
  fontSize: 11,
  letterSpacing: "0.08em",
  textTransform: "uppercase",
  color: "var(--muted)",
  fontWeight: 500,
  padding: "8px 12px",
  borderBottom: "1px solid var(--border)",
};
const td: React.CSSProperties = {
  padding: "7px 12px",
  fontSize: 13,
  textAlign: "right",
  borderBottom: "1px solid var(--border)",
  fontVariantNumeric: "tabular-nums",
};

type Row = {
  component: string;
  label: string;
  weight: number;
  mode: string;
  ours_yoy_pct: number | null;
  bls_yoy_pct: number;
  gap_pp: number | null;
  contribution_pp: number | null;
};

export function GapDecomposition({
  rows,
  asOf,
  officialMonth,
  totalGapPp,
}: {
  rows: Row[];
  asOf: string;
  officialMonth: string;
  totalGapPp: number;
}) {
  return (
    <div
      style={{
        background: "var(--card)",
        border: "1px solid var(--border)",
        borderRadius: 10,
        overflow: "hidden",
      }}
    >
      <table style={{ width: "100%", borderCollapse: "collapse" }}>
        <thead>
          <tr>
            <th style={{ ...th, textAlign: "left" }}>Component</th>
            <th style={th}>Weight</th>
            <th style={{ ...th, textAlign: "center" }}>Mode</th>
            <th style={th}>Ours YoY</th>
            <th style={th}>BLS YoY ({fmtMonth(officialMonth)})</th>
            <th style={th}>Gap</th>
            <th style={th}>Contribution</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.component}>
              <td style={{ ...td, textAlign: "left", fontSize: 14 }}>{r.label}</td>
              <td style={td}>{(r.weight * 100).toFixed(1)}%</td>
              <td style={{ ...td, textAlign: "center" }}>
                <span
                  style={{
                    fontSize: 10,
                    letterSpacing: "0.08em",
                    padding: "1px 8px",
                    borderRadius: 999,
                    border: "1px solid var(--border)",
                    color:
                      r.mode === "live" ? "var(--accent-emerald)" : "var(--muted)",
                  }}
                >
                  {r.mode === "live" ? "LIVE" : "BLS-CF"}
                </span>
              </td>
              <td style={{ ...td, color: "var(--accent-sky)", fontWeight: 600 }}>
                {fmtSigned(r.ours_yoy_pct)}
              </td>
              <td style={td}>{fmtSigned(r.bls_yoy_pct)}</td>
              <td style={{ ...td, color: yoyColor(r.gap_pp) }}>{fmtPp(r.gap_pp)}</td>
              <td style={{ ...td, color: yoyColor(r.contribution_pp) }}>
                {fmtPp(r.contribution_pp)}
              </td>
            </tr>
          ))}
          <tr>
            <td style={{ ...td, textAlign: "left", fontWeight: 600 }}>
              Total gap vs BLS basket (reconstructed)
            </td>
            <td style={td} colSpan={5} />
            <td style={{ ...td, fontWeight: 700, color: yoyColor(totalGapPp) }}>
              {fmtPp(totalGapPp)}
            </td>
          </tr>
        </tbody>
      </table>
      <div style={{ fontSize: 11, color: "var(--muted)", padding: "8px 12px" }}>
        gap contribution = weight × (ours − BLS) · ours as of {asOf} · BLS-CF rows
        carry the official print, so their gap is 0 by construction · the total is
        vs our 14-component reconstruction of the BLS basket, so it differs
        slightly from the headline gap vs the official CPI print
      </div>
    </div>
  );
}
