import type { Metadata } from "next";
import type { ReactNode } from "react";
import Link from "next/link";
import pulseJson from "../../../public/data/pulse.json";
import officialJson from "../../../public/data/official.json";
import matrixJson from "../../../public/data/matrix.json";
import { DownloadData } from "@/components/DownloadData";
import { TailSpark } from "@/components/TailSpark";
import { fmtDay, fmtMonth } from "@/lib/format";
import type { Matrix, MatrixRow } from "@/lib/types";
import { BREADTH_LATEST } from "@/components/BreadthPanel";
import { LinesChart } from "@/components/LinesChart";
import { C } from "@/lib/chartTheme";

export const metadata: Metadata = {
  title: "Inflation Matrix — escalation inputs and every measure",
  description:
    "The cost inputs construction escalation clauses index to — PPI, import prices, the tariff rate, employment costs — with 24-month trails, then every underlying and expected inflation measure in one table.",
};
const pulse = pulseJson as {
  gauge: { yoy_pct: number; as_of: string };
  tracker: { yoy_pct: number; as_of: string };
  official: { yoy_pct: number; month: string };
};
const official = officialJson as {
  headline: {
    cpi: { yoy_pct: number; month: string };
    core: { yoy_pct: number; month: string };
  };
};
const matrix = matrixJson as Matrix;

type Row = {
  label: string;
  value: number | null;
  unit: string;
  as_of: string | null;
  cadence: string;
};
type Section = { group: string; rows: Row[] };

// escalation inputs lead the page (scorecard session 4): PPI, imports, the
// tariff rate and employment costs first, then the rest of the pipeline
// group; every other group stays in the measures table below
const ESCALATION_GROUPS = ["PIPELINE", "LABOR COSTS"];
const ESCALATION_ORDER = ["PPIACO", "IREXPETCOM", "CHNTOT", "B235RC1Q027SBEA/A255RC1Q027SBEA", "ECIALLCIV", "ULCNFB"];
const rank = (code: string) => (ESCALATION_ORDER.indexOf(code) + 1 || ESCALATION_ORDER.length + 1);
const INPUTS: MatrixRow[] = matrix.groups
  .filter((g) => ESCALATION_GROUPS.includes(g.group))
  .flatMap((g) => g.rows)
  .sort((a, b) => rank(a.code) - rank(b.code));

const SECTIONS: Section[] = [
  {
    group: "OURS (DAILY)",
    rows: [
      { label: "Macrogauge (CPI-comparable)", value: pulse.gauge.yoy_pct,
        unit: "% YoY", as_of: pulse.gauge.as_of, cadence: "daily" },
      { label: "Tracker (official-shelter)", value: pulse.tracker.yoy_pct,
        unit: "% YoY", as_of: pulse.tracker.as_of, cadence: "daily" },
      // Batch 3c: our own robust-central cuts over the 14 coarse components,
      // beside the Cleveland/Atlanta measures below (which trim 45+ items).
      { label: "Macrogauge 16% trimmed mean (14 components)", value: BREADTH_LATEST?.trimmedMean ?? null,
        unit: "% YoY", as_of: BREADTH_LATEST ? `${BREADTH_LATEST.month}-01` : null, cadence: "monthly" },
      { label: "Macrogauge weighted median (14 components)", value: BREADTH_LATEST?.weightedMedian ?? null,
        unit: "% YoY", as_of: BREADTH_LATEST ? `${BREADTH_LATEST.month}-01` : null, cadence: "monthly" },
    ],
  },
  {
    group: "OFFICIAL",
    rows: [
      // "As of" is the reference month, matching every other row — the BLS
      // release date (headline.*.as_of) reads a month late in this column
      { label: "CPI-U (headline)", value: official.headline.cpi.yoy_pct,
        unit: "% YoY", as_of: official.headline.cpi.month, cadence: "monthly" },
      { label: "Core CPI (ex food & energy)", value: official.headline.core.yoy_pct,
        unit: "% YoY", as_of: official.headline.core.month, cadence: "monthly" },
    ],
  },
  ...matrix.groups.filter((g) => !ESCALATION_GROUPS.includes(g.group)).map((g) => ({
    group: g.group,
    rows: g.rows.map((r) => ({
      label: r.label, value: r.value, unit: r.unit,
      as_of: r.as_of, cadence: r.cadence,
    })),
  })),
];

