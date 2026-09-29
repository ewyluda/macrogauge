import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import grocery from "../../../../public/data/grocery_basket.json";
import { KpiCard } from "@/components/KpiCard";
import { Section } from "@/components/Section";
import { SparklineCard } from "@/components/SparklineCard";
import { fmtMonth, fmtSigned, yoyColor } from "@/lib/format";
import { cleanName } from "@/lib/groceryLabels";
import { grocerySlug, uniqueSlugs } from "@/lib/longtail";

type GroceryItem = { code: string; name: string; month: string; price: number; mom_pct: number;
  yoy_pct: number; series: { months: string[]; prices: number[] } };
const ITEMS = uniqueSlugs(grocery.items as GroceryItem[], (i) => grocerySlug(i.name));

export const dynamicParams = false;
export function generateStaticParams() {
  return [...ITEMS.keys()].map((item) => ({ item }));
}

export async function generateMetadata({ params }: { params: Promise<{ item: string }> }): Promise<Metadata> {
  const it = ITEMS.get((await params).item);
  if (!it) return {};
  const { title, unit } = cleanName(it.name);
  return {
    title: `${title} price`,
    description: `US average price of ${title.toLowerCase()}${unit ? ` (per ${unit})` : ""}: $${it.price.toFixed(2)} in ${fmtMonth(it.month)}, ${fmtSigned(it.yoy_pct)} YoY — BLS average price ${it.code}, monthly since 2018.`,
  };
}

export default async function GroceryItemPage({ params }: { params: Promise<{ item: string }> }) {
  const it = ITEMS.get((await params).item);
  if (!it) notFound();
  const { title, unit } = cleanName(it.name);
  const s = it.series;
  const idx = (months: number) => s.prices.length > months ? s.prices[s.prices.length - 1 - months] : null;
  const fiveYr = idx(60);
  return (
    <div>
      <h1>{title} <span className="subtitle">US average price{unit ? ` · per ${unit}` : ""} · {fmtMonth(it.month)}</span></h1>
      <p className="lede">The Bureau of Labor Statistics’ national average price for {title.toLowerCase()} (series {it.code}), collected for the CPI. Part of the <Link href="/grocery">grocery basket</Link>.</p>
      <div className="kpi-row">
        <KpiCard label="Average price" value={`$${it.price.toFixed(2)}`} context={fmtMonth(it.month)} accent="sky" />
        <KpiCard label="Year over year" value={fmtSigned(it.yoy_pct)} context="vs the same month last year" accent={it.yoy_pct > 0 ? "red" : "emerald"} />
        <KpiCard label="Month over month" value={fmtSigned(it.mom_pct)} context="not seasonally adjusted" accent="violet" />
        {fiveYr != null && <KpiCard label="Five years ago" value={`$${fiveYr.toFixed(2)}`} context={`${fmtSigned((it.price / fiveYr - 1) * 100)} since`} accent="amber" />}
      </div>
      <Section title="Price history">
        <SparklineCard label={title} price={`$${it.price.toFixed(2)}`} yoyPct={it.yoy_pct} asOf={it.month} prices={s.prices} />
        <p className="method">Monthly, {fmtMonth(s.months[0])} – {fmtMonth(s.months[s.months.length - 1])}. YoY colour: <span style={{ color: yoyColor(it.yoy_pct) }}>{fmtSigned(it.yoy_pct)}</span>. Data: <a href="/data/grocery_basket.json">grocery_basket.json</a>.</p>
      </Section>
    </div>
  );
}
