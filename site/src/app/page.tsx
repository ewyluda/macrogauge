import type { Metadata } from "next";
import Link from "next/link";
import pulse from "../../public/data/pulse.json";
import official from "../../public/data/official.json";
import status from "../../public/data/sources_status.json";
import gaugeDaily from "../../public/data/gauge_daily.json";
import compare from "../../public/data/compare.json";
import gaptable from "../../public/data/gaptable.json";
import grocery from "../../public/data/grocery_basket.json";
import nextprintJson from "../../public/data/nextprint.json";
import fuelJson from "../../public/data/fuel.json";
import outlookJson from "../../public/data/outlook.json";
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
import { OutlookChart } from "@/components/OutlookChart";
import { Countdown } from "@/components/Countdown";
import { ForecastNumberLine } from "@/components/ForecastNumberLine";
import { fmtMonth, fmtPct, fmtSigned, fmtMoney, yoyColor } from "@/lib/format";

// Numbers are baked at build time, so the tab title is a live headline —
// refreshed by the daily publish like everything else.
export const metadata: Metadata = {
  title: {
    absolute: `US inflation today: ${fmtPct(pulse.gauge.yoy_pct)} macrogauge vs ${fmtPct(pulse.official.yoy_pct)} official CPI`,
  },
};
import type { Fuel, NextPrint, Outlook } from "@/lib/types";

// Cast, don't infer: these artifacts legally degrade (see lib/types.ts).
const nextprint = nextprintJson as NextPrint;
const fuel = fuelJson as Fuel;
// component_paths (~11KB) and the full parameters block are unconsumed by the
// chart — strip them so they never enter the client component's RSC payload.
const { component_paths: _componentPaths, parameters: outlookParams, ...outlookRest } = outlookJson;
const outlook = {
  ...outlookRest,
  parameters: { baseline_annual_pct: outlookParams.baseline_annual_pct },
} as Outlook;

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

// the public-debt level is quoted in dollars; every other quote fits fmtMoney
const fmtQuote = (q: (typeof official.quotes)[number]) =>
  q.code === "fiscal_debt_total"
    ? `$${(q.latest / 1e12).toFixed(2)}T`
    : fmtMoney(q.latest, q.unit);

