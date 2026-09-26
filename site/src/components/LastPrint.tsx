import accountabilityJson from "../../public/data/accountability_cpi.json";
import type { LeaderboardData } from "./Leaderboard";
import { KpiCard } from "./KpiCard";
import { Section } from "./Section";

/** "Forecast → result": the latest graded CPI print, every forecaster on the
 *  SA first-release basis, plus component miss attribution once frozen
 *  component rows exist for a released month (recorded from 2026-09-26). */
type Misses = {
  reference_period: string; release_date: string;
  rows: { component: string; label: string; weight: number; forecast_nsa_mom_pct: number;
          actual_nsa_mom_pct: number; miss_contribution_pp: number }[];
} | null;

const acc = accountabilityJson as unknown as { leaderboard?: LeaderboardData; last_print_components?: Misses };
const NAMES: Record<string, string> = { macrogauge: "Macrogauge", cleveland: "Cleveland Fed", kalshi: "Kalshi" };

export function LastPrint() {
  const last = acc.leaderboard?.rows.at(-1);
  if (!last) return null;
  const misses = acc.last_print_components;
  return (
    <Section title="Last print — forecast → result">
      <div className="kpi-row">
        <KpiCard label={`Last print · ${last.reference_period} (SA MoM)`} value={`${last.actual_sa_mom_pct.toFixed(2)}%`}
          context={`released ${last.release_date} · first print`} accent="emerald" />
        {Object.entries(last.forecasts).map(([name, x]) => (
          <KpiCard key={name} label={NAMES[name] ?? name} value={`${x.value.toFixed(2)}%`}
            context={`miss ${x.error >= 0 ? "+" : ""}${x.error.toFixed(2)}pp${x.converted ? " · converted from NSA" : ""}`}
            accent={Math.abs(x.error) <= 0.1 ? "emerald" : "amber"} />
        ))}
      </div>
      {misses && misses.reference_period === last.reference_period && (
        <div className="table-card">
          <table className="data-table">
            <caption className="method" style={{ captionSide: "bottom", textAlign: "left" }}>
              Where the miss came from: frozen pre-release component calls vs each component’s own first-print move (not seasonally adjusted), weighted.
            </caption>
            <thead><tr><th style={{ textAlign: "left" }}>Component</th><th>Called</th><th>Printed</th><th>Miss contribution</th></tr></thead>
            <tbody>
              {misses.rows.map((r) => (
                <tr key={r.component}>
                  <td style={{ textAlign: "left" }}>{r.label}</td>
                  <td>{r.forecast_nsa_mom_pct.toFixed(2)}%</td>
                  <td>{r.actual_nsa_mom_pct.toFixed(2)}%</td>
                  <td>{r.miss_contribution_pp >= 0 ? "+" : ""}{r.miss_contribution_pp.toFixed(3)}pp</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Section>
  );
}
