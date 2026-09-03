import nextprintJson from "../../public/data/nextprint.json";
import backtestJson from "../../public/data/backtest.json";
import { ForecastTable } from "./ForecastTable";
import { KpiCard } from "./KpiCard";
import type { NextPrint } from "@/lib/types";

const nextprint = nextprintJson as NextPrint;
const bt = backtestJson.summary as { observations: number; mae_pp: number | null; naive_mae_pp: number | null };
const band = (v: number | null) => (v == null || bt.mae_pp == null ? null : [v - bt.mae_pp, v + bt.mae_pp] as const);

export function ForecastHero() {
  return (
    <>
      <div className="kpi-row">
        <KpiCard label="Ensemble CPI · MoM"
          value={nextprint.ensemble.value == null ? "—" : `${nextprint.ensemble.value.toFixed(2)}%`}
          context={nextprint.release_date
            ? `${nextprint.reference_month} · releases ${nextprint.release_date}`
            : "next release TBA — release calendar awaiting refresh"} accent="sky" />
        <KpiCard label="Realized error band"
          value={(() => { const b = band(nextprint.ensemble.value); return b ? `${b[0].toFixed(2)}–${b[1].toFixed(2)}%` : "—"; })()}
          context={bt.mae_pp == null ? "no backtest yet" : `±${bt.mae_pp.toFixed(2)}pp = mean absolute error over ${bt.observations} vintage-true prints (naive ${bt.naive_mae_pp?.toFixed(2) ?? "—"}pp) · not a calibrated interval`}
          accent="amber" />
        <KpiCard label="Forecasters live" value={String(nextprint.forecasters.length)}
          context="Unavailable benchmarks receive zero weight" accent="violet" />
      </div>
      <ForecastTable rows={nextprint.forecasters} />
    </>
  );
}
