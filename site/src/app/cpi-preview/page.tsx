import nowcast from "../../../public/data/nowcast_latest.json";
import { ForecastHero } from "@/components/ForecastHero";
import { Section } from "@/components/Section";

export default function CpiPreview() {
  return <div><h1>CPI Preview <span className="subtitle">evergreen forecast → result</span></h1>
    <p className="lede">Bottom-up forecast for {nowcast.reference_month}, frozen and graded when the BLS print arrives.</p>
    <ForecastHero />
    <Section title="Component receipts"><div className="table-card"><table className="data-table"><thead><tr><th>Component</th><th>MoM</th><th>Weight</th><th>Contribution</th></tr></thead><tbody>
      {nowcast.cpi.components.map((row) => <tr key={row.component}><td>{row.component}</td><td>{row.mom_pct.toFixed(2)}%</td><td>{(row.weight * 100).toFixed(1)}%</td><td>{row.contribution_pp.toFixed(3)}pp</td></tr>)}
    </tbody></table></div></Section>
    <p className="method">Parameters: fuel β {nowcast.cpi.parameters.fuel_beta}; rent lag {nowcast.cpi.parameters.rent_lag_months} months; rent weight {nowcast.cpi.parameters.rent_w}. Status: LIVE.</p>
  </div>;
}
