import type { Metadata } from "next";
import nowcastJson from "../../../public/data/nowcast_latest.json";
import { KpiCard } from "@/components/KpiCard";
import { ForecastHero } from "@/components/ForecastHero";
import type { Nowcast } from "@/lib/types";

export const metadata: Metadata = {
  title: "Nowcast Matrix",
  description: "Models × targets — CPI, PCE bridge and NFP nowcasts side by side.",
};

const nowcast = nowcastJson as Nowcast;

export default function Matrix() {
  const nfp = nowcast.nfp;
  return <div><h1>Nowcast Matrix <span className="subtitle">models × targets</span></h1><ForecastHero />
    <div className="kpi-row"><KpiCard label="CPI bridge" value={nowcast.cpi.mom_pct == null ? "—" : `${nowcast.cpi.mom_pct.toFixed(2)}%`} context={`${nowcast.reference_month ?? "TBA"} MoM · ${nowcast.cpi.status.toUpperCase()}`} accent="sky" />
      <KpiCard label="PCE bridge" value={nowcast.pce.mom_pct == null ? "—" : `${nowcast.pce.mom_pct.toFixed(2)}%`} context={`${nowcast.pce.parameters.observations ?? "—"} rolling observations`} accent="violet" />
      <KpiCard label="NFP" value={nfp ? `${nfp.change_thousands}k` : "—"} context={nfp ? "payroll momentum − claims delta" : "awaiting sufficient history"} accent="emerald" /></div></div>;
}
