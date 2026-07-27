import type { Metadata } from "next";
import llJson from "../../../public/data/longlead.json";
import { KpiCard } from "@/components/KpiCard";
import { fmtSigned } from "@/lib/format";
import { BASIS_LABELS, fmtFigure } from "@/lib/longLead";
import type { LongLead, LongLeadPackage, LongLeadVendor } from "@/lib/types";

const data = llJson as unknown as LongLead;

export const metadata: Metadata = {
  title: "Long-Lead Board: vendor order books vs equipment prices",
  description:
    "Switchgear, transformers, generators, HVAC, pumps — the PPI YoY we already publish beside what each vendor's own filings say about its order book.",
};

function VendorRow({ vendor }: { vendor: LongLeadVendor }) {
  return (
    <tr>
      <td>
        <strong>{vendor.name}</strong>{" "}
        <span className="badge badge-muted">{vendor.ticker}</span>
        {vendor.cadence === "annual" && (
          <span className="badge badge-muted">annual</span>
        )}
        {vendor.stale && <span className="badge">stale</span>}
        <div className="subtitle">{vendor.dc_segment}</div>
      </td>
      <td style={{ textAlign: "left" }}>
        {vendor.null_note ? (
          <span className="method">{vendor.null_note}</span>
        ) : (
          vendor.figures.map((f) => (
            <div key={`${f.kind}:${f.metric}`} style={{ marginBottom: 6 }}>
              <strong>{fmtFigure(f.value, f.unit)}</strong>{" "}
              {f.metric}{" "}
              <span className="badge badge-muted">{BASIS_LABELS[f.basis]}</span>{" "}
              <span className="badge badge-muted">{f.scope}</span>{" "}
              <span className="subtitle">
                {f.period} · <a href={f.src.url}>{f.src.label}</a>
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
          weight {pkg.weight} ·{" "}
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
                  <span className="method">{pkg.null_note}</span>
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

export default function Page() {
  const priced = data.packages.filter((p) => p.price_yoy_pct !== null);
  // Same source document as Caterpillar's stated MD&A backlog figure below —
  // the RPO figure quoted in prose links to it directly (acceptance §10.1:
  // every number on this page traces to a company document via a link).
  const catRpo = data.packages
    .flatMap((p) => p.vendors)
    .find((v) => v.ticker === "CAT")?.figures[0];
  return (
    <main>
      <h1>Long-Lead Board</h1>
      <p className="lede">
        The binding constraint in DC delivery is availability, not just price.
        This board joins the equipment PPI YoY we already publish with what
        each vendor&apos;s own filings and earnings documents say about its
        order book — a directional proxy for lead-time pressure, not a
        lead-time quote in weeks. Every figure links to the company document
        that states it.
      </p>
      <div className="kpi-row">
        <KpiCard
          label="Packages tracked"
          value={`${data.packages.length}`}
          context={`${data.build_weight_covered} of DC Build weight`}
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
        {catRpo ? (
          <a href={catRpo.src.url}>$37.1B RPO</a>
        ) : (
          "$37.1B RPO"
        )}{" "}
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
    </main>
  );
}
