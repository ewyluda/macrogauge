import type { Metadata } from "next";
import Link from "next/link";
import dc from "../../../public/data/datacenter.json";
import gradesJson from "../../../public/data/dc_grades.json";
import { KpiCard } from "@/components/KpiCard";
import { PowerPanel, type PowerData } from "@/components/PowerPanel";
import { StaleBanner } from "@/components/StaleBanner";
import { artifact } from "@/lib/artifact";
import { powerSummary } from "@/lib/dcHub";
import { fmtDay, fmtSigned } from "@/lib/format";
import type { DcGrades } from "@/lib/types";

// Split out of /datacenter (2026-10-07): the power bill is its own question —
// what a large load pays for energy, capacity and the tariff it signs — and
// the hub keeps a three-reading summary that links here.
const power = (dc.power ?? null) as PowerData | null;
const sum = powerSummary(power);

export const metadata: Metadata = {
  title: `Power & Tariffs: ${sum.headline ?? "wholesale power, capacity prices and large-load tariffs"}`,
  description: "Wholesale power at every major US hub, capacity prices by grid operator, and the large-load tariffs data centers sign, each with its source and date.",
};

// What the ops-nowcast backtest DECIDED, in English, derived from the verdict
// the gate recomputes every run — prose and figures come from the same
// object, so a flip to PASS can never leave "it lost" standing beside correct
// numbers. FAIL states the GATE, not one comparison: the verdict fires when
// the selected candidate misses any of its three conditions.
const NOWCAST_CLAUSE: Record<string, string> = {
  FAIL: "its best pass-through candidate failed the pre-registered backtest gate",
  PASS:
    "it beat both naive baselines — carry-forward and zero pass-through — inside " +
    "the pre-registered error bound, a result still under review",
  INSUFFICIENT:
    "the backtest could not be graded on this publish, so nothing is claimed either way",
};
// True under every verdict: clearing the backtest is a precondition for
// changing the index, not the change itself.
const NOWCAST_STANDING =
  "the ops index stays on official retail data and the machinery ships config-gated";
const pn = artifact<"dc_grades", DcGrades>("dc_grades", gradesJson).power_nowcast;

export default function Power() {
  const asOf = power?.hubs.reduce((d, h) => (h.asof > d ? h.asof : d), "") || dc.indexes.ops.as_of;
  return (
    <div className="datacenter-dashboard">
      <StaleBanner publishedAt={[dc.published_at, gradesJson.published_at]} />
      <header className="research-intro">
        <div className="research-eyebrow">AI infrastructure · Power &amp; Tariffs <span>Updated {fmtDay(asOf)}</span></div>
        <h1>{sum.headline ?? "Power & Tariffs"}</h1>
        <p>What a data center pays for power: wholesale prices at every major hub, the capacity charges grid operators
          pass through, and the large-load tariffs utilities now require. Part of the{" "}
          <Link href="/datacenter">Data Center Cost Index</Link>.</p>
      </header>
      {!power ? (
        <p className="method">Power data is unavailable in this publish.</p>
      ) : (
        <>
          <div className="kpi-row">
            {sum.hub && (
              <KpiCard label={`${sum.hub.label} · 30-day avg`}
                value={sum.hub.avg30 != null ? `$${sum.hub.avg30.toFixed(2)}/MWh` : "—"}
                context={`${fmtSigned(sum.hub.avg30_yoy_pct ?? null)} vs a year earlier · the hottest hub this month`} accent="red" />
            )}
            {sum.capacity && (
              <KpiCard label={`${sum.capacity.iso} capacity · ${sum.capacity.period}`}
                value={`$${Math.round(sum.capacity.price).toLocaleString("en-US")}/MW-day`}
                context={`from $${Math.round(sum.capacity.firstPrice).toLocaleString("en-US")} for ${sum.capacity.first}`} accent="violet" />
            )}
            {sum.tariffs > 0 && (
              <KpiCard label="Large-load tariffs" value={String(sum.tariffs)}
                context="utilities' data-center terms, each from a filing or order" accent="sky" />
            )}
          </div>
          <section className="dc-section" id="power-bill"><PowerPanel power={power} /></section>
        </>
      )}
      <section className="dc-section dc-method" aria-labelledby="power-method-title">
        <h2 id="power-method-title">How it&apos;s built</h2>
        <p className="method">
          Day-ahead hub prices come straight from each operator&apos;s public files (CAISO SP15, MISO Indiana Hub,
          ERCOT North, SPP North and NYISO Zone A, daily all-hours averages); PJM Western Hub, Palo Verde, Mid-Columbia
          and ISO-NE Mass Hub are on-peak trade averages from EIA&apos;s ICE workbook, updated about every two weeks.
          Each hub shows its own 30-day average against the same window a year earlier. Capacity prices are the
          operators&apos; published auction results (MISO&apos;s seasonal prices are annualized; ISO-NE and NYISO
          prices converted from $/kW-month), and ERCOT, SPP and CAISO are labeled rather than priced because they run
          no capacity auction. The utility tariff table is hand-curated from commission orders, tariff sheets and SEC
          filings, each row citing its source and date.
        </p>
        <p className="method">
          All of it is market visibility only. The DC Ops index deliberately stays on official retail data: wholesale
          swings ~3× seasonally while tariff-smoothed retail is seasonally flat, so a level-spliced wholesale tail would
          fabricate seasonal inflation (we measured it, then pulled it). We then built the honest alternative — a
          like-month year-ratio nowcast, which cancels seasonality by construction — and backtested it against
          realized retail prints before letting it touch the index: <span data-testid="power-nowcast-grade">
          {pn ? NOWCAST_CLAUSE[pn.verdict] ?? NOWCAST_CLAUSE.INSUFFICIENT : "the backtest result is unavailable in this publish"}
          {pn ? ` — ${pn.verdict}` : ""}
          {pn && pn.best_mae != null && pn.carry_forward_mae != null && pn.as_of != null
            ? ` (best MAE ${pn.best_mae.toFixed(3)} vs ${pn.carry_forward_mae.toFixed(3)} YoY pts over ${pn.months_graded} months, as of ${pn.as_of})`
            : ""}</span>. Either way {NOWCAST_STANDING}. Wholesale tells you about the grid; it does not nowcast
          tariff-cycle retail rates.
        </p>
      </section>
    </div>
  );
}
