import type { Metadata } from "next";
import Link from "next/link";
import dc from "../../../public/data/datacenter.json";
import llJson from "../../../public/data/longlead.json";
import ratesJson from "../../../public/data/rates.json";
import newsJson from "../../../public/data/news.json";
import { KpiCard } from "@/components/KpiCard";
import { DownloadData } from "@/components/DownloadData";
import { Citation } from "@/components/Citation";
import { DcIndexChart } from "@/components/DcIndexChart";
import { DcConstructionChart } from "@/components/DcConstructionChart";
import { ParityTable, type ParityRow } from "@/components/ParityTable";
import { StateTileMap } from "@/components/StateTileMap";
import { HardwareGapPanel, type GapRow } from "@/components/HardwareGapPanel";
import { PowerKpis, type PowerData } from "@/components/PowerPanel";
import { ContextPanel, type ContextData } from "@/components/ContextPanel";
import { LongLeadStrip } from "@/components/LongLeadStrip";
import { NewsFeed } from "@/components/NewsFeed";
import { clusterStories } from "@/lib/newsTape";
import { fmtDay, fmtSigned } from "@/lib/format";
import { DcDrivers, type DriverComp, type DriverGroup } from "@/components/DcDrivers";
import type { LongLead, Rates } from "@/lib/types";
import { dcHeadline, powerSummary, surgeFromLow } from "@/lib/dcHub";
import { StaleBanner } from "@/components/StaleBanner";
import { artifact } from "@/lib/artifact";
import { dcBuildMonthlyCsvSpec } from "@/lib/exportSpecs";

export const metadata: Metadata = {
  title: `Data Center Cost Index: build ${fmtSigned(dc.indexes.build.headline_yoy_pct)} · ops ${fmtSigned(dc.indexes.ops.headline_yoy_pct)} · hardware ${fmtSigned(dc.indexes.hardware.headline_yoy_pct)} YoY`,
  description: "Facility build & operating input costs, indexed daily — no official DC PPI exists, so we built one.",
};

// Official-prints-only Build variant (P8), absent from files published
// before 2026-09-28 — read through a cast so older artifacts still build.
const buildOfficial = (dc.indexes.build as unknown as {
  official_only?: { last_official: string; headline_yoy_pct: number | null };
}).official_only ?? null;
const buildCodes = dc.indexes.build.components.map((c) => c.code);

const GROUPS = dc.group_labels as Record<string, string>;
const longlead = artifact<"longlead", LongLead>("longlead", llJson);

// The rest of the DC coverage, one card per page — this page is the hub
// (nine cards: a full 3×3 grid).
const DC_COVERAGE = [
  { href: "/escalation", eyebrow: "Basis of estimate", title: "Escalation calculator",
    description: "Escalate your own base estimate, carry it to delivery, and see how often each contingency basis has run short." },
  { href: "/longlead", eyebrow: "Procurement", title: "Long-lead board",
    description: "Switchgear, transformers, generators and HVAC prices beside vendors' stated order books." },
  { href: "/power", eyebrow: "Energy", title: "Power & tariffs",
    description: "Wholesale power at every major hub, capacity prices by grid operator, and utilities' large-load tariffs." },
  { href: "/markets", eyebrow: "Labor", title: "DC markets",
    description: "County-level construction wages and headcount across real data-center markets." },
  { href: "/states", eyebrow: "Site selection", title: "State costs",
    description: "Industrial power and construction wages in every state, mapped: the series behind the parity table." },
  { href: "/commodities", eyebrow: "Materials", title: "Build inputs",
    description: "Copper, aluminum, DRAM, wholesale power and GPU-hours, priced daily beside the wider commodity board." },
  { href: "/capacity", eyebrow: "Supply", title: "AI capacity",
    description: "Operational, under-construction and planned critical-IT MW by company, filing behind each." },
  { href: "/compute", eyebrow: "Output", title: "Compute prices",
    description: "What a token and a GPU-hour cost — the price of what the facility produces." },
  { href: "/as-of", eyebrow: "Claims", title: "Point in time",
    description: "What every index read as published on any past date, DC Build included — for claims and change orders." },
] as const;

