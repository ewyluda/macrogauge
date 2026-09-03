import type { Metadata } from "next";
import backtest from "../../../public/data/backtest.json";
import accountability from "../../../public/data/accountability_cpi.json";
import accountabilityPce from "../../../public/data/accountability_pce.json";
import accountabilityNfp from "../../../public/data/accountability_nfp.json";
import { KpiCard } from "@/components/KpiCard";
import { DownloadData } from "@/components/DownloadData";
import { Section } from "@/components/Section";
import { fmtPp } from "@/lib/format";
import { GradeTable, reconcileCalls } from "@/components/GradeTable";

export const metadata: Metadata = {
  title: "Forecast Scoreboard",
  description: "Every CPI call graded in public — live receipts plus the vintage-true walk-forward backtest.",
};

/** signed thousands-of-jobs display: 117 -> "+117k" (NFP is a monthly change, not a %) */
function fmtJobsK(v: number | null): string {
  if (v === null || v === undefined) return "—";
  const s = v > 0 ? "+" : v < 0 ? "−" : "";
  return `${s}${Math.abs(Math.round(v)).toLocaleString("en-US")}k`;
}

export default function Scoreboard() {
  const summary = backtest.summary as { observations: number; mae_pp: number | null; naive_mae_pp: number | null };
  const rows = backtest.rows as { target_month: string; cutoff?: string; badge: string; forecast_mom_pct: number; naive_mom_pct?: number | null; actual_mom_pct: number; error_pp: number }[];
  // a print graded in real time may still carry a same-period pending call
  // from the pre-release run — reconcile() shows it once, as graded
  const { graded, pending } = reconcileCalls(accountability);
  const pce = reconcileCalls(accountabilityPce);
  const nfp = reconcileCalls(accountabilityNfp);
  return <div><h1>Forecast Scoreboard <span className="subtitle">graded in public</span></h1>
    <div className="kpi-row"><KpiCard label="Vintage-true MAE" value={summary.mae_pp == null ? "—" : `${summary.mae_pp.toFixed(2)}pp`} context={`${summary.observations} BT observations · 3-month-average benchmark, not the live model`} accent="sky" />
      <KpiCard label="Naive MAE" value={summary.naive_mae_pp == null ? "—" : `${summary.naive_mae_pp.toFixed(2)}pp`} context="Last known monthly print" accent="amber" />
      <KpiCard label="Live grades" value={String(graded.length)} context={`${pending.length} pending`} accent="emerald" /></div>
    <Section title="Live grades — real-time calls, receipts included">
      <div className="section-tools"><DownloadData filename="macrogauge-cpi-grades" json="accountability_cpi.json" citation="MacroGauge live CPI grades" rows={[...graded, ...pending]} /></div>
      <GradeTable rows={{ graded, pending }} keyPrefix="cpi" />
      <p className="method">Signed error = forecast − actual (positive = ran hot). Calls freeze at their as-of date and grade automatically when the print lands — nothing is revised after the fact.</p>
    </Section>
    <Section title="Walk-forward backtest — vintage-true history">
      <div className="section-tools"><DownloadData filename="macrogauge-cpi-backtest" json="backtest.json" citation="MacroGauge vintage-true CPI backtest" rows={rows} /></div>
      <div className="table-card"><table className="data-table"><thead><tr><th>Month</th><th>Badge</th><th>Vintage cutoff</th><th>Forecast</th><th>Naive (carry-fwd)</th><th>Actual</th><th>Error</th><th>vs naive</th></tr></thead><tbody>{rows.length === 0 && <tr><td colSpan={8} style={{ color: "var(--muted)", textAlign: "left" }}>No backtest rows published on this run — the harness needs the release calendar and at least one vintage-true month.</td></tr>}{rows.slice(-24).reverse().map(row => { const naiveErr = row.naive_mom_pct == null ? null : Math.abs(row.naive_mom_pct - row.actual_mom_pct); const beat = naiveErr == null ? null : Math.abs(row.error_pp) < naiveErr; return <tr key={row.target_month}><td>{row.target_month}</td><td><span className="badge">{row.badge}</span></td><td style={{ color: "var(--muted)" }}>{row.cutoff ?? "—"}</td><td>{row.forecast_mom_pct.toFixed(2)}%</td><td style={{ color: "var(--muted)" }}>{row.naive_mom_pct == null ? "—" : `${row.naive_mom_pct.toFixed(2)}%`}</td><td>{row.actual_mom_pct.toFixed(2)}%</td><td>{row.error_pp.toFixed(2)}pp</td><td>{beat == null ? "—" : <span className={beat ? "badge" : "badge badge-muted"}>{beat ? "beat" : "lost"}</span>}</td></tr>; })}</tbody></table></div>
      <p className="method">BT rows are vintage-true walk-forward values frozen the day before each release — the model never sees data it wouldn&apos;t have had. The backtested model is a three-month average of previously known official prints — a long-history benchmark, not the live bottom-up nowcast graded in the table above (which is too young to backtest vintage-true).</p>
    </Section>
    <Section title="Also graded — PCE">
      <GradeTable rows={pce} keyPrefix="pce" />
      <p className="method">Same freeze-and-grade rules as CPI above: forecast is MoM % on the PCE price index, graded against the first print when it lands.</p>
    </Section>
    <Section title="Also graded — NFP">
      <GradeTable rows={nfp} keyPrefix="nfp" valueHeader="(k jobs)" fmtValue={fmtJobsK} fmtError={fmtJobsK} errorWarn={50} />
      <p className="method">NFP calls are monthly payroll changes in thousands of jobs, not percentages; signed error = forecast − actual, also in thousands. Same freeze rules — nothing is revised after the fact.</p>
    </Section>
  </div>;
}
