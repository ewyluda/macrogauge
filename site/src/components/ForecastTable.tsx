import type { Forecaster } from "@/lib/types";

export function ForecastTable({ rows }: { rows: Forecaster[] }) {
  return (
    <div className="table-card">
      <table className="data-table">
        <thead><tr><th>Forecaster</th><th>MoM</th><th>Type</th><th>As of</th></tr></thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.name}>
              <td>{row.name}</td>
              <td style={{ color: row.name === "Macrogauge" ? "var(--accent-sky)" : "var(--accent-amber)" }}>
                {row.value.toFixed(2)}%
              </td>
              <td><span className="badge">{row.kind.toUpperCase()}</span></td>
              <td>{row.as_of}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
