import pulse from "../../public/data/pulse.json";
import official from "../../public/data/official.json";
import qa from "../../public/data/qa.json";
import status from "../../public/data/sources_status.json";
import gaugeDaily from "../../public/data/gauge_daily.json";
import compare from "../../public/data/compare.json";
import gaptable from "../../public/data/gaptable.json";
import grocery from "../../public/data/grocery_basket.json";
import nextprintJson from "../../public/data/nextprint.json";
import fuelJson from "../../public/data/fuel.json";
import { KpiCard } from "@/components/KpiCard";
import { DeltaChip } from "@/components/DeltaChip";
import { StatusPill } from "@/components/StatusPill";
import { Section } from "@/components/Section";
import { HeroChart } from "@/components/HeroChart";
import { Treemap } from "@/components/Treemap";
import { QuiltHeatmap } from "@/components/QuiltHeatmap";
import { GapTable } from "@/components/GapTable";
import { GapDecomposition } from "@/components/GapDecomposition";
import { SparklineCard } from "@/components/SparklineCard";
import { ForecastTable } from "@/components/ForecastTable";
import { fmtMonth, fmtPct, fmtSigned, fmtMoney, yoyColor } from "@/lib/format";
import type { Fuel, NextPrint } from "@/lib/types";

// Cast, don't infer: these artifacts legally degrade (see lib/types.ts).
const nextprint = nextprintJson as NextPrint;
const fuel = fuelJson as Fuel;

const GROUP_TITLES: Record<string, string> = {
  grocery: "Grocery basket",
  energy: "Energy",
  rates: "Rates",
  markets: "Markets",
  fiscal: "Fiscal",
};

// faithful six (original homepage row); the other items stay published-but-
// unfeatured until the Phase 5 cart page
const FEATURED_GROCERY: [string, string][] = [
  ["APU0000708111", "Eggs (dozen)"],
  ["APU0000709112", "Milk (gallon)"],
  ["APU0000703112", "Ground beef (lb)"],
  ["APU0000702111", "Bread (lb)"],
  ["APU000072610", "Electricity (kWh)"],
  ["APU000072620", "Utility gas (therm)"],
];

function QuoteCard({ q }: { q: (typeof official.quotes)[number] }) {
  return (
    <div
      style={{
        background: "var(--card)",
        border: "1px solid var(--border)",
        borderRadius: 10,
        padding: 12,
        minWidth: 150,
        flex: "1 1 150px",
      }}
    >
      <div
        style={{
          fontSize: 11,
          letterSpacing: "0.08em",
          textTransform: "uppercase",
          color: "var(--muted)",
        }}
      >
        {q.label}
      </div>
      <div
        style={{
          fontSize: 22,
          fontWeight: 700,
          fontVariantNumeric: "tabular-nums",
          margin: "2px 0",
        }}
      >
        {fmtMoney(q.latest, q.unit)}
      </div>
      <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
        <DeltaChip value={q.yoy_pct} prefix="YoY" />
        <span style={{ fontSize: 11, color: "var(--muted)" }}>{q.obs_date}</span>
      </div>
    </div>
  );
}

