import fuel from "../../../public/data/fuel.json";
import { ForecastHero } from "@/components/ForecastHero";
import { KpiCard } from "@/components/KpiCard";

export default function NextPrint() {
  return <div><h1>Next Print <span className="subtitle">who’s where</span></h1><ForecastHero />
    <div className="kpi-row"><KpiCard label="Fuel · two-week forward" value={fuel.available ? `$${fuel.forward_2wk.toFixed(3)}` : "—"} context={fuel.available ? `${fuel.proxy} · as of ${fuel.as_of}` : "RBOB history unavailable"} accent="amber" /></div><p className="method">Printed formula: {fuel.formula}. Proxy substitutions are disclosed; they are never presented as the named source.</p></div>;
}
