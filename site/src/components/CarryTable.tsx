"use client";
import { MIN_HORIZON_MONTHS, type Band, type Basis } from "@/lib/dcContingency";
import { fmtSigned } from "@/lib/format";

/** "What you could carry" — the realized-regime basis table and the
 *  horizon-matched band under it. Extracted from DcEscalationClient (todo
 *  #37) so /portfolio can show the same copy-stable block. Not a forecast;
 *  every sentence below says so. */
export function CarryTable({
  basisRows, chosenKey, deliveryValid, horizon, bandRow, anchor,
}: {
  basisRows: Basis[];
  chosenKey: string | null;
  deliveryValid: boolean;
  horizon: number;
  bandRow: Band | null;
  anchor: string;
}) {
  if (!basisRows.length) return null;
  return (
    <div className="table-card" style={{ marginTop: 16 }}>
      <h2>
        What you could carry{" "}
        <span className="subtitle">realized regimes, measured to {anchor} — not a forecast</span>
      </h2>
      <table className="data-table">
        <thead>
          <tr>
            <th>Basis</th>
            <th>Window</th>
            <th>Annualized</th>
            <th>Cumulative</th>
            {deliveryValid && <th>Your {horizon}mo factor</th>}
          </tr>
        </thead>
        <tbody>
          {basisRows.map((b) => (
            <tr key={b.key} style={b.key === chosenKey ? { background: "var(--bg)", fontWeight: 600 } : undefined}>
              <td>
                {b.label}
                <div style={{ fontSize: 11, color: "var(--muted)" }}>{b.note}</div>
              </td>
              <td>
                {b.startMonth} → {b.endMonth} <span style={{ color: "var(--muted)" }}>({b.months}mo)</span>
              </td>
              <td>{fmtSigned(b.annualizedPct)}/yr</td>
              <td>{fmtSigned(b.cumulativePct)}</td>
              {deliveryValid && <td>×{Math.pow(1 + b.annualizedPct / 100, horizon / 12).toFixed(4)}</td>}
            </tr>
          ))}
        </tbody>
      </table>
      {bandRow && (
        <div style={{ fontSize: 12, color: "var(--muted)", padding: "8px 12px" }}>
          Across every realized {bandRow.horizonMonths}-month window in the {bandRow.sampleStartMonth}–{bandRow.sampleEndMonth} sample,
          annualized DC Build escalation ran{" "}
          <strong>{bandRow.p10.toFixed(2)}% (p10) → {bandRow.p50.toFixed(2)}% (p50) → {bandRow.p90.toFixed(2)}% (p90)</strong>.
          That is {bandRow.windows} overlapping windows — <strong>≈{bandRow.independentDraws.toFixed(1)} independent</strong> draws —
          and {bandRow.spikeOverlapPct.toFixed(0)}% of them touch the 2021–22 overlap window (narrower than the 2021–23 span the
          Peak-regime basis above carries — the two are measured for different purposes). It is a range of what has happened,
          not a probability distribution over what will.
        </div>
      )}
      {!bandRow && deliveryValid && (
        <div style={{ fontSize: 12, color: "var(--muted)", padding: "8px 12px" }}>
          No realized band here — it needs a window of at least {MIN_HORIZON_MONTHS} months to compare like-length history, and
          your {horizon}-month delivery window is shorter. The bases above still apply — they&apos;re rates, not tied to any one
          window length — there just isn&apos;t enough same-length history to bound them with a band.
        </div>
      )}
    </div>
  );
}