export default function Home() {
  const { cpi, core } = official.headline;
  const quote = (code: string) => official.quotes.find((q) => q.code === code);
  const gas = quote("eia_gasreg_w");
  const mortgage = quote("pmms_30yr");
  const gold = quote("fmp_gold");
  const debt = quote("fiscal_debt_total");
  const groups = ["grocery", "energy", "rates", "markets", "fiscal"] as const;

  return (
    <div>
      <div style={{ color: "var(--muted)", fontSize: 13, marginTop: 16 }}>
        daily US inflation &amp; macro · published {pulse.published_at} ·
        independent gauge + official data
      </div>

      <div style={{ display: "flex", gap: 16, flexWrap: "wrap", marginTop: 24 }}>
        <KpiCard
          label="Macrogauge · YoY"
          value={fmtPct(pulse.gauge.yoy_pct)}
          context={`${pulse.gauge.coverage_pct.toFixed(0)}% live weight · as of ${pulse.gauge.as_of}`}
          accent="sky"
          chip={<DeltaChip value={pulse.gap_pp} prefix="vs official" pp />}
        />
        <KpiCard
          label="Official CPI · YoY"
          value={fmtPct(cpi.yoy_pct)}
          context={`${fmtMonth(cpi.month)} print · prev ${fmtPct(cpi.prev_yoy_pct)} · as of ${cpi.as_of}`}
          accent="amber"
        />
        <KpiCard
          label="Core CPI · YoY"
          value={fmtPct(core.yoy_pct)}
          context={`${fmtMonth(core.month)} print · prev ${fmtPct(core.prev_yoy_pct)} · as of ${core.as_of}`}
          accent="amber"
        />
        {gas && (
          <KpiCard
            label="Gas · regular"
            value={fmtMoney(gas.latest, gas.unit)}
            context={`${fmtSigned(gas.yoy_pct)} YoY · wk of ${gas.obs_date}`}
            accent="sky"
          />
        )}
        {mortgage && (
          <KpiCard
            label="30yr mortgage"
            value={fmtMoney(mortgage.latest, mortgage.unit)}
            context={`${fmtSigned(mortgage.yoy_pct)} YoY · ${mortgage.obs_date}`}
            accent="sky"
          />
        )}
        {gold && (
          <KpiCard
            label="Gold"
            value={fmtMoney(gold.latest, gold.unit)}
            context={`${fmtSigned(gold.yoy_pct)} YoY · ${gold.obs_date}`}
            accent="violet"
          />
        )}
        {debt && (
          <KpiCard
            label="Public debt"
            value={`$${(debt.latest / 1e12).toFixed(2)}T`}
            context={`${fmtSigned(debt.yoy_pct)} YoY · ${debt.obs_date}`}
            accent="violet"
          />
        )}
      </div>

      <Section title={nextprint.release_date
          ? `Next CPI print — ${nextprint.reference_month} · ${nextprint.release_date}`
          : "Next CPI print — TBA (release calendar awaiting refresh)"}>
        <div className="kpi-row">
          <KpiCard label="Ensemble · MoM"
            value={nextprint.ensemble.value == null ? "—" : `${nextprint.ensemble.value.toFixed(2)}%`}
            context={`${nextprint.forecasters.length} available forecasters · unavailable inputs excluded`}
            accent="sky" />
          <KpiCard label="Fuel · two-week forward"
            value={fuel.forward_2wk == null ? "—" : `$${fuel.forward_2wk.toFixed(3)}`}
            context={fuel.available && fuel.proxy ? `${fuel.proxy} · ${fuel.as_of}` : "awaiting sufficient market history"}
            accent="amber" />
        </div>
        <ForecastTable rows={nextprint.forecasters} />
        <div className="method">Fuel formula: {fuel.formula}</div>
      </Section>

      <Section title="Macrogauge vs official — YoY since 2018">
        <div
          style={{
            background: "var(--card)",
            border: "1px solid var(--border)",
            borderRadius: 10,
            padding: "12px 8px 4px",
          }}
        >
          <HeroChart
            dates={gaugeDaily.variants.gauge.dates}
            gauge={gaugeDaily.variants.gauge.yoy_pct}
            tracker={gaugeDaily.variants.tracker.yoy_pct}
            months={compare.months}
            official={compare.official_yoy_pct}
            core={compare.official_core_yoy_pct}
          />
        </div>
        <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 8 }}>
          {compare.validation.gauge.lead_lag ? (
            <>
              <span style={{ color: "var(--accent-sky)", fontWeight: 600 }}>
                LEAD-LAG:
              </span>{" "}
              gauge today correlates {compare.validation.gauge.lead_lag.corr}{" "}
              with official CPI{" "}
              {compare.validation.gauge.lead_lag.best_shift_months} month
              {compare.validation.gauge.lead_lag.best_shift_months === 1
                ? ""
                : "s"}{" "}
              ahead ·{" "}
            </>
          ) : null}
          CPI-TRACKER {fmtPct(pulse.tracker.yoy_pct)} — built to re-track the
          print · {pulse.gauge.coverage_pct.toFixed(0)}% of basket weight rides
          live data
        </div>
      </Section>

      <Section title="Basket treemap — every component, replay 2018 → now">
        <Treemap />
      </Section>

      <Section title="Component gap decomposition — ours vs BLS">
        <GapDecomposition
          rows={gaptable.rows}
          asOf={gaptable.as_of}
          officialMonth={gaptable.official_month}
          totalGapPp={gaptable.total_gap_pp}
        />
      </Section>

      <Section title="Macrogauge vs official — gap table">
        <GapTable
          rows={[
            {
              index: "US CPI",
              sub: "daily gauge",
              oursYoy: pulse.gauge.yoy_pct,
              oursAsOf: pulse.gauge.as_of,
              officialYoy: pulse.official.yoy_pct,
              officialMonth: pulse.official.month,
            },
            {
              index: "CPI-Tracker",
              sub: "official shelter dynamics",
              oursYoy: pulse.tracker.yoy_pct,
              oursAsOf: pulse.tracker.as_of,
              officialYoy: pulse.official.yoy_pct,
              officialMonth: pulse.official.month,
            },
          ]}
          nextPrint={pulse.next_print}
          cumulativePct={
            gaugeDaily.variants.gauge.index[
              gaugeDaily.variants.gauge.index.length - 1
            ] - 100
          }
        />
      </Section>

      <Section title="Inflation quilt — every component, every month">
        <QuiltHeatmap />
      </Section>

      <Section title={`Official CPI components — YoY (${fmtMonth(cpi.month)} print)`}>
        <div
          style={{
            background: "var(--card)",
            border: "1px solid var(--border)",
            borderRadius: 10,
            overflow: "hidden",
          }}
        >
          <table
            style={{
              width: "100%",
              borderCollapse: "collapse",
              fontVariantNumeric: "tabular-nums",
            }}
          >
            <thead>
              <tr>
                {["Component", "YoY", "MoM"].map((h, i) => (
                  <th
                    key={h}
                    style={{
                      textAlign: i === 0 ? "left" : "right",
                      fontSize: 11,
                      letterSpacing: "0.08em",
                      textTransform: "uppercase",
                      color: "var(--muted)",
                      fontWeight: 500,
                      padding: "10px 16px",
                      borderBottom: "1px solid var(--border)",
                    }}
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {official.components.map((c) => (
                <tr key={c.code}>
                  <td
                    style={{
                      padding: "8px 16px",
                      fontSize: 14,
                      borderBottom: "1px solid var(--border)",
                    }}
                  >
                    {c.label}
                  </td>
                  <td
                    style={{
                      padding: "8px 16px",
                      fontSize: 14,
                      fontWeight: 600,
                      textAlign: "right",
                      color: yoyColor(c.yoy_pct),
                      borderBottom: "1px solid var(--border)",
                    }}
                  >
                    {fmtSigned(c.yoy_pct)}
                  </td>
                  <td
                    style={{
                      padding: "8px 16px",
                      fontSize: 14,
                      textAlign: "right",
                      color: yoyColor(c.mom_pct),
                      borderBottom: "1px solid var(--border)",
                    }}
                  >
                    {fmtSigned(c.mom_pct)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>

      {groups.map((g) => (
        <Section key={g} title={GROUP_TITLES[g]}>
          <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
            {official.quotes
              .filter((q) => q.group === g)
              .map((q) => (
                <QuoteCard key={q.code} q={q} />
              ))}
          </div>
        </Section>
      ))}

      <Section title="Grocery basket — BLS average prices">
        <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
          {FEATURED_GROCERY.map(([code, label]) => {
            const item = grocery.items.find((i) => i.code === code);
            if (!item) return null; // graceful before a code's first collect
            return (
              <SparklineCard
                key={code}
                label={label}
                price={`$${item.price.toFixed(2)}`}
                yoyPct={item.yoy_pct}
                asOf={fmtMonth(item.month)}
                prices={item.series.prices}
              />
            );
          })}
        </div>
        <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 8 }}>
          BLS average prices (AP series), monthly, national city average — as of{" "}
          {grocery.as_of ? fmtMonth(grocery.as_of) : "—"}. Sparkline = full monthly
          history since 2018.
        </div>
      </Section>

      <Section title="Sources">
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {status.sources.map((s) => (
            <StatusPill
              key={s.name}
              ok={s.ok}
              label={`${s.name} · ${s.latest_obs ?? "never"}`}
            />
          ))}
        </div>
        <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 12 }}>
          All figures from official/public sources (BLS, FRED, EIA, Zillow, Freddie
          Mac, U.S. Treasury, FMP) — collected daily, published with as-of dates. The
          independent macrogauge index re-prices the CPI basket daily from live
          market and public data ({pulse.gauge.coverage_pct.toFixed(0)}% of basket
          weight today; the rest carries official BLS values forward between
          prints).
        </div>
      </Section>
    </div>
  );
}
