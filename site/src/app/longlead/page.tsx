import type { Metadata } from "next";
import llJson from "../../../public/data/longlead.json";
import { DownloadData } from "@/components/DownloadData";
import { flattenRow } from "@/lib/csv";
import { fmtDay, fmtSigned } from "@/lib/format";
import { BASIS_LABELS, LEAD_BASIS_LABELS, backlogMove, fmtFigure, fmtLead, fmtWeightPct, leadTakeaway, noteSegments } from "@/lib/longLead";
import type { BacklogMonths, LeadTime, LongLead, LongLeadPackage, LongLeadVendor } from "@/lib/types";
import { LinesChart } from "@/components/LinesChart";
import { C } from "@/lib/chartTheme";
import { StaleBanner } from "@/components/StaleBanner";
import { artifact } from "@/lib/artifact";

const data = artifact<"longlead", LongLead>("longlead", llJson);
const backlogGroups = Object.entries(data.backlog_months ?? {});
const allLeads = data.packages.flatMap((p) => p.lead_times ?? []);
const takeaway = leadTakeaway(allLeads);
// an M3 group several packages map to (NAICS 335 serves switchgear AND
// transformers) — say so, or two identical figures read as a coincidence
const groupUsers = new Map<string, string[]>();
for (const p of data.packages) {
  if (p.backlog_group) groupUsers.set(p.backlog_group, [...(groupUsers.get(p.backlog_group) ?? []), p.label]);
}
const sharedWith = (p: LongLeadPackage) =>
  (p.backlog_group ? groupUsers.get(p.backlog_group) ?? [] : []).filter((l) => l !== p.label);

export const metadata: Metadata = {
  title: takeaway ? `Long-Lead Board: ${takeaway.replace(/\.$/, "")}` : "Long-Lead Board: vendor order books vs equipment prices",
  description:
    "Switchgear, transformers, generators and gas turbines, HVAC — the PPI YoY we already publish beside what each vendor's own filings say about its order book.",
};

