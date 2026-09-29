import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import geoJson from "../../../../public/data/geo.json";
import { KpiCard } from "@/components/KpiCard";
import { Section } from "@/components/Section";
import { fmtMonth, fmtSigned } from "@/lib/format";
import { stateSlug, uniqueSlugs } from "@/lib/longtail";
import type { Geo, GeoMeasure, GeoStateRow } from "@/lib/types";

const geo = geoJson as Geo;
const STATES = uniqueSlugs(geo.states, (s) => stateSlug(s.state));

export const dynamicParams = false;
export function generateStaticParams() {
  return [...STATES.keys()].map((st) => ({ st }));
}

export async function generateMetadata({ params }: { params: Promise<{ st: string }> }): Promise<Metadata> {
  const s = STATES.get((await params).st);
  if (!s) return {};
  return {
    title: `${s.name} cost of living`,
    description: `${s.name}: gasoline, residential and industrial electricity, construction wages and unemployment vs the US average — updated daily from AAA, EIA, BLS QCEW and LAUS.`,
  };
}

const v = (m: GeoMeasure, f: (x: number) => string) => (m.value == null ? "—" : f(m.value));
const vs = (m: GeoMeasure, n: GeoMeasure) =>
  m.value == null || n.value == null ? "" : ` · ${fmtSigned((m.value / n.value - 1) * 100)} vs US`;
const when = (d: string | null) => (d ? fmtMonth(d) : "—");

export default async function StatePage({ params }: { params: Promise<{ st: string }> }) {
  const s: GeoStateRow | undefined = STATES.get((await params).st);
  if (!s) notFound();
  const n = geo.national;
  return (
    <div>
      <h1>{s.name} <span className="subtitle">state prices &amp; labor vs the US</span></h1>
      <p className="lede">Where {s.name} sits against the national average on the prices households and builders feel first. All states: <Link href="/states">/states</Link>.</p>
      <div className="kpi-row">
        <KpiCard label="Regular gasoline" value={v(s.gas_regular, (x) => `$${x.toFixed(2)}`)} context={`AAA · ${s.gas_regular.as_of ?? "—"}${vs(s.gas_regular, n.gas_regular)}`} accent="amber" />
        <KpiCard label="Residential electricity" value={v(s.elec_res_cents, (x) => `${x.toFixed(2)}¢/kWh`)} context={`EIA · ${when(s.elec_res_cents.as_of)} · ${fmtSigned(s.elec_res_cents.yoy_pct)} YoY${vs(s.elec_res_cents, n.elec_res_cents)}`} accent="sky" />
        <KpiCard label="Industrial electricity" value={v(s.elec_ind_cents, (x) => `${x.toFixed(2)}¢/kWh`)} context={`EIA · ${when(s.elec_ind_cents.as_of)} · ${fmtSigned(s.elec_ind_cents.yoy_pct)} YoY${vs(s.elec_ind_cents, n.elec_ind_cents)}`} accent="violet" />
      </div>
      <Section title="Labor">
        <div className="kpi-row">
          <KpiCard label="Construction avg weekly wage" value={v(s.wage_weekly, (x) => `$${Math.round(x).toLocaleString("en-US")}`)} context={`BLS QCEW · ${when(s.wage_weekly.as_of)} · ${fmtSigned(s.wage_weekly.yoy_pct)} YoY${vs(s.wage_weekly, n.wage_weekly)}`} accent="emerald" />
          <KpiCard label="Unemployment rate" value={s.unemployment_pct.value == null ? "—" : `${s.unemployment_pct.value.toFixed(1)}%`} context={`BLS LAUS · ${when(s.unemployment_pct.as_of)} · ${s.unemployment_pct.delta_1y_pp == null ? "—" : `${s.unemployment_pct.delta_1y_pp >= 0 ? "+" : ""}${s.unemployment_pct.delta_1y_pp.toFixed(1)}pp`} over 1y · US ${n.unemployment_pct.value?.toFixed(1) ?? "—"}%`} accent="red" />
        </div>
        <p className="method">Each figure carries its own source date — they update on different schedules. Data: <a href="/data/geo.json">geo.json</a>.</p>
      </Section>
    </div>
  );
}
