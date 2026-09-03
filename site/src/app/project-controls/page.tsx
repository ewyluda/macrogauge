import type { Metadata } from "next";
import Link from "next/link";
import dc from "../../../public/data/datacenter.json";
import gradesJson from "../../../public/data/dc_grades.json";
import ledgerJson from "../../../public/data/ledger.json";
import longleadJson from "../../../public/data/longlead.json";
import marketsJson from "../../../public/data/dc_markets.json";
import { KpiCard } from "@/components/KpiCard";
import { Section } from "@/components/Section";
import { Citation } from "@/components/Citation";
import { fmtSigned } from "@/lib/format";
import type { DcGrades, Ledger } from "@/lib/types";

const build = dc.indexes.build;
const grades = gradesJson as unknown as DcGrades;
const ledger = ledgerJson as Ledger;
const longlead = longleadJson as { packages: { vendors: unknown[] }[] };
const markets = (marketsJson as { markets: { available: boolean }[] }).markets;
const strict = grades.legs?.strict;
const h12 = strict?.grades?.long_run?.h12;

export const metadata: Metadata = {
  title: `For Project Controls — DC Build ${fmtSigned(build.headline_yoy_pct)} YoY, escalation you can defend`,
  description:
    "No official data-center PPI exists, so we built one: a daily, decomposed, weight-published DC Build index with an append-only audit trail — for escalation, basis of estimate, contingency and long-lead decisions.",
};

const TOOLS = [
  { href: "/escalation", eyebrow: "Basis of estimate", title: "Escalation calculator", text: "Escalate your own base estimate between any two months of the index, with the $/MW bridge that shows which packages moved it." },
  { href: "/portfolio", eyebrow: "Program", title: "Portfolio view", text: "Your projects — base, delivery, carry basis — aggregated into escalation to date, at delivery, and the realized band. Stays in your browser." },
  { href: "/dc-scoreboard", eyebrow: "Contingency", title: "Escalation grades", text: "Every contingency basis graded on every vintage since 2018, strict and extended. The basis with the best error has been the worst contingency." },
  { href: "/markets", eyebrow: "Market conditions", title: "DC market panel", text: `Construction wages and headcount at county resolution for ${markets.filter((m) => m.available).length} real data-center markets, against the national rate.` },
  { href: "/longlead", eyebrow: "Long-lead", title: "Long-lead board", text: `Switchgear, transformers, generators, HVAC, pumps — PPI beside ${longlead.packages.reduce((s, p) => s + p.vendors.length, 0)} vendors' stated order books.` },
  { href: "/datacenter", eyebrow: "Index", title: "DC Cost Index", text: "Build, Ops and Hardware indexes with published weights, component modes and state parity multipliers." },
  { href: "/compute", eyebrow: "Output side", title: "Compute prices", text: "What a token and a GPU-hour cost — the price of what the facility produces, beside the price of building it." },
  { href: "/capacity", eyebrow: "Supply", title: "AI capacity", text: "Operational, under-construction and planned critical-IT MW by company, with the filing behind each figure." },
];

