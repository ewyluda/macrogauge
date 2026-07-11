import recession from "../../../public/data/recession.json";
import { KpiCard } from "@/components/KpiCard";

export default function Recession() {
  const probability = recession.probability_pct as number | null;
  return <div><h1>Recession Composite <span className="subtitle">six transparent signals</span></h1>
    <div className="kpi-row"><KpiCard label="Signals triggered" value={`${recession.triggered}/${recession.available}`} context={probability == null ? "awaiting signal history" : `${probability.toFixed(1)}% equal-weight share`} accent="red" /></div>
    <div className="table-card"><table className="data-table"><thead><tr><th>Signal</th><th>Rule</th><th>Value</th><th>Triggered</th></tr></thead><tbody>{recession.signals.map(row => <tr key={row.code}><td>{row.name}</td><td>{row.rule}</td><td>{row.value ?? "—"}</td><td>{row.triggered == null ? "Unavailable" : row.triggered ? "YES" : "No"}</td></tr>)}</tbody></table></div>
    <p className="method">The composite is the equal-weight share of available rules currently triggered. It is a signal dashboard, not a fitted recession probability.</p></div>;
}
