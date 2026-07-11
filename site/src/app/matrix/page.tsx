import nowcast from "../../../public/data/nowcast_latest.json";
import { KpiCard } from "@/components/KpiCard";
import { ForecastHero } from "@/components/ForecastHero";

export default function Matrix() {
  const nfp = nowcast.nfp as null | { change_thousands: number };
  return <div><h1>Nowcast Matrix <span className="subtitle">models × targets</span></h1><ForecastHero />
    <div className="kpi-row"><KpiCard label="CPI bridge" value={`${nowcast.cpi.mom_pct.toFixed(2)}%`} context={`${nowcast.reference_month} MoM · ${nowcast.cpi.status.toUpperCase()}`} accent="sky" />
      <KpiCard label="PCE bridge" value={`${nowcast.pce.mom_pct.toFixed(2)}%`} context={`${nowcast.pce.parameters.observations} rolling observations`} accent="violet" />
      <KpiCard label="NFP" value={nfp ? `${nfp.change_thousands}k` : "—"} context={nfp ? "payroll momentum − claims delta" : "awaiting sufficient history"} accent="emerald" /></div></div>;
}
