import nowcastJson from "../../public/data/nowcast_latest.json";
import { ForecastTable } from "./ForecastTable";
import { KpiCard } from "./KpiCard";
import type { Forecaster, Nowcast, PceNowcast } from "@/lib/types";
import { fmtMonth } from "@/lib/format";

// PCE nowcast keyed to its own release (BEA Personal Income & Outlays), added
// 2026-09-28. Older artifacts carry none of the new fields — every read below
// is absent-tolerant and falls back to the CPI reference month.
const nowcast = nowcastJson as Nowcast;
const pce = nowcast.pce;
const month = pce.reference_month ?? nowcast.reference_month;

const PPI_LABELS: Record<string, string> = {
  ppi_pce_airline: "airfares",
  ppi_pce_physician: "physicians",
  ppi_pce_hospital: "hospitals",
  ppi_pce_portfolio: "portfolio management",
};

const pct = (v: number | null | undefined) => (v == null ? "—" : `${v.toFixed(2)}%`);

function inputLine(n: PceNowcast | undefined, cpiLabel: string): string {
  const src = n?.cpi_input;
  if (!src) return n?.status === "unavailable" ? "no CPI input for this month yet" : "CPI pass-through";
  const how = src.source === "actual" ? `actual ${cpiLabel} (published)` : `our ${cpiLabel} nowcast`;
  return `bridged from ${how} ${src.mom_pct.toFixed(2)}%`;
}

function bridgeLine(n: PceNowcast | undefined): string {
  if (!n) return "—";
  const p = n.parameters ?? {};
  const oos = p.oos_mae_cpi_ppi_pp != null && p.oos_mae_cpi_only_pp != null
    ? ` · out-of-sample MAE ${p.oos_mae_cpi_ppi_pp.toFixed(3)} vs ${p.oos_mae_cpi_only_pp.toFixed(3)}pp CPI-only (${p.oos_months ?? "—"}mo)`
    : "";
  if (n.bridge === "cpi+ppi") {
    const names = Object.keys(p.ppi_betas ?? {}).map((c) => PPI_LABELS[c] ?? c).join(", ");
    return `CPI + BEA-input PPIs (${names})${oos}`;
  }
  return `CPI only${n.bridge_note ? ` — ${n.bridge_note}` : ""}${oos}`;
}

function rows(n: PceNowcast | undefined): Forecaster[] {
  if (!n) return [];
  const out: Forecaster[] = n.mom_pct == null ? [] : [{
    name: "Macrogauge", value: n.mom_pct, kind: "model", as_of: pce.as_of ?? nowcast.generated_on,
  }];
  for (const [name, b] of Object.entries(n.benchmarks ?? {})) {
    out.push({ name: name.charAt(0).toUpperCase() + name.slice(1), value: b.value, kind: "benchmark", as_of: b.as_of });
  }
  return out;
}

export function PceForecastHero() {
  const core = pce.core;
  const releaseText = pce.release_date ? `releases ${pce.release_date}` : "release date TBA";
  const headRows = rows(pce);
  const coreRows = rows(core);
  return (
    <>
      <div className="kpi-row">
        <KpiCard
          label="PCE nowcast · MoM (SA)"
          value={pct(pce.mom_pct)}
          context={`${month ? fmtMonth(`${month}-01`) : "—"} · ${releaseText} · ${inputLine(pce, "CPI")}`}
          accent="sky"
        />
        <KpiCard
          label="Core PCE nowcast · MoM (SA)"
          value={pct(core?.mom_pct)}
          context={core ? inputLine(core, "core CPI") : "publishes with the next daily run"}
          accent="violet"
        />
        <KpiCard label="Bridge" value={pce.bridge === "cpi+ppi" ? "CPI + PPI" : "CPI"}
          context={bridgeLine(pce)} accent="amber" />
      </div>
      {headRows.length > 0 && <ForecastTable rows={headRows} />}
      {coreRows.length > 0 && (
        <>
          <p className="method">Core PCE (PCE less food &amp; energy):</p>
          <ForecastTable rows={coreRows} />
        </>
      )}
    </>
  );
}
