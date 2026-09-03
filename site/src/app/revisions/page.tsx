import type { Metadata } from "next";
import revisionsJson from "../../../public/data/revisions.json";
import { KpiCard } from "@/components/KpiCard";
import { Section } from "@/components/Section";
import { RevisionChart } from "@/components/RevisionChart";
import { DownloadData } from "@/components/DownloadData";
import { fmtPp } from "@/lib/format";
import type { Revisions, RevisionIndexRow, RevisionLevelRow } from "@/lib/types";

const data = revisionsJson as Revisions;
const k = (v: number | null) => (v == null ? "—" : `${v > 0 ? "+" : v < 0 ? "−" : ""}${Math.abs(v).toFixed(0)}k`);

export const metadata: Metadata = {
  title: "Revisions — first print vs where the number ended up",
  description: "Every CPI, PCE and payrolls print as first released beside its latest value, from the vintage store. The scoreboard grades against first prints; this shows how far those moved.",
};

function IndexTable({ rows, label }: { rows: RevisionIndexRow[]; label: string }) {
  return (
    <div className="table-card">
      <table className="data-table">
        <thead><tr><th>Period</th><th>First print</th><th>Released</th><th>Latest</th><th>Vintages</th><th>Level rev.</th><th>YoY first</th><th>YoY latest</th><th>YoY rev.</th></tr></thead>
        <tbody>
          {rows.slice().reverse().map((r) => (
            <tr key={r.reference_period}>
              <td>{r.reference_period}</td>
              <td>{r.first_value.toFixed(3)}</td>
              <td style={{ color: "var(--muted)" }}>{r.first_release_date}</td>
              <td>{r.latest_value.toFixed(3)}</td>
              <td style={{ color: "var(--muted)" }}>{r.n_vintages}</td>
              <td style={{ color: "var(--muted)" }}>{r.revision_pct == null ? "—" : `${r.revision_pct > 0 ? "+" : ""}${r.revision_pct.toFixed(3)}%`}</td>
              <td>{r.yoy_first_pct == null ? "—" : `${r.yoy_first_pct.toFixed(2)}%`}</td>
              <td>{r.yoy_latest_pct == null ? "—" : `${r.yoy_latest_pct.toFixed(2)}%`}</td>
              <td style={{ fontWeight: 600, color: r.yoy_revision_pp == null ? "var(--muted)" : Math.abs(r.yoy_revision_pp) < 0.005 ? "var(--muted)" : r.yoy_revision_pp > 0 ? "var(--accent-red)" : "var(--accent-emerald)" }}>{fmtPp(r.yoy_revision_pp)}</td>
            </tr>
          ))}
          {rows.length === 0 && <tr><td colSpan={9} style={{ color: "var(--muted)", textAlign: "left" }}>No vintages stored yet for {label}.</td></tr>}
        </tbody>
      </table>
    </div>
  );
}

export default function RevisionsPage() {
  const { cpi, pce, nfp } = data.targets;
  return (
    <div>
      <h1>
        Revisions <span className="subtitle">first print vs where the number ended up</span>
      </h1>
      <p className="lede">
        The store keeps every release of each series it collects — a re-published value appends a new vintage row,
        never overwrites. So for every reference period we can show the number as it first landed and the number it
        became. The <a href="/scoreboard">scoreboard</a> grades our calls against first prints; this page is how far
        those first prints later moved. CPI is not revised by design (seasonal factors aside); PCE and payrolls are.
      </p>
      <div className="kpi-row">
        <KpiCard label="CPI · YoY revision" value={fmtPp(cpi.summary.mean_abs_yoy_revision_pp)} context={`mean |revision| over ${cpi.summary.n} periods · ${cpi.summary.n_revised} carry >1 vintage`} accent="sky" />
        <KpiCard label="PCE · YoY revision" value={fmtPp(pce.summary.mean_abs_yoy_revision_pp)} context={`mean |revision| over ${pce.summary.n} periods · bias ${fmtPp(pce.summary.mean_revision)}`} accent="violet" />
        <KpiCard label="Payrolls · change revision" value={k(nfp.summary.mean_abs_change_revision_k)} context={`mean |revision| to the monthly change over ${nfp.summary.n} periods · bias ${k(nfp.summary.mean_revision)}`} accent="amber" />
      </div>

      <Section title="Payrolls — monthly change, first print vs latest (thousands)" featured>
        <div className="section-tools"><DownloadData filename="macrogauge-revisions-nfp" json="revisions.json" rows={nfp.rows} citation="MacroGauge payrolls revisions (first print vs latest)" /></div>
        <div className="chart-card"><RevisionChart months={nfp.rows.map((r) => r.reference_period)} values={nfp.rows.map((r) => r.change_revision_k)} unit="k" /></div>
        <div className="table-card">
          <table className="data-table">
            <thead><tr><th>Period</th><th>First level</th><th>Released</th><th>Latest level</th><th>Vintages</th><th>Level rev.</th><th>Change first</th><th>Change latest</th><th>Change rev.</th></tr></thead>
            <tbody>
              {nfp.rows.slice().reverse().map((r: RevisionLevelRow) => (
                <tr key={r.reference_period}>
                  <td>{r.reference_period}</td>
                  <td>{Math.round(r.first_value).toLocaleString("en-US")}</td>
                  <td style={{ color: "var(--muted)" }}>{r.first_release_date}</td>
                  <td>{Math.round(r.latest_value).toLocaleString("en-US")}</td>
                  <td style={{ color: "var(--muted)" }}>{r.n_vintages}</td>
                  <td style={{ color: "var(--muted)" }}>{k(r.revision_k)}</td>
                  <td>{k(r.change_first_k)}</td>
                  <td>{k(r.change_latest_k)}</td>
                  <td style={{ fontWeight: 600, color: r.change_revision_k == null || r.change_revision_k === 0 ? "var(--muted)" : r.change_revision_k > 0 ? "var(--accent-red)" : "var(--accent-emerald)" }}>{k(r.change_revision_k)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>

      <Section title="PCE price index — YoY as first printed vs latest">
        <div className="section-tools"><DownloadData filename="macrogauge-revisions-pce" json="revisions.json" rows={pce.rows} citation="MacroGauge PCE revisions (first print vs latest)" /></div>
        <div className="chart-card"><RevisionChart months={pce.rows.map((r) => r.reference_period)} values={pce.rows.map((r) => r.yoy_revision_pp)} unit="pp" /></div>
        <IndexTable rows={pce.rows} label="PCEPI" />
      </Section>

      <Section title="CPI — YoY as first printed vs latest">
        <div className="section-tools"><DownloadData filename="macrogauge-revisions-cpi" json="revisions.json" rows={cpi.rows} citation="MacroGauge CPI revisions (first print vs latest)" /></div>
        <IndexTable rows={cpi.rows} label="CPIAUCNS" />
        <p className="method">
          Vintage counts above one for CPI come from the ALFRED backfill and daily re-collection re-publishing the same
          value; the level revisions are zero to the third decimal, which is the receipt that CPI-U NSA is not revised.
          First-print YoY uses the first value over the latest base — the base was already final when the print landed —
          so the YoY revision isolates the print&apos;s own change. Window: last {data.window} periods per target.
        </p>
      </Section>
    </div>
  );
}
