import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import metrosJson from "../../../../public/data/metros.json";
import { KpiCard } from "@/components/KpiCard";
import { Section } from "@/components/Section";
import { TailSpark } from "@/components/TailSpark";
import { fmtMonth, fmtSigned } from "@/lib/format";
import { metroSlug, uniqueSlugs } from "@/lib/longtail";
import type { Metro, MetroBlock, Metros } from "@/lib/types";

const metros = metrosJson as Metros;
const METROS = uniqueSlugs(metros.metros, (m) => metroSlug(m.name));

export const dynamicParams = false;
export function generateStaticParams() {
  return [...METROS.keys()].map((m) => ({ m }));
}

export async function generateMetadata({ params }: { params: Promise<{ m: string }> }): Promise<Metadata> {
  const m = METROS.get((await params).m);
  if (!m) return {};
  return {
    title: `${m.name} rent & home prices`,
    description: `${m.name}: typical market rent (Zillow ZORI) ${m.zori.value == null ? "" : `$${Math.round(m.zori.value).toLocaleString("en-US")} `}${fmtSigned(m.zori.yoy_pct)} YoY and typical home value (ZHVI) ${fmtSigned(m.zhvi.yoy_pct)} YoY vs the US.`,
  };
}

function Block({ label, b, us, money }: { label: string; b: MetroBlock; us: MetroBlock; money: (x: number) => string }) {
  return (
    <div className="table-card" style={{ padding: 16 }}>
      <div className="kpi-row">
        <KpiCard label={label} value={b.value == null ? "—" : money(b.value)} context={b.as_of ? fmtMonth(b.as_of) : "—"} accent="sky" />
        <KpiCard label="Year over year" value={fmtSigned(b.yoy_pct)} context={`US ${fmtSigned(us.yoy_pct)}`} accent={(b.yoy_pct ?? 0) > (us.yoy_pct ?? 0) ? "red" : "emerald"} />
      </div>
      <TailSpark tail={b.yoy_tail.yoy_pct} />
      <p className="method">YoY, last {b.yoy_tail.months.length} months ({b.yoy_tail.months[0] ? fmtMonth(b.yoy_tail.months[0]) : "—"} onward).</p>
    </div>
  );
}

export default async function MetroPage({ params }: { params: Promise<{ m: string }> }) {
  const m: Metro | undefined = METROS.get((await params).m);
  if (!m) notFound();
  const usd = (x: number) => `$${Math.round(x).toLocaleString("en-US")}`;
  return (
    <div>
      <h1>{m.name} <span className="subtitle">market rent &amp; home values</span></h1>
      <p className="lede">Zillow’s typical market rent (ZORI) and home value (ZHVI) for the {m.name} metro — the asking-price signals that lead CPI shelter by about a year. All metros: <Link href="/metros">/metros</Link>.</p>
      <Section title="Rent"><Block label="Typical market rent" b={m.zori} us={metros.national.zori} money={(x) => `${usd(x)}/mo`} /></Section>
      <Section title="Home values"><Block label="Typical home value" b={m.zhvi} us={metros.national.zhvi} money={usd} /></Section>
      <p className="method">Data: <a href="/data/metros.json">metros.json</a> (Zillow Research, monthly).</p>
    </div>
  );
}
