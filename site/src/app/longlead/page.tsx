import type { Metadata } from "next";
import llJson from "../../../public/data/longlead.json";
import { KpiCard } from "@/components/KpiCard";
import { DownloadData } from "@/components/DownloadData";
import { flattenRow } from "@/lib/csv";
import { fmtSigned } from "@/lib/format";
import { BASIS_LABELS, fmtFigure, fmtWeightPct, noteSegments } from "@/lib/longLead";
import type { LongLead, LongLeadPackage, LongLeadVendor } from "@/lib/types";

const data = llJson as unknown as LongLead;

export const metadata: Metadata = {
  title: "Long-Lead Board: vendor order books vs equipment prices",
  description:
    "Switchgear, transformers, generators, HVAC, pumps — the PPI YoY we already publish beside what each vendor's own filings say about its order book.",
};

// A null note is a finding with receipts: its inline SEC citations must be
// clickable, same traceability bar as a figure's source link (spec §10.1).
function NullNote({ note }: { note: string }) {
  return (
    <span className="method">
      {noteSegments(note).map((s, i) =>
        s.kind === "link" ? (
          <a key={i} href={s.url}>
            {s.url}
          </a>
        ) : (
          <span key={i}>{s.text}</span>
        ),
      )}
    </span>
  );
}

function VendorRow({ vendor }: { vendor: LongLeadVendor }) {
  return (
    <tr>
      <td>
        <strong>{vendor.name}</strong>{" "}
        <span className="badge badge-muted" title={`listed ${vendor.listed}`}>{vendor.ticker} · {vendor.listed}</span>
        {vendor.cadence === "annual" && (
          <span className="badge badge-muted">annual</span>
        )}
        {vendor.stale && <span className="badge">stale</span>}
        <div className="subtitle">{vendor.dc_segment}</div>
      </td>
      <td style={{ textAlign: "left" }}>
        {vendor.null_note ? (
          <NullNote note={vendor.null_note} />
        ) : (
          vendor.figures.map((f) => (
            <div key={`${f.kind}:${f.metric}`} style={{ marginBottom: 6 }}>
              <strong>{fmtFigure(f.value, f.unit)}</strong>{" "}
              {f.metric}{" "}
              <span className="badge badge-muted">{BASIS_LABELS[f.basis]}</span>{" "}
              <span className="badge badge-muted">{f.scope}</span>{" "}
              <span className="subtitle">
                {f.period} · stated {f.asof} ·{" "}
                <a href={f.src.url}>{f.src.label}</a>
              </span>
              <div className="method">“{f.quote}”</div>
            </div>
          ))
        )}
      </td>
    </tr>
  );
}

function PackageSection({ pkg }: { pkg: LongLeadPackage }) {
  return (
    <section>
      <h2>
        {pkg.label}{" "}
        <span className="subtitle">
          {fmtWeightPct(pkg.weight)} of Build weight ·{" "}
          {pkg.price_yoy_pct === null
            ? "price YoY unavailable"
            : `PPI ${fmtSigned(pkg.price_yoy_pct)} YoY as of ${pkg.price_last_obs}`}
        </span>
      </h2>
      <div className="table-card">
        <table className="data-table">
          <thead>
            <tr>
              <th>Vendor</th>
              <th style={{ textAlign: "left" }}>Stated order-book figures</th>
            </tr>
          </thead>
          <tbody>
            {pkg.vendors.length === 0 ? (
              <tr>
                <td colSpan={2} style={{ textAlign: "left" }}>
                  {pkg.null_note && <NullNote note={pkg.null_note} />}
                </td>
              </tr>
            ) : (
              pkg.vendors.map((v) => <VendorRow key={v.key} vendor={v} />)
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}

// Caterpillar's Q1 2026 10-Q — the pinned source for the fixed historical
// claim in the basis-disambiguation prose below (both the $62.7B MD&A
// backlog and the $37.1B RPO live in this one filing). Deliberately NOT
// derived from the CAT vendor row: that row is re-curated every earnings
// season, while this sentence permanently describes Q1 2026 (§10.1: every
// number traces to a company document via a link).
const CAT_Q1_2026_10Q =
  "https://www.sec.gov/Archives/edgar/data/18230/000001823026000021/cat-20260331.htm";

export default function Page() {
  const priced = data.packages.filter((p) => p.price_yoy_pct !== null);
  // PageShell already renders the page's <main> landmark (layout.tsx) — a
  // second one here is invalid HTML; the other DC pages use a plain div.
  return (
    <div>
      <h1>Long-Lead Board</h1>
      <p className="lede">
        The binding constraint in DC delivery is availability, not just price.
        This board joins the equipment PPI YoY we already publish with what
        each vendor&apos;s own filings and earnings documents say about its
        order book — a directional proxy for lead-time pressure, not a
        lead-time quote in weeks. Every figure links to the company document
        that states it.
      </p>
      <div className="section-tools">
        <DownloadData filename="macrogauge-longlead" json="longlead.json"
          citation={`MacroGauge long-lead board, curated ${data.as_of_curated}`}
          rows={data.packages.flatMap((p) => p.vendors.flatMap((v) =>
            v.figures.length
              ? v.figures.map((f) => ({ package: p.label, vendor: v.name, ticker: v.ticker, stale: v.stale, ...flattenRow(f) }))
              : [{ package: p.label, vendor: v.name, ticker: v.ticker, stale: v.stale, null_note: v.null_note }]))} />
      </div>
      <div className="kpi-row">
        <KpiCard
          label="Packages tracked"
          value={`${data.packages.length}`}
          context={`${fmtWeightPct(data.build_weight_covered)} of DC Build weight`}
        />
        <KpiCard
          label="Price legs live"
          value={`${priced.length}/${data.packages.length}`}
          context="PPI YoY at each component's own last observation"
          accent="emerald"
        />
        <KpiCard
          label="Curated"
          value={data.as_of_curated}
          context="refreshed each earnings season"
          accent="amber"
        />
      </div>
      {data.packages.map((pkg) => (
        <PackageSection key={pkg.code} pkg={pkg} />
      ))}
      <h2>Reading the bases</h2>
      <p className="method">
        “Backlog” is not one number. <strong>RPO</strong> is ASC-606 remaining
        performance obligations from the financial statements.{" "}
        <strong>Order backlog</strong> is the company&apos;s own orders-based
        order book. <strong>MD&amp;A backlog</strong> is a
        believed-to-be-firm management figure. Caterpillar&apos;s Q1 2026
        filings carry a $62.7B MD&amp;A backlog and a{" "}
        <a href={CAT_Q1_2026_10Q}>$37.1B RPO</a>{" "}
        simultaneously — same company, same quarter, different accounting
        objects. That is why every figure here carries a basis badge, and why
        figures with different bases are never summed and never share an
        axis.
      </p>
      <p className="method">
        Figures are stated-only: each one is published exactly as the vendor
        stated it, with its verbatim sentence and a link to the primary
        source. Nothing is derived — no computed book-to-bill, no
        cross-vendor aggregate. Vendors that disclose nothing at
        primary-source standard are shown as explicit nulls with the reason;
        that a supplier publishes no order-book figure is itself worth
        knowing. Quarterly figures flag stale after 120 days, annual after
        430. Curated {data.as_of_curated}.
      </p>
    </div>
  );
}
