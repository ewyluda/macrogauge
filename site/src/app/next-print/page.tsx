import type { Metadata } from "next";
import fuelJson from "../../../public/data/fuel.json";
import { ForecastHero } from "@/components/ForecastHero";
import { KpiCard } from "@/components/KpiCard";
import type { Fuel } from "@/lib/types";

export const metadata: Metadata = {
  title: "Next CPI Print — who's where",
  description: "Every forecaster's call for the next CPI print, plus the fuel two-week forward.",
};

const fuel = fuelJson as Fuel;

export default function NextPrint() {
  return <div><h1>Next Print <span className="subtitle">who’s where</span></h1><ForecastHero />
    <div className="kpi-row"><KpiCard label="Fuel · two-week forward" value={fuel.forward_2wk == null ? "—" : `$${fuel.forward_2wk.toFixed(3)}`} context={fuel.available && fuel.proxy ? `${fuel.proxy} · as of ${fuel.as_of}` : "RBOB history unavailable"} accent="amber" /></div><p className="method">Printed formula: {fuel.formula}. Proxy substitutions are disclosed; they are never presented as the named source.</p></div>;
}
