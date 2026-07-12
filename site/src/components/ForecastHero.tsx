import nextprintJson from "../../public/data/nextprint.json";
import { ForecastTable } from "./ForecastTable";
import { KpiCard } from "./KpiCard";
import type { NextPrint } from "@/lib/types";

const nextprint = nextprintJson as NextPrint;

export function ForecastHero() {
  return (
    <>
      <div className="kpi-row">
        <KpiCard label="Ensemble CPI · MoM"
          value={nextprint.ensemble.value == null ? "—" : `${nextprint.ensemble.value.toFixed(2)}%`}
          context={nextprint.release_date
            ? `${nextprint.reference_month} · releases ${nextprint.release_date}`
            : "next release TBA — release calendar awaiting refresh"} accent="sky" />
        <KpiCard label="Forecasters live" value={String(nextprint.forecasters.length)}
          context="Unavailable benchmarks receive zero weight" accent="violet" />
      </div>
      <ForecastTable rows={nextprint.forecasters} />
    </>
  );
}