export default function Home() {
  const { cpi, core } = official.headline;
  const quote = (code: string) => official.quotes.find((q) => q.code === code);
  const gas = quote("eia_gasreg_w");
  const mortgage = quote("pmms_30yr");
  const gold = quote("fmp_gold");
  const debt = quote("fiscal_debt_total");
  const movers = [...official.components]
    .sort((a, b) => Math.abs(b.mom_pct) - Math.abs(a.mom_pct))
    .slice(0, 6);
  // both dates are baked by the same publish, so this flips on exactly the
  // morning run that lands on release day
  const printDay =
    nextprint.release_date != null &&
    pulse.published_at.slice(0, 10) === nextprint.release_date;

  return (
    <div className="home-dashboard">
      {printDay && (
        <div className="print-banner">
          <span className="print-banner-tag">🔴 CPI day</span>
          <span>
            The {nextprint.reference_month} print lands at 8:30 AM ET — calls
            below are frozen and grade automatically on the{" "}
            <Link href="/scoreboard">scoreboard</Link>.
          </span>
        </div>
      )}
      <div className="home-kicker">
        <span>Daily US inflation &amp; macro</span>
        <span>Published {pulse.published_at}</span>
        <span>{pulse.gauge.coverage_pct.toFixed(0)}% live basket coverage</span>
      </div>

      <div className="headline-grid">
        <KpiCard
          label="Macrogauge · YoY"
          value={fmtPct(pulse.gauge.yoy_pct)}
          context={`CPI-comparable · as of ${pulse.gauge.as_of}`}
          accent="sky"
          chip={<DeltaChip value={pulse.gap_pp} prefix="vs official" pp />}
        />
        <KpiCard
          label="CPI-Tracker · YoY"
          value={fmtPct(pulse.tracker.yoy_pct)}
          context="BLS shelter dynamics · built to re-track the print"
          accent="violet"
          chip={<DeltaChip value={pulse.tracker_gap_pp} prefix="gap" pp />}
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
        <KpiCard
          label="Next CPI · ensemble MoM"
          value={nextprint.ensemble.value == null ? "—" : `${nextprint.ensemble.value.toFixed(2)}%`}
          context={
            nextprint.reference_month
              ? `${nextprint.reference_month} · releases ${nextprint.release_date ?? "TBA"}`
              : "TBA (release calendar awaiting refresh)"
          }
          accent="emerald"
        />
      </div>

      <Section title="Macrogauge vs official — YoY since 2018" featured>
        <div className="hero-chart-card">
          <HeroChart
            dates={gaugeDaily.variants.gauge.dates}
            gauge={gaugeDaily.variants.gauge.yoy_pct}
            tracker={gaugeDaily.variants.tracker.yoy_pct}
            col={gaugeDaily.variants.col.yoy_pct}
            months={compare.months}
            official={compare.official_yoy_pct}
            core={compare.official_core_yoy_pct}
          />
        </div>
        <div className="chart-caption">
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

      <div className="dashboard-row">
        <section className="dashboard-panel next-print-panel">
          <div className="panel-title">◴ Next CPI print — {nextprint.reference_month ?? "TBA"}</div>
          <div className="release-date">{nextprint.release_date ?? "TBA"}</div>
          <Countdown releaseDate={nextprint.release_date} />
          <div className="panel-muted">BLS release · previous print {fmtPct(cpi.yoy_pct)} YoY</div>
          <ForecastNumberLine calls={nextprint.forecasters} />
          <div className="panel-foot">
            Ensemble {nextprint.ensemble.value == null ? "—" : `${nextprint.ensemble.value.toFixed(2)}%`} MoM
            {Object.keys(nextprint.ensemble.weights).length > 0
              ? ` · weights ${Object.entries(nextprint.ensemble.weights)
                  .map(([n, w]) => `${n} ${(w * 100).toFixed(0)}%`)
                  .join(" · ")}`
              : " · awaiting forecaster calls"}
          </div>
        </section>

        <section className="dashboard-panel market-panel">
          <div className="panel-title">▥ Market pulse — live transmission channels</div>
          <div className="market-grid">
            {gas && <div><span>Regular gas</span><strong>{fmtMoney(gas.latest, gas.unit)}</strong><small>{fmtSigned(gas.yoy_pct)} YoY</small></div>}
            {mortgage && <div><span>30Y mortgage</span><strong>{fmtMoney(mortgage.latest, mortgage.unit)}</strong><small>{fmtSigned(mortgage.yoy_pct)} YoY</small></div>}
            {gold && <div><span>Gold</span><strong>{fmtMoney(gold.latest, gold.unit)}</strong><small>{fmtSigned(gold.yoy_pct)} YoY</small></div>}
            {debt && <div><span>Public debt</span><strong>${(debt.latest / 1e12).toFixed(2)}T</strong><small>{fmtSigned(debt.yoy_pct)} YoY</small></div>}
          </div>
          <div className="panel-foot">
            Fuel: pump {fuel.pump == null ? "—" : `$${fuel.pump.toFixed(2)}`} →{" "}
            {fuel.forward_2wk == null ? "—" : `$${fuel.forward_2wk.toFixed(2)}`} in 2 weeks
            {fuel.available && fuel.proxy ? ` · implied by ${fuel.proxy}` : ""} · {fuel.as_of ?? "awaiting data"}
          </div>
        </section>

        <section className="dashboard-panel movers-panel">
          <div className="panel-title">ϟ Top movers — official CPI</div>
          <div className="mover-list">
            {movers.map((mover) => (
              <div key={mover.code}>
                <span>{mover.mom_pct >= 0 ? "▲" : "▼"} {mover.label}</span>
                <strong className={mover.mom_pct >= 0 ? "hot" : "cool"}>{fmtSigned(mover.mom_pct)}</strong>
                <small>MoM</small>
              </div>
            ))}
          </div>
          <div className="panel-foot">Ranked by absolute monthly move · {fmtMonth(cpi.month)} print</div>
        </section>
      </div>

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

      <Section title="Macrogauge outlook — next 12 months" featured>
        <OutlookChart outlook={outlook} />
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

      <Section title="Quote board — official prices across the basket">
        <div className="quote-board">
          {official.quotes.map((q) => (
            <div className="quote-tile" key={q.code}>
              <span className="quote-group">{GROUP_TITLES[q.group] ?? q.group}</span>
              <span className="quote-label">{q.label}</span>
              <strong>{fmtQuote(q)}</strong>
              <span className="quote-meta">
                <DeltaChip value={q.yoy_pct} prefix="YoY" />
                <small>{q.obs_date}</small>
              </span>
            </div>
          ))}
        </div>
      </Section>

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
            <Link
              key={s.name}
              href="/status"
              title={s.error ?? `${s.name} ok · last pull ${s.finished_at}`}
              style={{ textDecoration: "none" }}
            >
              <StatusPill
                ok={s.ok}
                label={`${s.name} · ${s.latest_obs ?? "never"}`}
              />
            </Link>
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