const JUMP = [
  ["dc-indexes", "Indexes"], ["dc-drivers", "Drivers"], ["dc-construction", "Construction"],
  ["dc-power", "Power"], ["dc-capital", "Capital"], ["dc-context", "Bigger picture"], ["dc-parity", "State costs"], ["dc-method", "Method"],
] as const;

const headline = dcHeadline([
  { label: "Build", yoy: dc.indexes.build.headline_yoy_pct },
  { label: "Ops", yoy: dc.indexes.ops.headline_yoy_pct },
  { label: "Hardware", yoy: dc.indexes.hardware.headline_yoy_pct },
]);
// The hardware run-up (memory and chips, 2025-26) is the story of the chart:
// shade it from its recent low, in words the data still supports.
const hwSurge = surgeFromLow("Hardware", dc.indexes.hardware.dates, dc.indexes.hardware.index);
// Read through PowerData | null: the schema allows "power": null (a bootstrap
// publish with no hub observations), and a direct JSON import would otherwise
// type it from whichever artifact happens to be committed.
const power = (dc.power ?? null) as PowerData | null;
const powerSum = powerSummary(power);
// The cost of capital a build is financed at — the /rates readings, here as
// a strip (scorecard 2026-10-07). BBB and SOFR are absent before their first
// publish; the strip shows whatever exists.
const rates = artifact<"rates", Rates>("rates", ratesJson);
const ten = rates.curve.find((r) => r.code === "DGS10");
const bbb = rates.credit.bbb_yield;
const sofr = rates.funding?.sofr_30d;
const pp1y = (v: number | null | undefined) =>
  v == null ? "" : ` · ${v > 0 ? "+" : v < 0 ? "−" : ""}${Math.round(Math.abs(v) * 100)}bp on the year`;
const dated = (d: string | null | undefined) => (d ? ` · ${fmtDay(d)}` : "");

// The strip shows the five newest AI-infra STORIES (lib/newsTape). Ship only
// their posts to the client — the client re-clusters them into the same five
// stories — rather than the whole tape; the live overlay replaces them
// wholesale when the R2 object is newer.
const newsAll = artifact("news", newsJson);
const stripIds = new Set(
  clusterStories(newsAll.posts).filter((s) => s.infra).slice(0, 5).flatMap((s) => [s.lead, ...s.also].map((p) => p.id)),
);
const newsStrip = { ...newsAll, posts: newsAll.posts.filter((p) => stripIds.has(p.id)) };