function fmtChg(v: number | null | undefined, unit: MatrixRow["chg_unit"]): string {
  if (v == null) return "—";
  const sign = v > 0 ? "+" : v < 0 ? "−" : "";
  return `${sign}${Math.abs(v).toFixed(2)}${unit === "%" ? "%" : unit === "pp" ? "pp" : ""}`;
}

/** an index row's 12-month change is its YoY; before the 2026-10-08 fields
 *  publish, fall back to the computed YoY the row already carries */
function chg12(r: MatrixRow): number | null {
  if (r.chg_12m !== undefined) return r.chg_12m;
  return r.unit.startsWith("% YoY") ? r.value : null;
}

function takeaway(): string | null {
  const by = (code: string) => INPUTS.find((r) => r.code === code);
  const ppi = by("PPIACO");
  const eci = by("ECIALLCIV");
  const p12 = ppi ? chg12(ppi) : null;
  const e12 = eci ? chg12(eci) : null;
  if (p12 == null || e12 == null) return null;
  const p3 = ppi?.chg_3m;
  return `Producer prices are ${fmtChg(p12, "%")} over 12 months${p3 != null ? ` (${fmtChg(p3, "%")} in the last three)` : ""}; employment costs ${fmtChg(e12, "%")}.`;
}

function EscalationInputs() {
  const lead = takeaway();
  return (
    <div className="section" id="inputs">
      <h2 style={{ fontSize: 18, margin: "0 0 4px" }}>Construction &amp; escalation inputs</h2>
      {lead && <p className="lede" data-testid="inputs-takeaway" style={{ marginTop: 0 }}>{lead}</p>}
      <div className="table-card">
        <table className="data-table" data-testid="escalation-inputs">
          <thead>
            <tr><th>Input</th><th>3-month</th><th>12-month</th><th>Last 24 months</th><th>As of</th></tr>
          </thead>
          <tbody>
            {INPUTS.map((r) => (
              <tr key={r.code}>
                <td>{r.label}
                  {r.chg_unit !== "%" && r.value != null && !r.unit.startsWith("% YoY") && (
                    <small style={{ display: "block", color: "var(--muted)" }}>now {r.value.toFixed(2)} {r.unit}</small>)}
                </td>
                <td>{fmtChg(r.chg_3m, r.chg_unit)}</td>
                <td>{fmtChg(chg12(r), r.chg_unit ?? "%")}</td>
                <td>{r.trail ? <TailSpark tail={r.trail.values} stroke="var(--accent-sky)" label={r.label} /> : "—"}</td>
                <td>{r.as_of ? fmtMonth(r.as_of) : "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="method">
        The series construction escalation clauses most often index to. An index (PPI, import prices, the
        Employment Cost Index, unit labor costs) moves in percent of its level; the supply-chain pressure index
        moves in points and the effective tariff rate in percentage points. Quarterly series step one quarter for
        the 3-month change. The trail is the raw level over the last 24 months, not its year-over-year rate. Build
        materials and equipment PPIs are on <Link href="/commodities">Build Inputs</Link>; construction wages and openings
        on <Link href="/labor#construction">Labor</Link>.
      </p>
    </div>
  );
}

function MeasureRows({ section }: { section: Section }) {
  const out: ReactNode[] = [
    <tr key={`h-${section.group}`}>
      <td
        colSpan={4}
        style={{
          textAlign: "left", color: "var(--muted)", fontSize: 11,
          fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.08em",
          paddingTop: 14,
        }}
      >
        {section.group}
      </td>
    </tr>,
  ];
  for (const r of section.rows) {
    out.push(
      <tr key={`${section.group}-${r.label}`}>
        <td>{r.label}</td>
        <td>
          {r.value == null ? "—" : r.value.toFixed(2)}{" "}
          <span style={{ color: "var(--muted)", fontSize: 11 }}>{r.unit}</span>
        </td>
        <td>{r.as_of ? (r.cadence === "daily" ? fmtDay(r.as_of) : fmtMonth(r.as_of)) : "—"}</td>
        <td>{r.cadence}</td>
      </tr>
    );
  }
  return <>{out}</>;
}

export default function Matrix() {
  return (
    <div>
      <h1>
        Inflation Matrix <span className="subtitle">escalation inputs, then every measure</span>
      </h1>
      <div className="section-tools">
        <DownloadData filename="macrogauge-matrix" json="matrix.json"
          citation={`MacroGauge inflation matrix, published ${matrix.published_at}`}
          rows={[
            ...INPUTS.map((r) => ({ group: "ESCALATION INPUTS", label: r.label, value: r.value, unit: r.unit, as_of: r.as_of,
              cadence: r.cadence, chg_3m: r.chg_3m ?? null, chg_12m: chg12(r), chg_unit: r.chg_unit ?? null })),
            ...SECTIONS.flatMap((s) => s.rows.map((r) => ({ group: s.group, ...r }))),
          ]} />
      </div>
      <EscalationInputs />
      <div className="section">
        <h2 style={{ fontSize: 18, margin: "0 0 4px" }}>Every inflation measure</h2>
        <p className="method" style={{ marginTop: 0 }}>
          Our daily gauge and tracker, the official CPI prints, the Fed&apos;s
          underlying-inflation cuts, market and survey expectations, and the euro
          area — one table, each with its own as-of and cadence. Values are shown
          verbatim from source except rows marked computed, which are
          year-over-year off a raw index level. Next-print nowcasts are on{" "}
          <Link href="/cpi-preview">CPI Preview</Link>, <Link href="/pce">PCE</Link> and <Link href="/labor">Labor</Link>.
        </p>
        <div className="table-card">
          <table className="data-table">
            <thead>
              <tr>
                <th>Measure</th>
                <th>Latest</th>
                <th>As of</th>
                <th>Cadence</th>
              </tr>
            </thead>
            <tbody>
              {SECTIONS.map((s) => (
                <MeasureRows key={s.group} section={s} />
              ))}
            </tbody>
          </table>
        </div>
      </div>
      {matrix.tariffs && matrix.tariffs.history.dates.length > 0 && (
        <div className="section">
          <h2 style={{ fontSize: 18, margin: "0 0 4px" }}>
            Effective tariff rate{" "}
            <span className="subtitle">
              {matrix.tariffs.rate_pct == null ? "—" : `${matrix.tariffs.rate_pct.toFixed(2)}%`} of goods imports ·{" "}
              {matrix.tariffs.as_of ? fmtQuarter(matrix.tariffs.as_of) : "—"}
            </span>
          </h2>
          <div className="chart-card">
            <LinesChart height={240} recessions={false}
              series={[{ name: "Customs duties / goods imports (%)", x: matrix.tariffs.history.dates,
                         y: matrix.tariffs.history.rate_pct, color: C.amber, step: true }]} />
          </div>
          <p className="method">
            Federal customs duties ({matrix.tariffs.numerator}) over imports of goods ({matrix.tariffs.denominator}),
            both BEA NIPA quarterly at seasonally adjusted annual rates, so the annualization cancels. This is the
            duty actually collected per dollar of goods imported — below the statutory rate whenever exemptions,
            trade diversion or collection lags bite. Quarterly, a month after the quarter closes.
          </p>
        </div>
      )}
    </div>
  );
}

function fmtQuarter(day: string): string {
  const m = Number(day.slice(5, 7));
  return `${day.slice(0, 4)}Q${Math.floor((m - 1) / 3) + 1}`;
}
