import type { Metadata } from "next";
import gaugeDaily from "../../../public/data/gauge_daily.json";
import compareJson from "../../../public/data/compare.json";
import officialJson from "../../../public/data/official.json";
import gaptable from "../../../public/data/gaptable.json";
import accountabilityPce from "../../../public/data/accountability_pce.json";
import basket from "../../../../config/basket.json";
import { KpiCard } from "@/components/KpiCard";
import { Section } from "@/components/Section";
import { LinesChart } from "@/components/LinesChart";
import { DownloadData } from "@/components/DownloadData";
import { Citation } from "@/components/Citation";
import { GradeTable, reconcileCalls } from "@/components/GradeTable";
import { C } from "@/lib/chartTheme";
import { columnsToRows } from "@/lib/csv";
import { fmtMonth, fmtPct, fmtPp } from "@/lib/format";

// Both official PCE fields were added 2026-09-03 (batch 2a) and are
// optional in their schemas until the next publish regenerates the
// artifacts — read them as absent-tolerant, never as required.
type HeadlineRow = { month: string; yoy_pct: number; prev_yoy_pct: number; as_of: string };
const compare = compareJson as typeof compareJson & { official_pce_yoy_pct?: (number | null)[] };
const officialPce = (officialJson.headline as { pce?: HeadlineRow | null }).pce ?? null;

const pce = gaugeDaily.variants.pce;
let last = pce.yoy_pct.length - 1;
while (last >= 0 && pce.yoy_pct[last] === null) last--;
const pceYoy = last >= 0 ? (pce.yoy_pct[last] as number) : null;
const pceAsOf = last >= 0 ? pce.dates[last] : null;
const summary = gaptable.variants.pce;
const gap = pceYoy != null && officialPce ? pceYoy - officialPce.yoy_pct : null;
const from = compare.months.findIndex((m) => m >= "2019-01-01");
const officialSeries = compare.official_pce_yoy_pct ?? compare.months.map(() => null);
const hasOfficialHistory = officialSeries.some((v) => v != null);
const weights = (basket.components as { code: string; label: string; weight: number; pce_weight: number }[])
  .slice()
  .sort((a, b) => b.pce_weight - a.pce_weight);

export const metadata: Metadata = {
  title: `PCE Gauge — ${pceYoy == null ? "—" : fmtPct(pceYoy)} YoY under BEA shares`,
  description:
    "The same 14 live components re-weighted with PCE expenditure shares and graded against the PCE price index the Fed targets.",
};

export default function Pce() {
  return (
    <div>
      <h1>
        PCE Gauge{" "}
        <span className="subtitle">the Fed&apos;s index, re-priced daily under BEA shares</span>
      </h1>
      <p className="lede">
        The Fed targets PCE, not CPI. This variant keeps every live component of the gauge and swaps the CPI
        relative-importance weights for hand-seeded BEA expenditure shares — less shelter, far more medical care —
        then grades itself against the official PCE price index (PCEPI).
      </p>
      <div className="kpi-row">
        <KpiCard
          label="PCE gauge · YoY"
          value={pceYoy == null ? "—" : fmtPct(pceYoy)}
          context={`${summary.coverage_pct.toFixed(0)}% of PCE weight rides live · as of ${pceAsOf ?? "—"}`}
          accent="sky"
        />
        <KpiCard
          label="Official PCEPI · YoY"
          value={officialPce ? fmtPct(officialPce.yoy_pct) : "—"}
          context={officialPce
            ? `${fmtMonth(officialPce.month)} print · prev ${fmtPct(officialPce.prev_yoy_pct)} · as of ${officialPce.as_of}`
            : "publishes with the next daily run"}
          accent="amber"
        />
        <KpiCard
          label="Gap vs PCEPI"
          value={gap == null ? "—" : fmtPp(gap)}
          context={gap == null ? "needs both readings" : "gauge minus the latest official print"}
          accent={gap == null ? "sky" : gap > 0 ? "red" : "emerald"}
        />
        <KpiCard
          label="Validation"
          value={compare.validation.pce.corr == null ? "—" : compare.validation.pce.corr.toFixed(3)}
          context={`correlation vs PCEPI · mean abs gap ${compare.validation.pce.mean_abs_gap_pp ?? "—"}pp · ${compare.validation.pce.window}`}
          accent="violet"
        />
      </div>
      <Citation
        series="PCE-weighted gauge YoY"
        asOf={pceAsOf ?? gaugeDaily.published_at.slice(0, 10)}
        rebase={gaugeDaily.rebase}
        value={pceYoy == null ? "—" : `${fmtPct(pceYoy)} YoY`}
        path="/pce"
      />

      <Section title="PCE gauge vs official PCEPI — monthly, since 2019" featured>
        <div className="section-tools">
          <DownloadData
            filename="macrogauge-pce-monthly"
            json="compare.json"
            citation={`MacroGauge PCE-weighted gauge vs PCEPI, monthly, ${compare.validation.pce.window}`}
            rows={columnsToRows({ name: "month", values: compare.months }, [
              { name: "pce_gauge_yoy_pct", values: compare.pce_yoy_pct },
              { name: "official_pcepi_yoy_pct", values: officialSeries },
            ])}
          />
        </div>
        <div className="chart-card">
          <LinesChart
            series={[
              { name: "PCE gauge (ours)", x: compare.months.slice(from), y: compare.pce_yoy_pct.slice(from), color: C.sky },
              { name: "Official PCEPI", x: compare.months.slice(from), y: officialSeries.slice(from), color: C.amber, dashed: true, step: true },
            ]}
            refLine={2}
            refLabel="Fed 2% target"
          />
        </div>
        {!hasOfficialHistory && (
          <p className="method">
            The official PCEPI history line publishes with the next daily run (the field was added 2026-09-03);
            until then only the gauge is drawn. The validation stats above already grade against PCEPI.
          </p>
        )}
      </Section>

      <Section title="PCE calls — graded against every print">
        <GradeTable rows={reconcileCalls(accountabilityPce)} keyPrefix="pce" />
        <p className="method">
          The monthly PCE nowcast is a CPI pass-through (see <a href="/matrix">the matrix</a>); the daily PCE gauge
          above is a separate object — a re-weighting of live prices, not a forecast.
        </p>
      </Section>

      <Section title="Weights — CPI relative importance vs BEA PCE share">
        <div className="table-card">
          <table className="data-table">
            <thead>
              <tr><th>Component</th><th>CPI weight</th><th>PCE weight</th><th>Shift</th></tr>
            </thead>
            <tbody>
              {weights.map((c) => (
                <tr key={c.code}>
                  <td style={{ textAlign: "left" }}>{c.label}</td>
                  <td>{(c.weight * 100).toFixed(1)}%</td>
                  <td>{(c.pce_weight * 100).toFixed(1)}%</td>
                  <td style={{ color: c.pce_weight > c.weight ? "var(--accent-red)" : "var(--accent-emerald)" }}>
                    {fmtPp((c.pce_weight - c.weight) * 100)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="method">
          PCE shares are hand-seeded approximations of BEA&apos;s expenditure weights over our 14 coarse components
          (config/basket.json, <code>pce_weight</code>), not a BEA-published table. They sum to one; the biggest
          swing is medical care (PCE counts employer- and government-paid care that CPI excludes) against shelter.
        </p>
      </Section>
    </div>
  );
}
