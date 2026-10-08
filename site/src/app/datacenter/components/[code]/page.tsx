import type { Metadata } from "next";
import Link from "next/link";
import dcJson from "../../../../../public/data/datacenter.json";
import longleadJson from "../../../../../public/data/longlead.json";
import basketJson from "../../../../../../config/dc_basket.json";
import seriesJson from "../../../../../../config/series.json";
import { KpiCard } from "@/components/KpiCard";
import { Section } from "@/components/Section";
import { DownloadData } from "@/components/DownloadData";
import { DcComponentChart } from "@/components/DcComponentChart";
import { artifact } from "@/lib/artifact";
import { annualized, ownSeries, yoySeries } from "@/lib/dcComponent";
import { DC_WEIGHT_BASIS, type DcIndexKey } from "@/lib/dcWeightBasis";
import { fmtDay, fmtMonth, fmtPp, fmtSigned } from "@/lib/format";

const dc = artifact("datacenter", dcJson);
const longlead = artifact("longlead", longleadJson);
const INDEXES: { key: DcIndexKey; label: string; href: string }[] = [
  { key: "build", label: "DC Build", href: "/datacenter" },
  { key: "ops", label: "DC Ops", href: "/datacenter" },
  { key: "hardware", label: "DC Hardware", href: "/datacenter" },
];
// the official series behind each component: basket config -> registry id
const SOURCE_ID = Object.fromEntries((seriesJson as { series: { code: string; source_id: string }[] }).series.map((s) => [s.code, s.source_id]));
const BASKET: Record<DcIndexKey, { code: string; series: string }[]> = basketJson;
const SERIES_OF = Object.fromEntries(INDEXES.flatMap(({ key }) => BASKET[key].map((c) => [c.code, c.series])));

const ALL = INDEXES.flatMap(({ key, label, href }) =>
  dc.indexes[key].components.map((c) => ({ ...c, index: key, indexLabel: label, indexHref: href })));
const BY_CODE = Object.fromEntries(ALL.map((c) => [c.code, c]));

export const dynamicParams = false;
export function generateStaticParams() {
  return ALL.map((c) => ({ code: c.code }));
}

export async function generateMetadata({ params }: { params: Promise<{ code: string }> }): Promise<Metadata> {
  const { code } = await params;
  const c = BY_CODE[code];
  return {
    title: `${c?.label ?? code} — ${fmtSigned(c?.yoy_pct ?? null)} YoY, ${c?.indexLabel ?? "DC"} component`,
    description: `${c?.label ?? code}: its weight in the ${c?.indexLabel ?? "DC"} index and why, the official series behind it, year-over-year, momentum, contribution${c && longlead.packages.some((p) => p.code === code) ? " and stated lead times" : ""}.`,
  };
}

