import { fmtPp } from "@/lib/format";

export type GradedCall = {
  reference_period: string;
  badge: string;
  forecast: number;
  as_of: string;
  actual: number | null;
  error: number | null;
  release_date?: string;
};

/** graded newest-first plus pending calls not already graded for the same period */
export function reconcileCalls(data: { graded: unknown; pending: unknown }): {
  graded: GradedCall[];
  pending: GradedCall[];
} {
  const graded = (data.graded as GradedCall[]).slice().reverse();
  const gradedPeriods = new Set(graded.map((g) => g.reference_period));
  const pending = (data.pending as GradedCall[]).filter(
    (p) => !gradedPeriods.has(p.reference_period),
  );
  return { graded, pending };
}

const pct2 = (v: number | null) => (v == null ? "—" : `${v.toFixed(2)}%`);

/** The receipts table shared by /scoreboard and /pce: one row per graded
 *  call, pending calls appended, error highlighted past ±0.1. `fmtValue`
 *  and `fmtError` let NFP (thousands of jobs) reuse it. */
export function GradeTable({
  rows,
  keyPrefix,
  valueHeader = "MoM",
  fmtValue = pct2,
  fmtError = fmtPp,
  errorWarn = 0.1,
  emptyText = "No calls graded yet — the first print after a call lands grades it here.",
}: {
  rows: { graded: GradedCall[]; pending: GradedCall[] };
  keyPrefix: string;
  valueHeader?: string;
  fmtValue?: (v: number | null) => string;
  fmtError?: (v: number | null) => string;
  errorWarn?: number;
  emptyText?: string;
}) {
  const { graded, pending } = rows;
  return (
    <div className="table-card">
      <table className="data-table">
        <thead>
          <tr>
            <th>Print</th>
            <th>Badge</th>
            <th>Forecast {valueHeader}</th>
            <th>Actual {valueHeader}</th>
            <th>Error</th>
            <th>Called on</th>
            <th>Graded on</th>
          </tr>
        </thead>
        <tbody>
          {graded.length === 0 && pending.length === 0 && (
            <tr>
              <td colSpan={7} style={{ color: "var(--muted)", textAlign: "left" }}>{emptyText}</td>
            </tr>
          )}
          {graded.map((g) => (
            <tr key={`${keyPrefix}-g-${g.reference_period}-${g.as_of}`}>
              <td>{g.reference_period}</td>
              <td><span className="badge">{g.badge}</span></td>
              <td>{fmtValue(g.forecast)}</td>
              <td>{fmtValue(g.actual)}</td>
              <td style={{ color: g.error != null && Math.abs(g.error) > errorWarn ? "var(--accent-amber)" : "var(--text)" }}>
                {fmtError(g.error)}
              </td>
              <td>{g.as_of}</td>
              <td>{g.release_date ?? "—"}</td>
            </tr>
          ))}
          {pending.map((p) => (
            <tr key={`${keyPrefix}-p-${p.reference_period}-${p.as_of}`}>
              <td>{p.reference_period}</td>
              <td><span className="badge badge-muted">pending</span></td>
              <td>{fmtValue(p.forecast)}</td>
              <td>—</td>
              <td>—</td>
              <td>{p.as_of}</td>
              <td>—</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
