import type { Metadata } from "next";
import type { ReactNode } from "react";
import nowcastJson from "../../../public/data/nowcast_latest.json";
import pulseJson from "../../../public/data/pulse.json";
import officialJson from "../../../public/data/official.json";
import matrixJson from "../../../public/data/matrix.json";
import { KpiCard } from "@/components/KpiCard";
import { ForecastHero } from "@/components/ForecastHero";
import { fmtMonth } from "@/lib/format";
import type { Nowcast, Matrix } from "@/lib/types";

export const metadata: Metadata = {
  title: "Inflation Matrix — every measure, one table",
  description:
    "Our daily gauge, the official prints, and the underlying/expectations measures the Fed watches — CPI, PCE and NFP nowcasts on top, side by side.",
};

const nowcast = nowcastJson as Nowcast;
const pulse = pulseJson as {
  gauge: { yoy_pct: number; as_of: string };
  tracker: { yoy_pct: number; as_of: string };
  official: { yoy_pct: number; month: string };
};
const official = officialJson as {
  headline: {
    cpi: { yoy_pct: number; as_of: string };
    core: { yoy_pct: number; as_of: string };
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

const SECTIONS: Section[] = [
  {
    group: "OURS (DAILY)",
    rows: [
      { label: "Macrogauge (CPI-comparable)", value: pulse.gauge.yoy_pct,
        unit: "% YoY", as_of: pulse.gauge.as_of, cadence: "daily" },
      { label: "Tracker (official-shelter)", value: pulse.tracker.yoy_pct,
        unit: "% YoY", as_of: pulse.tracker.as_of, cadence: "daily" },
    ],
  },
  {
    group: "OFFICIAL",
    rows: [
      { label: "CPI-U (headline)", value: official.headline.cpi.yoy_pct,
        unit: "% YoY", as_of: official.headline.cpi.as_of, cadence: "monthly" },
      { label: "Core CPI (ex food & energy)", value: official.headline.core.yoy_pct,
        unit: "% YoY", as_of: official.headline.core.as_of, cadence: "monthly" },
    ],
  },
  ...matrix.groups.map((g) => ({
    group: g.group,
    rows: g.rows.map((r) => ({
      label: r.label, value: r.value, unit: r.unit,
      as_of: r.as_of, cadence: r.cadence,
    })),
  })),
];

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
        <td>{r.as_of ? fmtMonth(r.as_of) : "—"}</td>
        <td>{r.cadence}</td>
      </tr>
    );
  }
  return <>{out}</>;
}

export default function Matrix() {
  const nfp = nowcast.nfp;
  return (
    <div>
      <h1>
        Inflation Matrix <span className="subtitle">models × targets</span>
      </h1>
      <ForecastHero />
      <div className="kpi-row">
        <KpiCard
          label="CPI bridge"
          value={nowcast.cpi.mom_pct == null ? "—" : `${nowcast.cpi.mom_pct.toFixed(2)}%`}
          context={`${nowcast.reference_month ?? "TBA"} MoM · ${nowcast.cpi.status.toUpperCase()}`}
          accent="sky"
        />
        <KpiCard
          label="PCE bridge"
          value={nowcast.pce.mom_pct == null ? "—" : `${nowcast.pce.mom_pct.toFixed(2)}%`}
          context={`${nowcast.pce.parameters.observations ?? "—"} rolling observations`}
          accent="violet"
        />
        <KpiCard
          label="NFP"
          value={nfp ? `${nfp.change_thousands}k` : "—"}
          context={nfp ? "payroll momentum − claims delta" : "awaiting sufficient history"}
          accent="emerald"
        />
      </div>

      <div className="section">
        <h2 style={{ fontSize: 18, margin: "0 0 4px" }}>Every inflation measure</h2>
        <p className="method" style={{ marginTop: 0 }}>
          Our daily gauge and tracker, the official CPI prints, the Fed&apos;s
          underlying-inflation cuts, pipeline pressure, and market expectations —
          one table, each with its own as-of and cadence. Values are shown
          verbatim from source except the two pipeline rows, which are computed
          year-over-year off a raw index level.
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
    </div>
  );
}
