import type { Metadata } from "next";
import Link from "next/link";
import { COMPONENT_BY_CODE, componentHref } from "@/lib/components";
import { Term } from "@/components/Term";
import nowcastJson from "../../../public/data/nowcast_latest.json";
import fuelJson from "../../../public/data/fuel.json";
import { ForecastHero } from "@/components/ForecastHero";
import { PceForecastHero } from "@/components/PceForecastHero";
import { LastPrint } from "@/components/LastPrint";
import { Section } from "@/components/Section";
import type { Fuel, Nowcast } from "@/lib/types";

export const metadata: Metadata = {
  title: "CPI Preview",
  description: "Evergreen CPI forecast with every forecaster's call, component receipts and the fuel two-week forward — forecast → result, graded when the print lands.",
};

const nowcast = nowcastJson as Nowcast;
const fuel = fuelJson as Fuel;

export default function CpiPreview() {
  return <div><h1>CPI Preview <span className="subtitle">evergreen forecast → result</span></h1>
    <p className="lede">Bottom-up forecast for {nowcast.reference_month ?? "the next print (release calendar awaiting refresh)"}, frozen and graded when the BLS print arrives.</p>
    <ForecastHero />
    <Section title="Next PCE print"><PceForecastHero /><p className="method">PCE targets its own release (<Link href="/pce">more on /pce</Link>): it rides the published CPI once that month is out, our CPI nowcast before.</p></Section>
    <LastPrint />
    <Section title="Component receipts"><div className="table-card"><table className="data-table"><thead><tr><th>Component</th><th>MoM</th><th>Weight</th><th>Contribution</th></tr></thead><tbody>
      {nowcast.cpi.components.map((row) => <tr key={row.component}><td><Link href={componentHref(row.component)}>{COMPONENT_BY_CODE[row.component]?.label ?? row.component}</Link>
        {/* the fuel two-week forward (was /next-print) rides gasoline's own receipt */}
        {row.component === "fuel" && fuel.forward_2wk != null && <small data-testid="fuel-forward" style={{ display: "block", color: "var(--muted)" }}
          title={`Formula: ${fuel.formula}. Proxy substitutions are disclosed; they are never presented as the named source.`}>
          two weeks out ${fuel.forward_2wk.toFixed(3)}/gal{fuel.available && fuel.proxy ? ` · ${fuel.proxy} · as of ${fuel.as_of}` : ""}</small>}</td><td>{row.mom_pct.toFixed(2)}%{row.basis !== "measured" && <span className="badge" style={{ marginLeft: 6 }} title={row.driver_mom_pct !== undefined ? `trend + ${row.driver_mom_pct.toFixed(2)}pp futures driver` : "trailing-median trend"}>modeled</span>}</td><td>{(row.weight * 100).toFixed(1)}%</td><td>{row.contribution_pp.toFixed(3)}pp</td></tr>)}
    </tbody></table></div></Section>
    <p className="method">Status: {nowcast.cpi.status.toUpperCase()}. This is a <Term k="nowcast">nowcast</Term>, graded against the <Term k="firstprint">first print</Term>. Rows tagged “modeled” have no observation inside the target month yet: they carry the component’s own trailing-median trend (plus a disclosed futures-driver slice where one applies) instead of a fabricated 0.00%. Gasoline&apos;s two-week forward is {fuel.formula}; proxy substitutions are disclosed, never presented as the named source.</p>
  </div>;
}