export default function Datacenter() {
  const build = dc.indexes.build;
  const ops = dc.indexes.ops;
  const hardware = dc.indexes.hardware;
  const construction = dc.construction;
  const context = (dc as { context?: ContextData }).context;
  const gateFlags = [
    ...(build.gate_flags as string[]),
    ...(ops.gate_flags as string[]),
    ...(hardware.gate_flags as string[]),
  ];
  const states = dc.parity.states as ParityRow[];
  return (
    <div className="datacenter-dashboard">
      <StaleBanner publishedAt={[dc.published_at, llJson.published_at, ratesJson.published_at]} />
      <header className="research-intro">
        <div className="research-eyebrow">AI infrastructure <span>Updated {fmtDay(build.as_of)}</span></div>
        <h1>Data Center Cost Index</h1>
        <p>Facility build, operating and hardware input costs. Independent indexes with component-level sources and weights.</p>
      </header>
      <nav className="dc-jump" aria-label="On this page">
        {JUMP.map(([id, label]) => <a key={id} href={`#${id}`}>{label}</a>)}
      </nav>
      <div className="kpi-row dc-headline" id="dc-indexes">
        <KpiCard label="DC Build YoY" value={fmtSigned(build.headline_yoy_pct)}
                 context={`construction input costs · ${fmtDay(build.as_of)}`} accent="sky" />
        <KpiCard label="DC Ops YoY" value={fmtSigned(ops.headline_yoy_pct)}
                 context={`operating input costs · ${fmtDay(ops.as_of)}`} accent="violet" />
        <KpiCard label="DC Hardware YoY" value={fmtSigned(hardware.headline_yoy_pct)}
                 context={`IT hardware input costs · ${fmtDay(hardware.as_of)}`} accent="amber" />
      </div>
      {gateFlags.length > 0 && (
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", margin: "8px 0" }}>
          {gateFlags.map((f) => (
            <span key={f} className="badge badge-muted"
                  style={{ color: "var(--accent-amber)", borderColor: "rgba(245,158,11,0.4)" }}>
              quality hold: {f}
            </span>
          ))}
        </div>
      )}
      <section className="section section-featured dc-trend" aria-labelledby="dc-trend-title">
        <DcIndexChart title={headline} surge={hwSurge && { ...hwSurge, seriesKey: "hardware" }} actions={<>
          <Citation compact series="DC Build Index" asOf={build.as_of} rebase={dc.rebase}
            value={`${fmtSigned(build.headline_yoy_pct)} YoY`} path="/datacenter" />
        </>} exportData={
          <>
            <DownloadData compact={false} filename="macrogauge-dc-build-components" json="datacenter.json"
              citation={`MacroGauge DC Build components, as of ${build.as_of}, ${dc.rebase}`}
              rows={build.components as DriverComp[]} csvLabel="Components CSV" />
            <DownloadData compact={false} filename="macrogauge-dc-build-monthly" json="datacenter.json"
              citation={`MacroGauge DC Build index, monthly (live grid; trailing month carries the proxy tail), ${dc.rebase}`}
              spec={dcBuildMonthlyCsvSpec(buildCodes)} csvLabel="Monthly index CSV" hideJson />
            {buildOfficial && (
              <DownloadData compact={false} filename="macrogauge-dc-build-monthly-official" json="datacenter.json"
                citation={`MacroGauge DC Build index, monthly, official prints only (no proxy tail), through ${buildOfficial.last_official}, ${dc.rebase}`}
                spec={dcBuildMonthlyCsvSpec(buildCodes, "official")} csvLabel="Monthly CSV, official prints only" hideJson />
            )}
          </>
        } series={[
          { key: "build", label: "DC Build", dates: build.dates, index: build.index, yoy: build.yoy_pct },
          { key: "ops", label: "DC Ops", dates: ops.dates, index: ops.index, yoy: ops.yoy_pct },
          { key: "hardware", label: "DC Hardware", dates: hardware.dates, index: hardware.index, yoy: hardware.yoy_pct },
        ]} />
        <p className="chart-caption">Source: BLS, EIA and market data · {dc.rebase} · Input-price indexes; build and operating costs remain separate.</p>
      </section>
      <section className="project-toolkit" aria-labelledby="project-toolkit-title">
        <div className="project-toolkit-heading">
          <span id="project-toolkit-title">Data center coverage</span>
          <small>Cost to build · capacity · compute</small>
        </div>
        <div className="project-toolkit-grid">
          {DC_COVERAGE.map((tool) => (
            <Link key={tool.href} href={tool.href} className="project-tool-card">
              <span className="project-tool-eyebrow">{tool.eyebrow}</span>
              <strong>{tool.title}</strong>
              <span>{tool.description}</span>
              <b aria-hidden>Explore →</b>
            </Link>
          ))}
        </div>
      </section>
      <section id="dc-drivers" className="dc-section" aria-labelledby="dc-drivers-title">
        <h2 id="dc-drivers-title">What&apos;s driving each index <span className="subtitle">component weights, moves and contributions</span></h2>
        <DcDrivers groupLabels={GROUPS} indexes={[
          { key: "build", label: "DC Build", headline: build.headline_yoy_pct, asOf: build.as_of,
            comps: build.components as DriverComp[], groups: (build as { groups?: DriverGroup[] }).groups },
          { key: "ops", label: "DC Ops", headline: ops.headline_yoy_pct, asOf: ops.as_of,
            comps: ops.components as DriverComp[], groups: (ops as { groups?: DriverGroup[] }).groups },
          { key: "hardware", label: "DC Hardware", headline: hardware.headline_yoy_pct, asOf: hardware.as_of,
            comps: hardware.components as DriverComp[], groups: (hardware as { groups?: DriverGroup[] }).groups },
        ]} />
      </section>
      <HardwareGapPanel rows={dc.hardware_gap as GapRow[]} />
      {construction && (
        <section id="dc-construction" className="dc-section">
          <h2>The construction boom <span className="subtitle">Census C30 · US data-center construction spend</span></h2>
          <div className="kpi-row">
            <KpiCard label="Construction spend" value={`$${(construction.latest_saar / 1000).toFixed(1)}B/yr`}
                     context={`seasonally adjusted annual rate · as of ${construction.as_of}`} accent="sky" />
            <KpiCard label="Spend YoY" value={fmtSigned(construction.yoy_pct)}
                     context={`NSA, same month a year ago · as of ${construction.yoy_asof}`} accent="red" />
            <KpiCard label="vs 2014 average" value={`×${construction.vs_2014_avg.toFixed(1)}`}
                     context="latest annualized rate vs the 2014 average" accent="violet" />
          </div>
          <DcConstructionChart months={construction.months} saar={construction.saar}
                               real={construction.real} />
        </section>
      )}
      {power && (
        <section id="dc-power" className="dc-section" aria-labelledby="dc-power-title">
          <h2 id="dc-power-title">The power bill{powerSum.headline && <> <span className="subtitle">{powerSum.headline}</span></>}</h2>
          <PowerKpis sum={powerSum} />
          <p className="dc-more"><Link href="/power">All {power.hubs.length} hubs, capacity prices by operator and every tariff →</Link></p>
        </section>
      )}
      {ten?.value != null && (
        <section id="dc-capital" className="dc-section" aria-labelledby="dc-capital-title">
          <h2 id="dc-capital-title">Financing benchmarks <span className="subtitle">market reference rates, not a project&apos;s cost of debt</span></h2>
          <div className="kpi-row">
            <KpiCard label="10-year Treasury" value={`${ten.value.toFixed(2)}%`}
              context={`the long-term rate benchmark${pp1y(ten.chg_1y_pp)}${dated(ten.as_of)}`} accent="sky" />
            {bbb?.value != null && (
              <KpiCard label="BBB corporate bond yield" value={`${bbb.value.toFixed(2)}%`}
                context={`ICE BofA BBB index${pp1y(bbb.chg_1y)}${dated(bbb.as_of)}`} accent="violet" />
            )}
            {sofr?.value != null && (
              <KpiCard label="30-day average SOFR" value={`${sofr.value.toFixed(2)}%`}
                context={`backward-looking base rate, not Term SOFR${pp1y(sofr.chg_1y)}${dated(sofr.as_of)}`} accent="amber" />
            )}
          </div>
          <p className="dc-more">An actual loan prices off a benchmark plus its own spread and fees, on its own terms.{" "}
            <Link href="/rates">The curve, credit spreads and the market-implied Fed path →</Link></p>
        </section>
      )}
      {context && <section id="dc-context" className="dc-section"><ContextPanel context={context} /></section>}
      {longlead && longlead.teaser.length > 0 && (
        <LongLeadStrip longlead={longlead} />
      )}
      <NewsFeed snapshot={newsStrip} compact limit={5} />
      <section id="dc-parity" className="dc-section">
      <h2>State cost parity <span className="subtitle">multipliers vs national average</span></h2>
      <StateTileMap states={states} national={dc.parity.national} />
      <ParityTable states={states} mode={dc.parity.mode} edge={10} />
      </section>
      <section id="dc-method" className="dc-section dc-method" aria-labelledby="dc-method-title">
      <h2 id="dc-method-title">How it&apos;s built</h2>
      <div className="dc-method-grid">
      <div><h3>The three indexes</h3><p className="method">
        Input-price indexes ({dc.rebase}), not turnkey build quotes: each component is an
        official PPI/CES/EIA series weighted by published industry cost breakdowns (facility
        only — no servers/GPUs; IT hardware indexes are hedonically adjusted and would mislead
        in the GPU era). Copper and aluminum components carry a live futures tail spliced onto
        the PPI at the last print and re-anchored every print, so futures never overwrite
        official history. Parity multipliers pin nationally-priced inputs at 1.0:
        build = {dc.parity.w_labor} × state construction wage relative (QCEW NAICS-23) + {(1 - dc.parity.w_labor).toFixed(2)};
        ops = {dc.parity.w_power} × state industrial power relative (EIA) + {(1 - dc.parity.w_power).toFixed(2)}.
        Weight citations in the methodology page pattern; sources refresh monthly (power, PPI, CES) and quarterly (QCEW, ~2-quarter lag).
        </p></div>
      <div><h3>DC Hardware</h3><p className="method">
        The DC Hardware index is built on transaction-sensitive official series; the
        hedonically quality-adjusted series (domestic servers PPI, CPI computers, the headline
        semiconductor PPI) are shown above as contrast, not averaged in — the selection rule is
        transaction-based, not hot: imported semiconductors ride in the basket at whatever they
        print. No official DRAM or memory price index exists (BLS catalogs verified 2026-07-15;
        the microprocessor PPI was discontinued in 2015), so storage &amp; memory carries a
        market-data tail: past the last storage-device PPI it rides DRAMeXchange NAND spot
        prices, but only while NAND is more than 50% away from its level a year earlier —
        in calmer markets the last print carries forward. Hardware is nationally priced — it does not enter
        the state parity table. Weights are cited in the methodology notes; group shares:
        compute 0.65, storage &amp; memory 0.15, network 0.20.
        </p></div>
      <div><h3>Construction spend</h3><p className="method">
        Construction-boom data is Census C30 value-in-place for data centers (monthly,
        ~2-month lag; no FRED mirror exists — we parse Census&apos;s published workbook). The
        level chart is Census&apos;s seasonally adjusted annual rate; YoY is computed on NSA
        actuals same-month-a-year-ago; the real line deflates nominal spend by our DC Build
        index to constant 2018-01 dollars — a series that requires a DC-specific input-cost
        deflator to exist.
        </p></div>
      <div><h3>The power bill</h3><p className="method">
        Wholesale hub prices, capacity auction results and the large-load tariff table are market visibility, not
        index inputs: the DC Ops index stays on official retail power. Their sources, and the backtest that keeps a
        wholesale nowcast out of the index, are on <Link href="/power">Power &amp; Tariffs</Link>.
        </p></div>
      <div><h3>The bigger-picture cards</h3><p className="method">
        The bigger-picture cards are context, not index inputs: colo asking rates (CBRE),
        grid-queue volumes (LBNL), and the external calibration panel — annual escalation from
        Turner &amp; Townsend, Turner Construction and BLS shown against our daily DC Build
        index — are hand-updated from their cited publications and each card carries its as-of
        date. Those three peers do not measure the same thing we do, and the panel says so in
        every column header: we price construction inputs; a bid-price proxy like Turner&apos;s
        folds the competitive condition of the marketplace — bid climate and contractor margin —
        into the owner&apos;s cost; and a PPI prices what a contractor receives.
        The gap between them is the point of showing them. Kalshi odds are
        market-implied probabilities from thin books, shown only when a live quote exists.
        Diesel (genset fuel) and the water, sewer &amp; trash collection services CPI ride the daily pipeline.
      </p></div>
      </div>
      </section>
    </div>
  );
}
