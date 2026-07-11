import backtest from "../../../public/data/backtest.json";
import accountability from "../../../public/data/accountability_cpi.json";
import { KpiCard } from "@/components/KpiCard";

export default function Scoreboard() {
  const summary = backtest.summary as { observations: number; mae_pp: number | null; naive_mae_pp: number | null };
  const rows = backtest.rows as { target_month: string; badge: string; forecast_mom_pct: number; actual_mom_pct: number; error_pp: number }[];
  return <div><h1>Forecast Scoreboard <span className="subtitle">graded in public</span></h1>
    <div className="kpi-row"><KpiCard label="Vintage-true MAE" value={summary.mae_pp == null ? "—" : `${summary.mae_pp.toFixed(2)}pp`} context={`${summary.observations} BT observations`} accent="sky" />
      <KpiCard label="Naive MAE" value={summary.naive_mae_pp == null ? "—" : `${summary.naive_mae_pp.toFixed(2)}pp`} context="Last known monthly print" accent="amber" />
      <KpiCard label="Live grades" value={String(accountability.graded.length)} context={`${accountability.pending.length} pending`} accent="emerald" /></div>
    <div className="table-card"><table className="data-table"><thead><tr><th>Month</th><th>Badge</th><th>Forecast</th><th>Actual</th><th>Error</th></tr></thead><tbody>{rows.slice(-24).reverse().map(row => <tr key={row.target_month}><td>{row.target_month}</td><td><span className="badge">{row.badge}</span></td><td>{row.forecast_mom_pct.toFixed(2)}%</td><td>{row.actual_mom_pct.toFixed(2)}%</td><td>{row.error_pp.toFixed(2)}pp</td></tr>)}</tbody></table></div>
  </div>;
}
