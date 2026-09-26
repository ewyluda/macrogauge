/** Head-to-head CPI MoM track record (accountability_cpi.json `leaderboard`,
 *  added 2026-09-26): every forecaster graded on one basis — seasonally
 *  adjusted, first release. Renders nothing on artifacts published before. */
export type LeaderboardData = {
  basis: string;
  window: number;
  min_n_for_weights: number;
  weights_earned: boolean;
  stats: Record<string, { n: number; mae_pp: number | null; bias_pp: number | null }>;
  rows: { reference_period: string; release_date: string; actual_sa_mom_pct: number;
          forecasts: Record<string, { value: number; error: number; converted: boolean }> }[];
};

const NAMES: Record<string, string> = { macrogauge: "Macrogauge", cleveland: "Cleveland Fed", kalshi: "Kalshi" };
const f = (v: number | null | undefined, d = 2) => (v == null ? "—" : v.toFixed(d));

export function Leaderboard({ data }: { data: LeaderboardData }) {
  const names = Object.keys(data.stats);
  const ranked = [...names].sort((a, b) => (data.stats[a].mae_pp ?? 99) - (data.stats[b].mae_pp ?? 99));
  return (
    <>
      <div className="table-card">
        <table className="data-table">
          <caption className="method" style={{ captionSide: "bottom", textAlign: "left" }}>
            {data.basis}; last value each forecaster published before the release, over the last {data.window} prints.
            {" "}Ensemble weights are {data.weights_earned
              ? "inverse-MAE (earned)"
              : `equal until every forecaster has ${data.min_n_for_weights} graded prints`}.
          </caption>
          <thead><tr><th style={{ textAlign: "left" }}>Forecaster</th><th>Prints</th><th>MAE (pp)</th><th>Bias (pp)</th></tr></thead>
          <tbody>
            {ranked.map((n) => (
              <tr key={n}>
                <td style={{ textAlign: "left" }}>{NAMES[n] ?? n}</td>
                <td>{data.stats[n].n}</td>
                <td>{f(data.stats[n].mae_pp, 3)}</td>
                <td>{f(data.stats[n].bias_pp, 3)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="table-card" style={{ marginTop: 12 }}>
        <table className="data-table">
          <thead><tr><th style={{ textAlign: "left" }}>Month</th><th>Actual (SA)</th>
            {names.map((n) => <th key={n}>{NAMES[n] ?? n}</th>)}</tr></thead>
          <tbody>
            {[...data.rows].reverse().map((r) => (
              <tr key={r.reference_period}>
                <td style={{ textAlign: "left" }}>{r.reference_period}</td>
                <td>{f(r.actual_sa_mom_pct)}%</td>
                {names.map((n) => {
                  const x = r.forecasts[n];
                  return <td key={n}>{x ? `${f(x.value)}%${x.converted ? "*" : ""}` : "—"}</td>;
                })}
              </tr>
            ))}
          </tbody>
        </table>
        <p className="method">* Macrogauge calls recorded before 2026-09-26 were not seasonally adjusted; shown converted with the same BLS seasonal factors the live model now uses.</p>
      </div>
    </>
  );
}
