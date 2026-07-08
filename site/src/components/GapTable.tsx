import Link from "next/link";
import { fmtMonth, fmtPct, fmtPp } from "@/lib/format";

const th: React.CSSProperties = {
  textAlign: "left",
  fontSize: 11,
  letterSpacing: "0.08em",
  textTransform: "uppercase",
  color: "var(--muted)",
  fontWeight: 500,
  padding: "10px 16px",
  borderBottom: "1px solid var(--border)",
};
const td: React.CSSProperties = {
  padding: "10px 16px",
  fontSize: 14,
  borderBottom: "1px solid var(--border)",
};

export type GapRow = {
  index: string;
  sub: string;
  oursYoy: number;
  oursAsOf: string;
  officialYoy: number;
  officialMonth: string;
};

export function GapTable({
  rows,
  nextPrint,
  cumulativePct,
}: {
  rows: GapRow[];
  nextPrint: { date: string; reference_month: string } | null;
  cumulativePct: number;
}) {
  return (
    <div>
      <div
        style={{
          background: "var(--card)",
          border: "1px solid var(--border)",
          borderRadius: 10,
          overflow: "hidden",
        }}
      >
        <table
          style={{
            width: "100%",
            borderCollapse: "collapse",
            fontVariantNumeric: "tabular-nums",
          }}
        >
          <thead>
            <tr>
              <th style={th}>Index</th>
              <th style={{ ...th, textAlign: "right" }}>Macrogauge YoY</th>
              <th style={{ ...th, textAlign: "right" }}>Latest official YoY</th>
              <th style={{ ...th, textAlign: "right" }}>Gap</th>
              <th style={{ ...th, textAlign: "right" }}>Next print</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const gap = r.oursYoy - r.officialYoy;
              return (
                <tr key={r.index}>
                  <td style={td}>
                    <div style={{ fontWeight: 600 }}>{r.index}</div>
                    <div style={{ fontSize: 11, color: "var(--muted)" }}>{r.sub}</div>
                  </td>
                  <td style={{ ...td, textAlign: "right" }}>
                    <span style={{ color: "var(--accent-sky)", fontWeight: 600 }}>
                      {fmtPct(r.oursYoy)}
                    </span>{" "}
                    <span style={{ fontSize: 11, color: "var(--muted)" }}>
                      {r.oursAsOf}
                    </span>
                  </td>
                  <td style={{ ...td, textAlign: "right" }}>
                    {fmtPct(r.officialYoy)}{" "}
                    <span style={{ fontSize: 11, color: "var(--muted)" }}>
                      {fmtMonth(r.officialMonth)}
                    </span>
                  </td>
                  <td style={{ ...td, textAlign: "right" }}>
                    <span
                      style={{
                        display: "inline-block",
                        background:
                          gap < 0 ? "rgba(56, 189, 248, 0.15)" : "rgba(248, 113, 113, 0.15)",
                        border: `1px solid ${gap < 0 ? "rgba(56, 189, 248, 0.35)" : "rgba(248, 113, 113, 0.35)"}`,
                        color: gap < 0 ? "var(--accent-sky)" : "var(--accent-red)",
                        borderRadius: 999,
                        padding: "1px 10px",
                        fontSize: 12,
                        fontWeight: 600,
                      }}
                    >
                      {fmtPp(gap)}
                    </span>
                  </td>
                  <td
                    style={{
                      ...td,
                      textAlign: "right",
                      color: "var(--accent-amber)",
                      fontSize: 13,
                    }}
                  >
                    {nextPrint
                      ? `${fmtMonth(`${nextPrint.reference_month}-01`)} · ${nextPrint.date}`
                      : "—"}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 10 }}>
        <Link
          href="/methodology"
          style={{
            border: "1px solid var(--border)",
            background: "var(--chip-bg)",
            borderRadius: 999,
            padding: "3px 12px",
            fontSize: 12,
            color: "var(--text)",
            textDecoration: "none",
          }}
        >
          How the methodology works →
        </Link>
        <span
          style={{
            border: "1px solid var(--border)",
            background: "var(--chip-bg)",
            borderRadius: 999,
            padding: "3px 12px",
            fontSize: 12,
            color: "var(--muted)",
          }}
        >
          Prices are up{" "}
          <span style={{ color: "var(--accent-amber)", fontWeight: 600 }}>
            {cumulativePct.toFixed(1)}%
          </span>{" "}
          since Jan 2018
        </span>
      </div>
    </div>
  );
}
