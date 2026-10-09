import type { Metadata } from "next";
import Link from "next/link";
import marketsJson from "../../../public/data/dc_markets.json";
import { KpiCard } from "@/components/KpiCard";
import { DownloadData } from "@/components/DownloadData";
import { flattenRow } from "@/lib/csv";
import { MarketsClient } from "@/components/markets/MarketsClient";
import { tightnessScore } from "@/lib/dcMarkets";
import type { DcMarkets } from "@/lib/types";
import { StaleBanner } from "@/components/StaleBanner";
import { artifact } from "@/lib/artifact";
import { fmtDay } from "@/lib/format";

const data = artifact<"dc_markets", DcMarkets>("dc_markets", marketsJson);
const nat = data.national;
const elecNat = data.elec_national;
const pipeSrc = data.market_pipeline_source;
const live = data.markets.filter((m) => m.available);
// Ranked by the same composite the table's tightness badge uses — wage
// spread alone can crown a different market than the hottest badge.
const hottest = live
  .filter((m) => tightnessScore(m) !== null)
  .sort((a, b) => tightnessScore(b)! - tightnessScore(a)!)[0];

export const metadata: Metadata = {
  title: `DC Market Panel: construction labor across ${live.length} data-center markets`,
  description:
    `Construction wages and headcount where the data centers actually are — county resolution, against the national rate, for ${data.markets.length} real DC markets.`,
};