export default async function DcComponentPage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const c = BY_CODE[code];
  const ix = dc.indexes[c.index];
  const siblings = ix.components;
  const i = siblings.findIndex((x) => x.code === code);
  const prev = siblings[(i + siblings.length - 1) % siblings.length];
  const next = siblings[(i + 1) % siblings.length];
  const s = ownSeries(ix.monthly.months, ix.monthly.components[code], c.last_obs);
  const yoy = yoySeries(s);
  const ann3 = annualized(s, 3);
  const ann6 = annualized(s, 6);
  const group = DC_WEIGHT_BASIS[c.index][c.group];
  const groupLabel = (dc.group_labels as Record<string, string>)[c.group] ?? c.group;
  const series = SERIES_OF[code];
  const sourceId = series ? SOURCE_ID[series] ?? series : null;
  const pkg = longlead.packages.find((p) => p.code === code);
  const tail = c.mode === "official+proxy";
  return (
    <div>
      <div className="component-nav" style={{ display: "flex", justifyContent: "space-between", fontSize: 12, color: "var(--muted)", marginTop: 8 }}>
        <Link href={`/datacenter/components/${prev.code}`}>← {prev.label}</Link>
        <span>{c.indexLabel} component {i + 1} of {siblings.length} · <Link href="/datacenter#dc-drivers">all components</Link></span>
        <Link href={`/datacenter/components/${next.code}`}>{next.label} →</Link>
      </div>
      <h1>
        {c.label} <span className="subtitle">{(c.weight * 100).toFixed(1)}% of the {c.indexLabel} index · {groupLabel}{sourceId ? ` · ${sourceId}` : ""}</span>
      </h1>
      <p className="lede">
        {tail
          ? `Rides the official series ${sourceId ?? ""} with a daily market tail spliced on past its last print, so it moves before the agency publishes.`
          : `Rides the official series ${sourceId ?? ""} as published: the index holds its last print until the next one lands.`}
      </p>
      <div className="kpi-row">
        <KpiCard label="YoY" value={fmtSigned(c.yoy_pct)} context={`at its own last reading, ${c.last_obs ? (tail ? fmtDay(c.last_obs) : fmtMonth(c.last_obs)) : "—"}${c.stale ? " · stale" : ""}`} accent="sky" />
        <KpiCard label={`Contribution to ${c.indexLabel}`} value={fmtPp(c.contribution_pp)} context={`weight × YoY · the index is ${fmtSigned(ix.headline_yoy_pct)} YoY`} accent="violet" />
        <KpiCard label="Momentum" value={fmtSigned(ann3)} context={`3-month change, annualized · 6-month ${fmtSigned(ann6)}`} accent="amber" />
        <KpiCard label="Weight" value={`${(c.weight * 100).toFixed(1)}%`} context={`${groupLabel} carries ${(group ? group.weight * 100 : 0).toFixed(0)}% of the index`} accent="emerald" />
      </div>

      <Section title="Monthly, last 36 months by default" featured>
        <div className="section-tools">
          <DownloadData filename={`macrogauge-dc-component-${code}`} json="datacenter.json"
            citation={`MacroGauge ${c.indexLabel} component ${c.label}, monthly, ${dc.rebase}, as of ${c.last_obs ?? ix.as_of}`}
            rows={s.months.map((m, k) => ({ month: m, level: s.levels[k], yoy_pct: yoy[k] }))} />
        </div>
        <div className="chart-card">
          <DcComponentChart months={s.months} levels={s.levels} yoy={yoy} label={c.label} rebase={dc.rebase} />
        </div>
        <p className="method">
          The component&apos;s level inside the {c.indexLabel} index ({dc.rebase}), cut at its own last reading: the index
          carries an official series flat between prints, and that flat stretch is left off here.
          {tail ? " Past the last official print the level is the daily market tail, averaged by month." : ""}
        </p>
      </Section>

      {group && (
        <Section title={`Why ${groupLabel.toLowerCase()} weighs ${(group.weight * 100).toFixed(0)}%`}>
          <p className="method" style={{ marginTop: 0 }}>
            {group.note}
            {group.cites.length > 0 && <> Sources: {group.cites.map((ct, k) => (
              <span key={ct.href}>{k > 0 && "; "}<a href={ct.href} target="_blank" rel="noopener noreferrer">{ct.label}</a></span>
            ))}.</>}
          </p>
        </Section>
      )}

      {pkg && pkg.lead_times && pkg.lead_times.length > 0 && (
        <Section title="Stated lead times" id="lead-times">
          <div className="table-card">
            <table className="data-table" data-testid="dc-lead-times">
              <thead><tr><th style={{ textAlign: "left" }}>Item</th><th>Weeks</th><th>Period</th><th style={{ textAlign: "left" }}>Source</th></tr></thead>
              <tbody>
                {pkg.lead_times.map((lt) => (
                  <tr key={`${lt.item}-${lt.period}`}>
                    <td style={{ textAlign: "left" }}>{lt.item}</td>
                    <td>{lt.weeks == null ? "—" : lt.weeks.toFixed(0)}{lt.through ? ` (through ${lt.through})` : ""}</td>
                    <td>{lt.period}</td>
                    <td style={{ textAlign: "left" }}><a href={lt.src.url} target="_blank" rel="noopener noreferrer">{lt.src.label}</a></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="method">Each figure as its source states it, quoted on the <Link href="/longlead">long-lead board</Link> with vendor order books.</p>
        </Section>
      )}

      <p className="method">
        Compare it with the other indexes since your bid month on the <Link href={`/calculator?series=${code},dc_${c.index}`}>Since-Date Calculator</Link>
        {c.index !== "hardware" && <>, or settle a clause on {sourceId} with the <Link href="/escalation/clause">clause kit</Link></>}.
      </p>
    </div>
  );
}
