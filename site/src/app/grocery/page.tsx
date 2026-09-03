import type { Metadata } from "next";
import grocery from "../../../public/data/grocery_basket.json";
import { KpiCard } from "@/components/KpiCard";
import { DownloadData } from "@/components/DownloadData";
import { Section } from "@/components/Section";
import { SparklineCard } from "@/components/SparklineCard";
import { DeltaChip } from "@/components/DeltaChip";
import { fmtMonth, fmtPp, fmtSigned, fmtStamp, yoyColor } from "@/lib/format";
import { TailSpark } from "@/components/TailSpark";
import { cardLabel, cleanName } from "@/lib/groceryLabels";

export const metadata: Metadata = {
  title: "Grocery Prices",
  description:
    "Every BLS average-price grocery staple, monthly since 2018 — sorted hottest to coolest YoY.",
};

type Wholesale = { code: string; name: string; retail_code: string; as_of: string | null; value: number | null; yoy_pct: number | null; retail_yoy_pct: number | null; spread_pp: number | null; series: { dates: string[]; values: number[] } };
type GroceryItem = {
  code: string;
  name: string;
  month: string;
  price: number;
  mom_pct: number;
  yoy_pct: number;
  series: { months: string[]; prices: number[] };
};

export default function Grocery() {
  const items = (grocery.items as GroceryItem[])
    .slice()
    .sort((a, b) => b.yoy_pct - a.yoy_pct);
  const skipped = grocery.skipped as string[];
  const wholesale = (grocery as { wholesale?: Wholesale[] }).wholesale ?? [];
  // items can legally be empty (every staple skipped on a degraded run) —
  // degrade the KPIs, never crash the static export
  const hottest: GroceryItem | undefined = items[0];
  const coolest: GroceryItem | undefined = items[items.length - 1];

  return (
    <div>
      <h1>
        Grocery Prices{" "}
        <span className="subtitle">
          every BLS average-price staple, monthly since 2018
        </span>
      </h1>

      <div className="section-tools">
        <DownloadData
          filename="macrogauge-grocery"
          json="grocery_basket.json"
          citation={`MacroGauge grocery staples (BLS average prices), published ${grocery.published_at}`}
          rows={items.map(({ series: _s, ...r }) => r)}
        />
      </div>
      <div className="kpi-row">
        <KpiCard
          label="Items tracked"
          value={String(items.length)}
          context={`BLS average-price staples · as of ${
            grocery.as_of ? fmtMonth(grocery.as_of) : "—"
          }`}
          accent="sky"
        />
        <KpiCard
          label="Hottest YoY"
          value={hottest ? fmtSigned(hottest.yoy_pct) : "—"}
          context={hottest ? `${cleanName(hottest.name).title} · ${fmtMonth(hottest.month)}` : "no items published this run"}
          accent="red"
        />
        <KpiCard
          label="Coolest YoY"
          value={coolest ? fmtSigned(coolest.yoy_pct) : "—"}
          context={coolest ? `${cleanName(coolest.name).title} · ${fmtMonth(coolest.month)}` : "no items published this run"}
          accent="emerald"
        />
      </div>

      <Section title="Farm to shelf — USDA wholesale vs the BLS shelf price" featured>
        <div className="table-card">
          <table className="data-table">
            <thead><tr><th style={{ textAlign: "left" }}>Staple</th><th>Wholesale</th><th>Wholesale YoY</th><th>Retail YoY</th><th>Spread</th><th>Wholesale as of</th><th>2y</th></tr></thead>
            <tbody>
              {wholesale.map((w) => {
                const retail = items.find((i) => i.code === w.retail_code);
                return (
                  <tr key={w.code}>
                    <td style={{ textAlign: "left" }}>{w.name}<div className="subtitle">vs {retail ? cleanName(retail.name).title : w.retail_code}</div></td>
                    <td>{w.value == null ? "—" : w.value.toFixed(2)}</td>
                    <td style={{ color: yoyColor(w.yoy_pct) }}>{fmtSigned(w.yoy_pct)}</td>
                    <td style={{ color: yoyColor(w.retail_yoy_pct) }}>{fmtSigned(w.retail_yoy_pct)}</td>
                    <td style={{ color: w.spread_pp == null ? "var(--muted)" : w.spread_pp > 0 ? "var(--accent-red)" : "var(--accent-emerald)", fontWeight: 600 }}>{fmtPp(w.spread_pp)}</td>
                    <td style={{ color: "var(--muted)" }}>{w.as_of ?? "—"}</td>
                    <td><TailSpark tail={w.series.values} /></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <p className="method">
          USDA AMS weekly national wholesale prices beside the BLS average retail price they feed. Units differ by
          design (the broiler composite is ¢/lb, bacon is $/lb) — only the year-over-year rates are compared. A positive
          spread means the shelf price is rising faster than the farm-gate price: margin, not input cost.
        </p>
      </Section>

      <Section title="All staples — sorted hottest to coolest YoY">
        <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
          {items.map((item) => (
            <div
              key={item.code}
              style={{
                flex: "1 1 190px",
                minWidth: 190,
                display: "flex",
                flexDirection: "column",
                gap: 4,
              }}
            >
              <SparklineCard
                label={cardLabel(item.name)}
                price={`$${item.price.toFixed(2)}`}
                yoyPct={item.yoy_pct}
                asOf={fmtMonth(item.month)}
                prices={item.series.prices}
              />
              <div style={{ fontSize: 11, color: "var(--muted)", paddingLeft: 2 }}>
                <DeltaChip value={item.mom_pct} prefix="MoM" />
              </div>
            </div>
          ))}
        </div>
        {skipped.length > 0 ? (
          <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 12 }}>
            Unavailable this run:{" "}
            {skipped.map((s) => (
              <span key={s} className="badge badge-muted" style={{ marginRight: 6 }}>
                {s}
              </span>
            ))}
          </div>
        ) : null}
      </Section>

      <p className="method">
        BLS Average Price (AP) series, U.S. city average, monthly — national
        average dollar prices, not indexes. Sparkline = full monthly history
        since Jan 2018. Cards are sorted by published YoY change (hottest
        first); MoM and YoY come from the pipeline as published, nothing is
        computed here. Items whose latest print lags a month show their own
        as-of date. Published {fmtStamp(grocery.published_at)}.
      </p>
    </div>
  );
}