export default function Page() {
  return (
    <div>
      <StaleBanner publishedAt={marketsJson.published_at} />
      {/* the shared research-intro header (eyebrow, H1, one dek) puts the KPIs in
          the first screen; the why-counties prose joins "How it's built" */}
      <header className="research-intro">
        <div className="research-eyebrow">AI infrastructure · DC markets <span>Updated {fmtDay(data.published_at)}</span></div>
        <h1>DC Market Panel</h1>
        <p>
          How tight is the labor where you&apos;re building? Construction wages and headcount in the core counties of{" "}
          {data.markets.length} real data-center markets, measured against the national rate.
        </p>
      </header>
      <div className="kpi-row">
        <KpiCard label="National construction wage"
          value={nat.wage != null ? `$${nat.wage.toLocaleString("en-US")}/wk` : "—"}
          context={nat.wage_yoy_pct != null
            ? `${nat.wage_yoy_pct > 0 ? "+" : ""}${nat.wage_yoy_pct}% YoY · private NAICS 23`
            : "awaiting first QCEW quarter"} accent="sky" />
        <KpiCard label="National headcount"
          value={nat.emp != null ? `${(nat.emp / 1e6).toFixed(2)}M` : "—"}
          context={nat.emp_yoy_pct != null
            ? `${nat.emp_yoy_pct > 0 ? "+" : ""}${nat.emp_yoy_pct}% YoY`
            : "—"} accent="amber" />
        <KpiCard label="Tightest market"
          value={hottest ? hottest.name : "—"}
          context={hottest && hottest.wage_spread_pp != null
            ? `${hottest.wage_spread_pp > 0 ? "+" : ""}${hottest.wage_spread_pp}pp wage vs national`
            : "—"} accent="violet" />
        <KpiCard label="Markets covered"
          value={`${live.length} / ${data.markets.length}`}
          context="the rest are BLS disclosure-suppressed" accent="sky" />
      </div>
      <div className="page-asof">
        <DownloadData filename="macrogauge-dc-markets" json="dc_markets.json"
          citation={`MacroGauge DC market panel, published ${data.published_at}`}
          rows={data.markets.map((m) => flattenRow(m))} />
        <span>
          QCEW quarter <b>{data.as_of ?? "—"}</b> vs <b>{data.base_date ?? "—"}</b>
          {" "}· roster curated <b>{data.as_of_curated}</b>. QCEW publishes about 5–6
          months after quarter end — these are the freshest county wages that exist, not
          a current reading · <a href="#mk-method">How it&apos;s built</a>
        </span>
      </div>
      <MarketsClient data={data} />
      <section id="mk-method" className="mk-method" aria-labelledby="mk-method-title">
      <h2 id="mk-method-title">How it&apos;s built</h2>
      <div className="dc-method-grid">
      <div><h3>Why county resolution</h3><p className="method">
        State resolution averages Loudoun with Bristol. This is{" "}
        <b>construction wages and headcount where the shovels are</b> — tight
        core counties for {data.markets.length} real data-center markets,
        measured against the national rate. Craft labor is the constraint
        nobody prices until it bites: a market adding construction workers
        twice as fast as the country is a market where your subcontractor
        coverage is thinning.
      </p></div>
      <div><h3>Eight-quarter trend</h3><p className="method">
        The sparkline under each market&apos;s worker count is its construction headcount over the
        last eight QCEW quarters, summed over the counties reported in <b>all</b> of them, so the
        line moves on hiring, never on a county dropping in or out of disclosure.
      </p></div>
      <div><h3>Wages and headcount</h3><p className="method">
        <b>Wage is employment-weighted</b> across each market&apos;s counties, and
        year-over-year uses a like-for-like county set: a county
        disclosure-suppressed in either quarter is excluded from both sides, so
        composition change can&apos;t contaminate the rate. Markets are{" "}
        <b>tight core counties</b> — where data centers actually are, not the
        metro area; per-county receipts expand on every row so the aggregation
        is checkable. <b>Wage $/wk, Wage YoY and Headcount YoY stay on that
        like-for-like basis; Constr. workers is the market&apos;s full
        current-quarter headcount</b> (<code>emp_cur_total</code>), independent
        of whether a county cleared last year&apos;s disclosure bar — expand a
        row for the reconciling current-quarter total and any counties the
        like-for-like receipts exclude (marked <b>†</b> when partial).
      </p></div>
      <div><h3>Tightness</h3><p className="method"><b>
        Tightness</b> buckets a composite score — the wage spread in
        percentage points plus half the employment spread — at <b>≥10 Hot</b>,{" "}
        <b>≥3 Warm</b>, and <b>above −3 Neutral</b>; <b>−3 or below is Slack</b>.
        The chart draws scores past 40 to the edge and prints the real value.
      </p></div>
      <div><h3>Tracked AI projects and attributes</h3><p className="method">
        <b>Tracked AI projects</b> are the sites the{" "}
        <Link href="/capacity">AI capacity tracker</Link> itemizes, tagged to each market by hand. It is
        not the market&apos;s whole pipeline: most colocation and hyperscaler campuses are not
        itemized, which is why Northern Virginia, the largest market, shows a single site. The
        figure is MW under construction at those sites; operating capacity is shown separately,
        because an energized campus is a completed draw on the labor pool, not a live one.
        {" "}{data.coverage_note}{" "}
        Utility and ISO are hand-curated attributes of the market, not derived.
      </p></div>
      <div><h3>Market pipeline (C&amp;W)</h3><p className="method" id="market-pipeline">
        {pipeSrc ? <>
        <b>Market pipeline</b> is MW under construction for each market as{" "}
        <a href={pipeSrc.url}>{pipeSrc.publisher}&apos;s {pipeSrc.doc}</a> ({pipeSrc.doc_date}) states it,
        for the half ending {pipeSrc.period}. {pipeSrc.basis_note}{" "}
        <b>The region is C&amp;W&apos;s, not ours</b>: Northern Virginia&apos;s figure is all of Virginia,
        Abilene&apos;s is West Texas, Des Moines&apos;s is Iowa, so every row whose C&amp;W market is
        wider than its counties names that region beside the number. One publisher fills the column on
        one basis; other brokers count differently (CBRE&apos;s colocation-only figures, for one, put
        Atlanta above C&amp;W), so none is mixed in. Markets C&amp;W does not break out read
        &ldquo;not broken out&rdquo;, never zero. Operating and planned MW from the same report are in
        the expanded row, never added to the under-construction figure. The figure is marked stale{" "}
        {pipeSrc.stale_after_days} days after the report date, by when a newer edition is due.
        {pipeSrc.stale && <> <b>It is stale now.</b></>}
        </> : <>The market pipeline column is missing from this publish.</>}
      </p></div>
      <div><h3>Electrical contractors</h3><p className="method" id="electrical-contractors">
        <b>Electrical contractors (nonres., NAICS 238212)</b> is private-sector
        QCEW for <b>nonresidential</b> electrical contractors — NAICS 2022 split
        the old 238210 into 238211 (residential) and 238212 (nonresidential),
        and only the nonresidential trade, the one that wires commercial and
        data-center work, is shown. It is aggregated exactly like the
        construction columns: wage weighted by each county&apos;s
        quarterly-average employment, year-over-year on a like-for-like county
        set, workers as the current-quarter third-month level. The smaller
        figure beside the YoY is its spread against the national 238212 wage
        rate
        {elecNat && elecNat.wage_yoy_pct != null
          ? ` (${elecNat.wage_yoy_pct > 0 ? "+" : ""}${elecNat.wage_yoy_pct}% YoY, quarter ${elecNat.as_of ?? "—"})`
          : ""}.
        A six-digit industry is often too small to publish in a single
        county: <b>disclosure-suppressed counties are skipped, never
        zero-filled</b>, a market missing any county for 238212 is marked{" "}
        <b>†</b>, and a market with none reads as suppressed. Expand a row for
        the per-county receipts.
      </p></div>
      </div>
      </section>
    </div>
  );
}
