import type { Metadata } from "next";
import backtest from "../../../public/data/backtest.json";
import accountability from "../../../public/data/accountability_cpi.json";
import { KpiCard } from "@/components/KpiCard";
import { Section } from "@/components/Section";
import { fmtPp } from "@/lib/format";

export const metadata: Metadata = {
  title: "Forecast Scoreboard",
  description: "Every CPI call graded in public — live receipts plus the vintage-true walk-forward backtest.",
};

type Graded = {
  reference_period: string;
  badge: string;
  forecast: number;
  as_of: string;
  actual: number | null;
  error: number | null;
  release_date?: string;
};

export default function Scoreboard() {
  const summary = backtest.summary as { observations: number; mae_pp: number | null; naive_mae_pp: number | null };
  const rows = backtest.rows as { target_month: string; badge: string; forecast_mom_pct: number; actual_mom_pct: number; error_pp: number }[];
  const graded = (accountability.graded as Graded[]).slice().reverse();
  // a print graded in real time may still carry a same-period pending call
  // from the pre-release run — show it once, as graded
  const gradedPeriods = new Set(graded.map((g) => g.reference_period));
  const pending = (accountability.pending as Graded[]).filter(
    (p) => !gradedPeriods.has(p.reference_period),
  );
  return <div><h1>Forecast Scoreboard <span className="subtitle">graded in public</span></h1>
    <div className="kpi-row"><KpiCard label="Vintage-true MAE" value={summary.mae_pp == null ? "—" : `${summary.mae_pp.toFixed(2)}pp`} context={`${summary.observations} BT observations`} accent="sky" />
      <KpiCard label="Naive MAE" value={summary.naive_mae_pp == null ? "—" : `${summary.naive_mae_pp.toFixed(2)}pp`} context="Last known monthly print" accent="amber" />
      <KpiCard label="Live grades" value={String(graded.length)} context={`${pending.length} pending`} accent="emerald" /></div>
    <Section title="Live grades — real-time calls, receipts included">
      <div className="table-card"><table className="data-table"><thead><tr><th>Print</th><th>Badge</th><th>Forecast MoM</th><th>Actual MoM</th><th>Error</th><th>Called on</th><th>Graded on</th></tr></thead><tbody>
        {graded.map(g => <tr key={`g-${g.reference_period}-${g.as_of}`}><td>{g.reference_period}</td><td><span className="badge">{g.badge}</span></td><td>{g.forecast.toFixed(2)}%</td><td>{g.actual == null ? "—" : `${g.actual.toFixed(2)}%`}</td><td style={{ color: g.error != null && Math.abs(g.error) > 0.1 ? "var(--accent-amber)" : "var(--text)" }}>{fmtPp(g.error)}</td><td>{g.as_of}</td><td>{g.release_date ?? "—"}</td></tr>)}
        {pending.map(p => <tr key={`p-${p.reference_period}-${p.as_of}`}><td>{p.reference_period}</td><td><span className="badge badge-muted">pending</span></td><td>{p.forecast.toFixed(2)}%</td><td>—</td><td>—</td><td>{p.as_of}</td><td>—</td></tr>)}
      </tbody></table></div>
      <p className="method">Signed error = forecast − actual (positive = ran hot). Calls freeze at their as-of date and grade automatically when the print lands — nothing is revised after the fact.</p>
    </Section>
    <Section title="Walk-forward backtest — vintage-true history">
      <div className="table-card"><table className="data-table"><thead><tr><th>Month</th><th>Badge</th><th>Forecast</th><th>Actual</th><th>Error</th></tr></thead><tbody>{rows.slice(-24).reverse().map(row => <tr key={row.target_month}><td>{row.target_month}</td><td><span className="badge">{row.badge}</span></td><td>{row.forecast_mom_pct.toFixed(2)}%</td><td>{row.actual_mom_pct.toFixed(2)}%</td><td>{row.error_pp.toFixed(2)}pp</td></tr>)}</tbody></table></div>
      <p className="method">BT rows are vintage-true walk-forward values frozen the day before each release — the model never sees data it wouldn&apos;t have had.</p>
    </Section>
  </div>;
}
