import nowcastJson from "../../../public/data/nowcast_latest.json";
import { ForecastHero } from "@/components/ForecastHero";
import { Section } from "@/components/Section";
import type { Nowcast } from "@/lib/types";

const nowcast = nowcastJson as Nowcast;

export default function CpiPreview() {
  return <div><h1>CPI Preview <span className="subtitle">evergreen forecast → result</span></h1>
    <p className="lede">Bottom-up forecast for {nowcast.reference_month ?? "the next print (release calendar awaiting refresh)"}, frozen and graded when the BLS print arrives.</p>
    <ForecastHero />
    <Section title="Component receipts"><div className="table-card"><table className="data-table"><thead><tr><th>Component</th><th>MoM</th><th>Weight</th><th>Contribution</th></tr></thead><tbody>
      {nowcast.cpi.components.map((row) => <tr key={row.component}><td>{row.component}</td><td>{row.mom_pct.toFixed(2)}%</td><td>{(row.weight * 100).toFixed(1)}%</td><td>{row.contribution_pp.toFixed(3)}pp</td></tr>)}
    </tbody></table></div></Section>
    <p className="method">Status: {nowcast.cpi.status.toUpperCase()}.</p>
  </div>;
}