// A null note is a finding with receipts: its inline SEC citations must be
// clickable, same traceability bar as a figure's source link (spec §10.1).
function NullNote({ note }: { note: string }) {
  return (
    <span className="method">
      {noteSegments(note).map((s, i) =>
        s.kind === "link" ? (
          // the note already names the filing; the link is its receipt, not
          // 120 characters of EDGAR path
          <a key={i} href={s.url} className="ll-note-link">{new URL(s.url).hostname.replace(/^www\./, "")} ↗</a>
        ) : (
          <span key={i}>{s.text}</span>
        ),
      )}
    </span>
  );
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const fmtDate = (d: string) => `${MONTHS[Number(d.slice(5, 7)) - 1]} ${Number(d.slice(8, 10))}, ${d.slice(0, 4)}`;
const fmtQuarter = (d: string) => `Q${Math.ceil(Number(d.slice(5, 7)) / 3)} ${d.slice(0, 4)}`;

// The one figure a vendor leads with on the summary board: the most direct
// pressure signal it states — book-to-bill, then backlog growth, then backlog.
const SIGNAL_ORDER: LongLeadVendor["figures"][number]["kind"][] = ["book_to_bill", "backlog_growth", "backlog", "orders"];
function headline(v: LongLeadVendor) {
  for (const k of SIGNAL_ORDER) {
    const f = v.figures.find((x) => x.kind === k);
    if (f) return f;
  }
  return null;
}
const SIGNAL_LABEL: Record<string, string> = {
  book_to_bill: "book-to-bill", backlog_growth: "backlog", backlog: "backlog", orders: "orders",
};

function VendorCard({ vendor, seenIn }: { vendor: LongLeadVendor; seenIn?: { label: string; code: string } }) {
  return (
    <li className="ll-vendor" id={seenIn ? undefined : `ll-v-${vendor.key}`}>
      <div className="ll-vendor-head">
        <strong>{vendor.name}</strong>
        <span className="ll-tag">{vendor.ticker} · {vendor.listed}</span>
        {vendor.cadence === "annual" && <span className="ll-tag">states figures annually</span>}
        {vendor.stale && <span className="ll-tag ll-tag-stale">stale</span>}
      </div>
      <p className="ll-segment">{vendor.dc_segment}</p>
      {seenIn ? (
        <p className="ll-seen">Same figures as under <a href={`#ll-${seenIn.code}`}>{seenIn.label}</a>.</p>
      ) : vendor.null_note ? (
        <p className="ll-null"><NullNote note={vendor.null_note} /></p>
      ) : (
        <ul className="ll-figs">
          {vendor.figures.map((f) => (
            <li key={`${f.kind}:${f.metric}`}>
              <span className="ll-fig-val">{fmtFigure(f.value, f.unit)}</span>
              <span className="ll-fig-body">
                <span className="ll-fig-metric">{f.metric}</span>
                <span className="ll-fig-meta">
                  <span className="ll-tag">{BASIS_LABELS[f.basis]}</span>
                  {fmtQuarter(f.period)} · stated {fmtDate(f.asof)} · <a href={f.src.url}>{f.src.label}</a>
                </span>
                <details className="ll-quote"><summary>Quote</summary><q>{f.quote}</q></details>
              </span>
            </li>
          ))}
        </ul>
      )}
      {vendor.disclosure_note && <p className="ll-null ll-disclosure"><NullNote note={vendor.disclosure_note} /></p>}
    </li>
  );
}

/** Stated lead times, each with its basis, date and verbatim receipt. */
function LeadTimes({ leads }: { leads: LeadTime[] }) {
  return (
    <ul className="ll-figs ll-leads">
      {leads.map((l) => (
        <li key={l.item}>
          <span className="ll-fig-val">{fmtLead(l)}</span>
          <span className="ll-fig-body">
            <span className="ll-fig-metric">{l.item}</span>
            <span className="ll-fig-meta">
              <span className="ll-tag">{LEAD_BASIS_LABELS[l.basis]}</span>
              {l.stale && <span className="ll-tag ll-tag-stale">stale</span>}
              {fmtQuarter(l.period)} · stated {fmtDate(l.asof)} · <a href={l.src.url}>{l.src.label}</a>
            </span>
            <details className="ll-quote"><summary>Quote</summary><q>{l.quote}</q></details>
          </span>
        </li>
      ))}
    </ul>
  );
}

function PackageSection({ pkg, backlog, seen }: {
  pkg: LongLeadPackage; backlog?: BacklogMonths; seen: Map<string, { label: string; code: string }>;
}) {
  return (
    <section className="ll-package" id={`ll-${pkg.code}`}>
      <div className="ll-package-head">
        <h2>{pkg.label}</h2>
        <dl className="ll-package-stats">
          <div><dt>Share of DC Build</dt><dd>{fmtWeightPct(pkg.weight)}</dd></div>
          <div><dt>Price, year over year</dt><dd className={pkg.price_yoy_pct == null ? "" : pkg.price_yoy_pct > 0 ? "up" : "down"}>
            {pkg.price_yoy_pct === null ? "—" : fmtSigned(pkg.price_yoy_pct)}</dd>
            <small>{pkg.price_last_obs ? `PPI, ${fmtDate(pkg.price_last_obs)}` : "unavailable"}</small></div>
          {pkg.lead_times?.[0] && (
            <div><dt>Lead time</dt><dd>{fmtLead(pkg.lead_times[0])}</dd>
              <small>{pkg.lead_times[0].item.replace(/, US average$/, "")}, {fmtQuarter(pkg.lead_times[0].period)}</small></div>
          )}
          {backlog && (
            <div><dt>Industry backlog</dt><dd>{backlog.latest.toFixed(1)} mo</dd>
              <small>Census M3, {backlog.latest_month}{backlog.change_1y == null ? "" : ` · ${backlog.change_1y >= 0 ? "+" : "−"}${Math.abs(backlog.change_1y).toFixed(1)} over 1y`}
                {sharedWith(pkg).length > 0 && ` · one industry group, shared with ${sharedWith(pkg).join(", ").toLowerCase()}`}</small></div>
          )}
        </dl>
      </div>
      {(pkg.lead_times?.length ?? 0) > 0 && <LeadTimes leads={pkg.lead_times!} />}
      {pkg.vendors.length === 0 ? (
        <p className="ll-null ll-null-pkg">{pkg.null_note && <NullNote note={pkg.null_note} />}</p>
      ) : (
        <ul className="ll-vendors">
          {pkg.vendors.map((v) => <VendorCard key={v.key} vendor={v} seenIn={seen.get(`${pkg.code}:${v.key}`)} />)}
        </ul>
      )}
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
  // A vendor that serves two packages (GE Vernova: switchgear and
  // transformers) prints its figures once; later packages point back.
  const firstSeen = new Map<string, { label: string; code: string }>();
  const seen = new Map<string, { label: string; code: string }>();
  for (const p of data.packages) {
    for (const v of p.vendors) {
      const prior = firstSeen.get(v.key);
      if (prior) seen.set(`${p.code}:${v.key}`, prior);
      else firstSeen.set(v.key, { label: p.label, code: p.code });
    }
  }
  // PageShell already renders the page's <main> landmark (layout.tsx) — a
  // second one here is invalid HTML; the other DC pages use a plain div.
  return (
    <div>
      <StaleBanner publishedAt={llJson.published_at} />
      {/* the shared research-intro header (eyebrow, H1, one dek) brings the board
          into the first screen; the lede joins "How to read the board" */}
      <header className="research-intro">
        <div className="research-eyebrow">AI infrastructure · Long-lead board <span>Updated {fmtDay(data.published_at)}</span></div>
        <h1>Long-Lead Board</h1>
        {takeaway && <p data-testid="ll-takeaway">{takeaway}</p>}
      </header>
      <div className="page-asof">
        <DownloadData filename="macrogauge-longlead" json="longlead.json"
          citation={`MacroGauge long-lead board, curated ${data.as_of_curated}`}
          rows={data.packages.flatMap((p) => p.vendors.flatMap((v) =>
            v.figures.length
              ? v.figures.map((f) => ({ package: p.label, vendor: v.name, ticker: v.ticker, stale: v.stale, ...flattenRow(f) }))
              : [{ package: p.label, vendor: v.name, ticker: v.ticker, stale: v.stale, null_note: v.null_note }]))} />
        <span>
          Vendor figures curated {fmtDate(data.as_of_curated)} · survey averages are not a quote for your project ·{" "}
          <a href="#ll-method">How to read the board</a>
        </span>
      </div>
      <section className="ll-board" aria-labelledby="ll-board-title">
        <h2 id="ll-board-title">The board <span className="subtitle">price pressure beside order-book pressure, package by package</span></h2>
        <div className="table-card ll-board-table">
          <table className="data-table">
            <thead>
              <tr>
                <th scope="col">Package</th>
                <th scope="col" className="num">Lead time</th>
                <th scope="col" className="num">Price YoY</th>
                <th scope="col" className="num">Industry backlog</th>
                <th scope="col">What the vendors say</th>
              </tr>
            </thead>
            <tbody>
              {data.packages.map((p) => {
                const bm = p.backlog_group ? data.backlog_months?.[p.backlog_group] : undefined;
                return (
                  <tr key={p.code}>
                    <td><a href={`#ll-${p.code}`} className="ll-board-pkg">{p.label}</a><small>{fmtWeightPct(p.weight)} of DC Build</small></td>
                    <td className="num ll-board-lead" data-label="Lead time">
                      {(p.lead_times?.length ?? 0) === 0 ? <span className="ll-muted">no published figure</span> : p.lead_times!.map((l) => (
                        <span key={l.item} className="ll-lead">{fmtLead(l)}<small>{l.item.replace(/, US average$/, "")} · {fmtQuarter(l.period)}{l.stale ? ", stale" : ""}</small></span>
                      ))}
                    </td>
                    <td data-label="Price YoY" className={`num ll-board-yoy${p.price_yoy_pct == null ? "" : p.price_yoy_pct > 0 ? " up" : " down"}`}>
                      {p.price_yoy_pct === null ? "—" : fmtSigned(p.price_yoy_pct)}</td>
                    <td className="num" data-label="Industry backlog">{bm ? <>{bm.latest.toFixed(1)} mo<small>{bm.change_1y == null ? "" : `${bm.change_1y >= 0 ? "+" : "−"}${Math.abs(bm.change_1y).toFixed(1)} over 1y`}</small></> : "—"}</td>
                    <td data-label="What the vendors say">
                      {p.vendors.length === 0 ? <span className="ll-muted">No vendor states a usable figure</span> : (
                        <ul className="ll-signals">
                          {p.vendors.map((v) => {
                            const f = headline(v);
                            return (
                              <li key={v.key} className={v.stale ? "is-stale" : undefined}>
                                <strong>{v.name}</strong>{" "}
                                {f ? <>{fmtFigure(f.value, f.unit)} {SIGNAL_LABEL[f.kind]}<small> · {fmtQuarter(f.period)}{v.stale ? ", stale" : ""}</small></> : <span className="ll-muted">no stated figure</span>}
                              </li>
                            );
                          })}
                        </ul>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <p className="ll-board-note">{data.packages.length} packages cover {fmtWeightPct(data.build_weight_covered)} of the DC Build index. Lead time is a stated survey average or a vendor&apos;s order horizon, dated to the period it measures;
          {data.lead_time_benchmark && (data.lead_time_benchmark.stale
            ? <> across all data-center equipment the US average <i>was</i> <b>{fmtLead(data.lead_time_benchmark)}</b> as last reported <span className="ll-tag ll-tag-stale">stale</span> (<a href={data.lead_time_benchmark.src.url}>{data.lead_time_benchmark.src.label}</a>);</>
            : <> across all data-center equipment the US average is <b>{fmtLead(data.lead_time_benchmark)}</b> (<a href={data.lead_time_benchmark.src.url}>{data.lead_time_benchmark.src.label}</a>);</>)}
          {" "}price is the component&apos;s PPI at its own last reading; industry backlog is Census M3 months of unfilled orders, and switchgear and transformers share one industry group; vendor figures are what each company states, never summed across bases.</p>
      </section>
      {backlogGroups.length > 0 && (
        <section>
          <h2>Months of backlog <span className="subtitle">Census M3: unfilled orders ÷ monthly shipments, both seasonally adjusted</span></h2>
          <ul className="ll-backlog-moves">
            {backlogGroups.map(([key, b]) => <li key={key}><strong>{b.label}</strong> {backlogMove(b)}</li>)}
          </ul>
          <LinesChart ariaTitle="Months of backlog, Census M3" yUnit=" mo" recessions={false} height={280}
            bands={[{ from: "2020-02-01", to: "2020-12-01", label: "2020: shipments fell, unfilled orders didn't" }]}
            series={backlogGroups.map(([key, b]) => ({ name: b.label, x: b.months.map((m) => `${m}-01`), y: b.ratio,
              color: key === "turbines" ? C.violet : C.sky }))} />
          <p className="method">
            How many months current shipments would take to clear the order book — an industry-wide, primary-source
            lead-time proxy that complements the vendors&apos; own figures below. The ratio moves with either leg, so read
            it with them: the 2020 turbine spike came from shipments falling about a quarter while unfilled orders held
            flat. Unfilled orders are a stock — last month&apos;s balance plus new orders, less shipments and
            cancellations — so neither leg is new orders, and the ratio alone cannot say whether demand rose or
            cooled. Shipments are in dollars, so their growth mixes price with volume.{" "}
            Electrical equipment maps to switchgear and transformers; turbines, generators &amp; power transmission maps to generator sets. Data: FRED
            A35CUO/A35CVS and ATGPUO/ATGPVS (Census M3, monthly, about one month behind).
          </p>
        </section>
      )}
      {data.packages.map((pkg) => (
        <PackageSection key={pkg.code} pkg={pkg} seen={seen}
          backlog={pkg.backlog_group ? data.backlog_months?.[pkg.backlog_group] : undefined} />
      ))}
      <section id="ll-method" className="ll-method" aria-labelledby="ll-method-title">
      <h2 id="ll-method-title">How to read the board</h2>
      <div className="dc-method-grid">
      <div><h3>What the board joins</h3>
      <p className="method">
        The binding constraint in DC delivery is availability, not just price.
        This board joins the equipment PPI YoY we already publish with stated
        lead times — industry-survey averages in weeks and vendors&apos; own
        order horizons — and what each vendor&apos;s filings say about its
        order book. Survey averages are not a quote for your project. Every
        figure links to the document that states it.
      </p></div>
      <div><h3>Reading the bases</h3>
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
      </p></div>
      <div><h3>Stated-only figures</h3>
      <p className="method">
        Figures are stated-only: each one is published exactly as the vendor
        stated it, with its verbatim sentence and a link to the primary
        source. Nothing is derived — no computed book-to-bill, no
        cross-vendor aggregate. Vendors that disclose nothing at
        primary-source standard are shown as explicit nulls with the reason;
        that a supplier publishes no order-book figure is itself worth
        knowing. Quarterly figures flag stale after 120 days, annual after
        430. Curated {data.as_of_curated}.
      </p></div>
      </div>
      </section>
    </div>
  );
}
