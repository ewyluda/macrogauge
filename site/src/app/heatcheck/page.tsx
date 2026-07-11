import heat from "../../../public/data/heatcheck.json";
import { KpiCard } from "@/components/KpiCard";

export default function Heatcheck() {
  return <div><h1>Economy Heat Check <span className="subtitle">−100 cooling · +100 heating</span></h1>
    <div className="kpi-row"><KpiCard label="Heat score" value={heat.score.toFixed(1)} context={`${heat.coverage_pct.toFixed(1)}% indicator coverage · ${heat.published_at}`} accent={heat.score >= 0 ? "red" : "emerald"} /></div>
    <div className="table-card"><table className="data-table"><thead><tr><th>Indicator</th><th>Group</th><th>Momentum</th><th>Signed z</th><th>As of</th></tr></thead><tbody>{heat.indicators.map(row => <tr key={row.code}><td>{row.code}</td><td>{row.group.replaceAll("_", " ")}</td><td>{row.momentum.toFixed(2)}%</td><td>{row.z.toFixed(2)}</td><td>{row.as_of}</td></tr>)}</tbody></table></div>
    <p className="method">Each indicator’s three-period momentum is z-scored against its own available history, clamped to ±2.5, and signed so positive means heating. Group weights: Prices 25, Real Economy 25, Pipeline 20, Housing 15, Money &amp; Expectations 15.</p></div>;
}
