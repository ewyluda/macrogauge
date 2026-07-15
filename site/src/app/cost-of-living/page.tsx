import type { Metadata } from "next";
import gaugeDaily from "../../../public/data/gauge_daily.json";
import pulse from "../../../public/data/pulse.json";
import compare from "../../../public/data/compare.json";
import gaptable from "../../../public/data/gaptable.json";
import { KpiCard } from "@/components/KpiCard";
import { Section } from "@/components/Section";
import { ColChart } from "@/components/ColChart";
import { fmtPct, fmtPp } from "@/lib/format";

export const metadata: Metadata = {
  title: "Cost of Living",
  description:
    "The marginal buyer's inflation — owned shelter priced as today's payment: 0.80× ZHVI financed at the daily 30-year rate.",
};

export default function CostOfLiving() {
  const col = gaugeDaily.variants.col;
  const gauge = gaugeDaily.variants.gauge;
  const colSummary = gaptable.variants.col;
  // latest non-null COL YoY and its own date — never the raw grid end
  let last = col.yoy_pct.length - 1;
  while (last >= 0 && col.yoy_pct[last] === null) last--;
  // last === -1 when the variant publishes with no usable YoY yet — degrade,
  // don't crash the static export
  const colYoy = last >= 0 ? (col.yoy_pct[last] as number) : null;
  const colAsOf = last >= 0 ? col.dates[last] : null;
  const spread = colYoy == null ? null : colYoy - pulse.gauge.yoy_pct;

  // chart from 2019 — all variants share one publish grid, so one cut serves both lines
  const from = col.dates.findIndex((d) => d >= "2019-01-01");
  const mFrom = compare.months.findIndex((m) => m >= "2019-01-01");

  return (
    <div>
      <h1 style={{ fontSize: 26, fontWeight: 700, margin: "24px 0 0" }}>
        Cost of Living{" "}
        <span style={{ color: "var(--muted)", fontWeight: 400, fontSize: 16 }}>
          the marginal buyer&apos;s inflation — own-home payment priced at
          today&apos;s rate
        </span>
      </h1>

      <div style={{ display: "flex", gap: 16, flexWrap: "wrap", marginTop: 24 }}>
        <KpiCard
          label="Cost of Living YoY (today)"
          value={colYoy == null ? "—" : fmtPct(colYoy)}
          context={
            colYoy == null
              ? "awaiting a full year of col history"
              : `as of ${colAsOf} · ${colSummary.coverage_pct.toFixed(0)}% of basket weight live`
          }
          accent="amber"
        />
        <KpiCard
          label="Headline macrogauge"
          value={fmtPct(pulse.gauge.yoy_pct)}
          context={`the full-basket gauge, rental-equivalence shelter · as of ${pulse.gauge.as_of}`}
          accent="sky"
        />
        <KpiCard
          label="Spread"
          value={fmtPp(spread)}
          context={`cost of living minus headline — the buy-in premium · col ${colAsOf ?? "—"} vs gauge ${pulse.gauge.as_of}`}
          accent={spread != null && spread > 0 ? "red" : "emerald"}
        />
      </div>

      <Section title="Cost of Living vs macrogauge — YoY since 2019">
        <div
          style={{
            background: "var(--card)",
            border: "1px solid var(--border)",
            borderRadius: 10,
            padding: "12px 8px 4px",
          }}
        >
          <ColChart
            dates={col.dates.slice(from)}
            col={col.yoy_pct.slice(from)}
            gauge={gauge.yoy_pct.slice(from)}
            months={compare.months.slice(mFrom)}
            official={compare.official_yoy_pct.slice(mFrom)}
          />
        </div>
      </Section>

      <Section title="Methodology">
        <div style={{ fontSize: 13, color: "var(--muted)", lineHeight: 1.6 }}>
          Identical to the headline macrogauge in every component but one: owned
          shelter. CPI — and our gauge — prices the home you already own by
          rental equivalence (what it would rent for): the cost of{" "}
          <em>keeping</em> the life you have. Cost of Living instead prices the
          marginal buyer&apos;s payment — a home valued at 0.80× the Zillow Home
          Value Index, financed at the daily 30-year mortgage rate (Mortgage
          News Daily, Freddie Mac PMMS fallback): the cost of <em>buying</em>{" "}
          that life today. Everything else — food, energy, vehicles, services —
          rides the same live data as the gauge. Why it runs hotter when rates
          rise: the buyer&apos;s payment compounds two moving parts, the price
          of the house and the price of the money, so a rate jump raises the
          payment even while home prices sit still — and rental-equivalence CPI
          barely stirs. The divergence is the signal, not an error: vs official
          CPI it correlates {compare.validation.col.corr} with a mean absolute
          gap of {compare.validation.col.mean_abs_gap_pp}pp (
          {compare.validation.col.window}). See{" "}
          <a href="/methodology" style={{ color: "var(--accent-sky)" }}>
            methodology
          </a>{" "}
          for validation stats.
        </div>
      </Section>
    </div>
  );
}