export default function ProjectControlsPage() {
  return (
    <div>
      <h1>
        For Project Controls <span className="subtitle">escalation you can put in a document</span>
      </h1>
      <p className="lede">
        No official data-center PPI exists. Escalation data for DC construction is annual, retrospective and delivered as
        a PDF. So we built the index the estimating, scheduling, change-management and risk functions need: a{" "}
        <b>daily, decomposed, weight-published DC Build index</b> with an append-only audit trail — and the last mile
        into your workflow: a basis-of-estimate bridge, a contingency table graded on every vintage, a program view, a
        market panel at county resolution, and a long-lead board built from primary filings.
      </p>
      <div className="kpi-row">
        <KpiCard label="DC Build · YoY" value={fmtSigned(build.headline_yoy_pct)} context={`construction input costs · as of ${build.as_of} · ${dc.rebase}`} accent="sky" />
        <KpiCard label="Long-run basis · shortfall" value={h12 ? `${h12.shortfall_rate_pct.toFixed(0)}%` : "—"}
          context={h12 ? `of 12-month vintage-true windows under-provisioned · mean ${h12.mean_shortfall_pp.toFixed(1)}pp · ${strict?.anchors_n} anchors` : "grading unavailable"} accent="red" />
        <KpiCard label="Publishes on record" value={String(ledger.rows.length)} context={`since ${ledger.first_publish?.slice(0, 10) ?? "—"} · append-only, never restated`} accent="emerald" />
        <KpiCard label="Build components" value={String(build.components.length)} context={`published weights · ${build.components.filter((c) => c.mode !== "official").length} carry a live proxy tail`} accent="violet" />
      </div>
      <Citation series="DC Build Index" asOf={build.as_of} rebase={dc.rebase} value={`${fmtSigned(build.headline_yoy_pct)} YoY`} path="/project-controls" />

      <Section title="The toolkit — from estimate through procurement" featured>
        <div className="quote-board" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))" }}>
          {TOOLS.map((t) => (
            <Link key={t.href} href={t.href} className="quote-tile" style={{ textDecoration: "none", color: "inherit", gap: 6 }}>
              <div className="quote-group">{t.eyebrow}</div>
              <div style={{ fontSize: 16, fontWeight: 700 }}>{t.title}</div>
              <div style={{ fontSize: 12, color: "var(--muted)", lineHeight: 1.5 }}>{t.text}</div>
              <div style={{ fontSize: 12, color: "var(--accent-sky)", marginTop: 4 }}>Open →</div>
            </Link>
          ))}
        </div>
      </Section>

      <Section title="Defensibility — the three receipts">
        <div className="quote-board" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(300px, 1fr))" }}>
          <div className="quote-tile" style={{ gap: 6 }}>
            <div className="quote-group">1 · A citable number</div>
            <div style={{ fontSize: 14, fontWeight: 600 }}>Every headline carries a reference string</div>
            <div style={{ fontSize: 12, color: "var(--muted)", lineHeight: 1.5 }}>
              Series, as-of date, rebase, value and a link that reproduces the view — the Copy button under each KPI. CSV and JSON
              downloads sit beside every table; <Link href="/data">/data</Link> lists every artifact with its JSON Schema.
            </div>
          </div>
          <div className="quote-tile" style={{ gap: 6 }}>
            <div className="quote-group">2 · A graded contingency</div>
            <div style={{ fontSize: 14, fontWeight: 600 }}>Expected vs realized on every vintage</div>
            <div style={{ fontSize: 12, color: "var(--muted)", lineHeight: 1.5 }}>
              The <Link href="/dc-scoreboard">scatter</Link> puts each anchor month&apos;s carried basis against what the index actually did
              over 12–48 months. The published shortfall rates are recomputed from the same dots. Bases that look best on error have
              under-provisioned most often — the table says so.
            </div>
          </div>
          <div className="quote-tile" style={{ gap: 6 }}>
            <div className="quote-group">3 · A history that cannot be restated</div>
            <div style={{ fontSize: 14, fontWeight: 600 }}>What the index read on any past day</div>
            <div style={{ fontSize: 12, color: "var(--muted)", lineHeight: 1.5 }}>
              <Link href="/as-of">Point in Time</Link> reads an append-only ledger of every publish — the row, the timestamp, the git
              commit. The vintage store beneath it keeps every release of every input. A counterparty cannot argue the history moved.
            </div>
          </div>
        </div>
      </Section>

      <Section title="Vocabulary — what the numbers here are, and are not">
        <div className="table-card">
          <table className="data-table">
            <tbody>
              {[
                ["Escalation", "The ratio of the DC Build index between two months, applied to your base estimate. National. Not a quote."],
                ["Basis of estimate", "Your base cost and base month. The calculator's bridge shows which of the twelve packages moved the ratio, in your dollars."],
                ["Contingency basis", "A realized annualized rate of the index over a stated window — long-run, trailing 3-year, current momentum — carried forward from the last complete month. Graded, not forecast."],
                ["Realized band", "The p10–p90 of every like-length window in the sample. A range of what has happened; not a probability distribution."],
                ["Long-lead", "Equipment packages whose vendor order books we track from primary filings, beside the PPI leg we publish for each. Backlog basis is badged; bases are never summed."],
                ["$/MW", "Yours to supply: the index is a ratio, so any unit you give it comes back in that unit. The market panel's MW columns are denominated and status-split."],
                ["Energization", "Not modelled. The capacity tracker records stated dates per site with the filing behind each; the long-lead board is the earliest signal we have."],
              ].map(([term, def]) => (
                <tr key={term}><td style={{ textAlign: "left", fontWeight: 600, whiteSpace: "nowrap" }}>{term}</td><td style={{ textAlign: "left", color: "var(--muted)" }}>{def}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="method">
          Methodology, weights and every negative result we have published — including the lead-lag study that found no forward
          model is warranted — are on <Link href="/datacenter">/datacenter</Link> and <Link href="/dc-scoreboard">/dc-scoreboard</Link>.
          The index is not a contract-referenced series today; its weights can change with notice on the methodology page.
        </p>
      </Section>
    </div>
  );
}
