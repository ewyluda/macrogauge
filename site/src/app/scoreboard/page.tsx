import type { Metadata } from "next";
import backtest from "../../../public/data/backtest.json";
import accountability from "../../../public/data/accountability_cpi.json";
import accountabilityPce from "../../../public/data/accountability_pce.json";
import accountabilityNfp from "../../../public/data/accountability_nfp.json";
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

/** graded newest-first plus pending calls not already graded for the same period */
function reconcile(data: { graded: unknown; pending: unknown }): { graded: Graded[]; pending: Graded[] } {
  const graded = (data.graded as Graded[]).slice().reverse();
  const gradedPeriods = new Set(graded.map((g) => g.reference_period));
  const pending = (data.pending as Graded[]).filter(
    (p) => !gradedPeriods.has(p.reference_period),
  );
  return { graded, pending };
}

/** signed thousands-of-jobs display: 117 -> "+117k" (NFP is a monthly change, not a %) */
function fmtJobsK(v: number | null): string {
  if (v === null || v === undefined) return "—";
  const s = v > 0 ? "+" : v < 0 ? "−" : "";
  return `${s}${Math.abs(Math.round(v)).toLocaleString("en-US")}k`;
}

export default function Scoreboard() {
  const summary = backtest.summary as { observations: number; mae_pp: number | null; naive_mae_pp: number | null };
  const rows = backtest.rows as { target_month: string; badge: string; forecast_mom_pct: number; actual_mom_pct: number; error_pp: number }[];
  // a print graded in real time may still carry a same-period pending call
  // from the pre-release run — reconcile() shows it once, as graded
  const { graded, pending } = reconcile(accountability);
  const pce = reconcile(accountabilityPce);
  const nfp = reconcile(accountabilityNfp);
  return <div><h1>Forecast Scoreboard <span className="subtitle">graded in public</span></h1>
    <div className="kpi-row"><KpiCard label="Vintage-true MAE" value={summary.mae_pp == null ? "—" : `${summary.mae_pp.toFixed(2)}pp`} context={`${summary.observations} BT observations · 3-month-average benchmark, not the live model`} accent="sky" />
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
      <p className="method">BT rows are vintage-true walk-forward values frozen the day before each release — the model never sees data it wouldn&apos;t have had. The backtested model is a three-month average of previously known official prints — a long-history benchmark, not the live bottom-up nowcast graded in the table above (which is too young to backtest vintage-true).</p>
    </Section>
    <Section title="Also graded — PCE">
      <div className="table-card"><table className="data-table"><thead><tr><th>Print</th><th>Badge</th><th>Forecast MoM</th><th>Actual MoM</th><th>Error</th><th>Called on</th><th>Graded on</th></tr></thead><tbody>
        {pce.graded.map(g => <tr key={`pce-g-${g.reference_period}-${g.as_of}`}><td>{g.reference_period}</td><td><span className="badge">{g.badge}</span></td><td>{g.forecast.toFixed(2)}%</td><td>{g.actual == null ? "—" : `${g.actual.toFixed(2)}%`}</td><td style={{ color: g.error != null && Math.abs(g.error) > 0.1 ? "var(--accent-amber)" : "var(--text)" }}>{fmtPp(g.error)}</td><td>{g.as_of}</td><td>{g.release_date ?? "—"}</td></tr>)}
        {pce.pending.map(p => <tr key={`pce-p-${p.reference_period}-${p.as_of}`}><td>{p.reference_period}</td><td><span className="badge badge-muted">pending</span></td><td>{p.forecast.toFixed(2)}%</td><td>—</td><td>—</td><td>{p.as_of}</td><td>—</td></tr>)}
      </tbody></table></div>
      <p className="method">Same freeze-and-grade rules as CPI above: forecast is MoM % on the PCE price index, graded against the first print when it lands.</p>
    </Section>
    <Section title="Also graded — NFP">
      <div className="table-card"><table className="data-table"><thead><tr><th>Print</th><th>Badge</th><th>Forecast (k jobs)</th><th>Actual (k jobs)</th><th>Error (k)</th><th>Called on</th><th>Graded on</th></tr></thead><tbody>
        {nfp.graded.map(g => <tr key={`nfp-g-${g.reference_period}-${g.as_of}`}><td>{g.reference_period}</td><td><span className="badge">{g.badge}</span></td><td>{fmtJobsK(g.forecast)}</td><td>{fmtJobsK(g.actual)}</td><td>{fmtJobsK(g.error)}</td><td>{g.as_of}</td><td>{g.release_date ?? "—"}</td></tr>)}
        {nfp.pending.map(p => <tr key={`nfp-p-${p.reference_period}-${p.as_of}`}><td>{p.reference_period}</td><td><span className="badge badge-muted">pending</span></td><td>{fmtJobsK(p.forecast)}</td><td>—</td><td>—</td><td>{p.as_of}</td><td>—</td></tr>)}
      </tbody></table></div>
      <p className="method">NFP calls are monthly payroll changes in thousands of jobs, not percentages; signed error = forecast − actual, also in thousands. Same freeze rules — nothing is revised after the fact.</p>
    </Section>
  </div>;
}
