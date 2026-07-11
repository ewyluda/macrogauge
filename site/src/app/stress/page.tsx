import stress from "../../../public/data/stress.json";
import { KpiCard } from "@/components/KpiCard";

export default function Stress() {
  const score = stress.score as number | null;
  const indicators = stress.indicators as { code: string; value: number; score: number; weight: number; as_of: string }[];
  return <div><h1>Consumer Stress Index <span className="subtitle">0 low · 100 severe</span></h1>
    <div className="kpi-row"><KpiCard label="Stress score" value={score == null ? "—" : score.toFixed(1)} context={`${stress.coverage_pct.toFixed(0)}% weighted coverage · ${stress.published_at}`} accent="red" /></div>
    <div className="table-card"><table className="data-table"><thead><tr><th>Indicator</th><th>Value</th><th>Percentile score</th><th>Weight</th><th>As of</th></tr></thead><tbody>{indicators.map(row => <tr key={row.code}><td>{row.code}</td><td>{row.value}</td><td>{row.score.toFixed(1)}</td><td>{row.weight}%</td><td>{row.as_of}</td></tr>)}</tbody></table></div>
    <p className="method">Every input is percentile-scored against its own history since 2019 and direction-adjusted. Missing inputs reduce coverage and are not imputed.</p></div>;
}
