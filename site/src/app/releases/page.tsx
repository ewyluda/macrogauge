import type { Metadata } from "next";
import releasesData from "../../../public/data/releases.json";
import { KpiCard } from "@/components/KpiCard";
import { Section } from "@/components/Section";
import { fmtMonth, fmtStamp } from "@/lib/format";

export const metadata: Metadata = {
  title: "Release Log",
  description:
    "First prints as they landed — the frozen vintage log behind every graded forecast.",
};

type Release = {
  target: string;
  reference_period: string;
  value: number;
  first_release_date: string;
};

const releases = releasesData.releases as Release[];

/** rows for one target, newest reference period first */
function byTarget(target: string): Release[] {
  return releases
    .filter((r) => r.target === target)
    .slice()
    .sort((a, b) => (a.reference_period < b.reference_period ? 1 : -1));
}

function PrintTable({
  rows,
  valueHeader,
  fmtValue,
}: {
  rows: Release[];
  valueHeader: string;
  fmtValue: (v: number) => string;
}) {
  return (
    <div className="table-card">
      <table className="data-table">
        <thead>
          <tr>
            <th>Reference period</th>
            <th>{valueHeader}</th>
            <th>First release date</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={`${r.target}-${r.reference_period}`}>
              <td>{fmtMonth(r.reference_period)}</td>
              <td>{fmtValue(r.value)}</td>
              <td>{r.first_release_date}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function Releases() {
  const cpi = byTarget("cpi");
  const pce = byTarget("pce");
  const nfp = byTarget("nfp");
  return (
    <div>
      <h1>
        Release Log{" "}
        <span className="subtitle">
          first prints as they landed — the evidence base for vintage-true grading
        </span>
      </h1>
      <p className="lede">
        Each row is a first print recorded the day it was released. This is the
        vintage log the scoreboard grades against — no restatements, ever.
      </p>
      <div className="kpi-row">
        <KpiCard
          label="CPI first prints"
          value={String(cpi.length)}
          context={cpi.length ? `latest: ${fmtMonth(cpi[0].reference_period)}` : "none yet"}
          accent="sky"
        />
        <KpiCard
          label="PCE first prints"
          value={String(pce.length)}
          context={pce.length ? `latest: ${fmtMonth(pce[0].reference_period)}` : "none yet"}
          accent="amber"
        />
        <KpiCard
          label="NFP first prints"
          value={String(nfp.length)}
          context={nfp.length ? `latest: ${fmtMonth(nfp[0].reference_period)}` : "none yet"}
          accent="violet"
        />
      </div>
      <Section title="CPI — first prints">
        <PrintTable
          rows={cpi}
          valueHeader="First print (index level)"
          fmtValue={(v) => v.toFixed(3)}
        />
      </Section>
      <Section title="PCE — first prints">
        <PrintTable
          rows={pce}
          valueHeader="First print (index level)"
          fmtValue={(v) => v.toFixed(3)}
        />
      </Section>
      <Section title="NFP — first prints">
        <PrintTable
          rows={nfp}
          valueHeader="First print (thousands of jobs)"
          fmtValue={(v) => Math.round(v).toLocaleString("en-US")}
        />
      </Section>
      <p className="method">
        First-release values are frozen as printed and never restated here —
        revisions land in later vintages, not in this log. CPI and PCE rows are
        index levels exactly as first published (not YoY rates); NFP rows are
        total-nonfarm payroll levels in thousands of jobs. Published{" "}
        {fmtStamp(releasesData.published_at)}.
      </p>
    </div>
  );
}
