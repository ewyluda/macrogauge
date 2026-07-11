import nextprint from "../../public/data/nextprint.json";
import { ForecastTable } from "./ForecastTable";
import { KpiCard } from "./KpiCard";

export function ForecastHero() {
  return (
    <>
      <div className="kpi-row">
        <KpiCard label="Ensemble CPI · MoM" value={`${nextprint.ensemble.value?.toFixed(2) ?? "—"}%`}
          context={`${nextprint.reference_month} · releases ${nextprint.release_date}`} accent="sky" />
        <KpiCard label="Forecasters live" value={String(nextprint.forecasters.length)}
          context="Unavailable benchmarks receive zero weight" accent="violet" />
      </div>
      <ForecastTable rows={nextprint.forecasters} />
    </>
  );
}
