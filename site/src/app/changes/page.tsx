import Link from "next/link";
import type { Metadata } from "next";
import { KpiCard } from "@/components/KpiCard";
import { Section } from "@/components/Section";
import { DownloadData } from "@/components/DownloadData";
import { CHANGES, SinceYesterdayStrip } from "@/components/SinceYesterday";
import { fmtPp, fmtSigned, fmtStamp } from "@/lib/format";
import { changesHeadline, fmtDelta, fmtReading, partitionMovers } from "@/lib/changesHeadline";
import type { Mover } from "@/lib/types";

const c = CHANGES;
const sign = (v: number | null) => (v == null ? "var(--muted)" : v > 0.005 ? "var(--accent-red)" : v < -0.005 ? "var(--accent-emerald)" : "var(--muted)");

export const metadata: Metadata = {
  title: "Since Yesterday — what moved in this publish",
  description: "Every headline and component reading against the previous publish, which sources landed new rows, and any quality-gate holds.",
};

function MoverRow({ m }: { m: Mover }) {
  const strong = (m.significance ?? 0) >= 1;
  return (
    <tr>
      <td style={{ textAlign: "left" }}><Link href={m.href}>{m.label}</Link> <span className="badge badge-muted">{m.section}</span></td>
      <td>{fmtReading(m, m.value)}<small style={{ display: "block", color: "var(--muted)" }}>{m.as_of ?? "—"}</small></td>
      <td style={{ color: "var(--muted)" }}>{fmtReading(m, m.prev_value)}<small style={{ display: "block" }}>{m.prev_as_of ?? "—"}</small></td>
      <td style={{ fontWeight: strong ? 700 : 400, color: strong ? "var(--text)" : "var(--muted)" }}>{fmtDelta(m)}</td>
      <td style={{ color: "var(--muted)" }}>{m.significance == null ? "—" : `${m.significance.toFixed(1)}×`}
        <small style={{ display: "block" }}>notable {m.delta_unit === "$/MWh" ? `$${m.notable}/MWh` : `${m.notable}${m.delta_unit}`}</small></td>
    </tr>
  );
}

export default function ChangesPage() {
  const gauge = c.headline.find((h) => h.key === "gauge");
  const movers = c.movers ?? [];
  const lead = changesHeadline(movers);
  const { moved, unchanged } = partitionMovers(movers);
  const biggest = c.components[0];
  return (
    <div>
      <h1>
        Since Yesterday <span className="subtitle">what this publish changed, reading by reading</span>
      </h1>
      <p className="lede">
        A daily gauge earns a daily visit only if it says what moved. This page diffs today&apos;s artifacts against
        the previous publish — the files in the repository before this run overwrote them — so every delta is
        between two numbers that were both public.
      </p>
      {lead && <p className="ll-takeaway" data-testid="changes-lead">{lead}</p>}
      <SinceYesterdayStrip />
      <div className="kpi-row">
        <KpiCard label="Macrogauge" value={gauge?.value == null ? "—" : fmtSigned(gauge.value)}
          context={gauge?.delta_pp == null ? "no previous reading" : `${fmtPp(gauge.delta_pp)} vs ${gauge.prev_as_of ?? "—"}`}
          accent={(gauge?.delta_pp ?? 0) > 0 ? "red" : "emerald"} />
        <KpiCard label="Biggest component move" value={biggest?.delta_pp == null ? "—" : fmtPp(biggest.delta_pp)}
          context={biggest ? `${biggest.label} · now ${fmtSigned(biggest.yoy_pct)}` : "—"} accent="violet" />
        <KpiCard label="Sources landed" value={String(c.sources_landed.length)}
          context={c.sources_failed.length ? `${c.sources_failed.length} failed: ${c.sources_failed.join(", ")}` : "no source failures"} accent={c.sources_failed.length ? "amber" : "emerald"} />
        <KpiCard label="Previous publish" value={c.prev_published_at ? c.prev_published_at.slice(0, 10) : "—"}
          context={c.prev_published_at ? fmtStamp(c.prev_published_at) : "first reading"} accent="sky" />
      </div>

      {movers.length > 0 && (
        <Section title="What moved — every page's lead numbers, ranked">
          <div className="table-card">
            <table className="data-table" data-testid="movers-table">
              <thead><tr><th style={{ textAlign: "left" }}>Reading</th><th>Now</th><th>Previous</th><th>Change</th><th>vs notable</th></tr></thead>
              <tbody>
                {moved.map((m) => <MoverRow key={m.key} m={m} />)}
                {moved.length === 0 && <tr><td colSpan={5} style={{ color: "var(--muted)", textAlign: "left" }}>No reading changed since the previous publish.</td></tr>}
              </tbody>
            </table>
          </div>
          {unchanged.length > 0 && (
            <details className="inv-details" data-testid="movers-unchanged">
              <summary>{unchanged.length} unchanged{unchanged.some((m) => m.delta == null) ? " or new" : ""}</summary>
              <div className="table-card">
                <table className="data-table">
                  <tbody>{unchanged.map((m) => <MoverRow key={m.key} m={m} />)}</tbody>
                </table>
              </div>
            </details>
          )}
          <p className="method">
            Each page&apos;s lead numbers, read from today&apos;s files and the previous publish&apos;s. A level&apos;s change is
            in %, a rate or spread in basis points, a YoY in percentage points. Rows rank by the change divided by a
            stated notable move for that reading (for example 3% for a power hub&apos;s 30-day average, 5bp for the
            10-year): a design threshold, not a fitted volatility. A reading whose source date didn&apos;t advance shows
            no change.
          </p>
        </Section>
      )}

      <Section title="Headline readings">
        <div className="section-tools">
          <DownloadData filename="macrogauge-changes-headline" json="changes.json" rows={c.headline} citation={`MacroGauge headline deltas, ${c.published_at} vs ${c.prev_published_at ?? "none"}`} />
        </div>
        <div className="table-card">
          <table className="data-table">
            <thead><tr><th style={{ textAlign: "left" }}>Reading</th><th>Now</th><th>As of</th><th>Previous</th><th>Prev as of</th><th>Δ</th></tr></thead>
            <tbody>
              {c.headline.map((h) => (
                <tr key={h.key}>
                  <td style={{ textAlign: "left" }}>{h.label} <span className="badge badge-muted">{h.kind}</span></td>
                  <td>{fmtSigned(h.value)}</td>
                  <td style={{ color: "var(--muted)" }}>{h.as_of ?? "—"}</td>
                  <td style={{ color: "var(--muted)" }}>{fmtSigned(h.prev_value)}</td>
                  <td style={{ color: "var(--muted)" }}>{h.prev_as_of ?? "—"}</td>
                  <td style={{ color: sign(h.delta_pp), fontWeight: 600 }}>{fmtPp(h.delta_pp)}</td>
                </tr>
              ))}
              {c.headline.length === 0 && <tr><td colSpan={6} style={{ color: "var(--muted)", textAlign: "left" }}>No headline readings on this publish (engine phase did not write).</td></tr>}
            </tbody>
          </table>
        </div>
        {c.official && (
          <p className="method">
            Official CPI: {c.official.month?.slice(0, 7) ?? "—"} print at {fmtSigned(c.official.yoy_pct)} YoY
            {c.official.new_print ? ` — NEW since the previous publish (was ${c.official.prev_month?.slice(0, 7)})` : " — unchanged"}.
          </p>
        )}
      </Section>

      <Section title="Components — sorted by move">
        <div className="section-tools">
          <DownloadData filename="macrogauge-changes-components" json="changes.json" rows={c.components} citation={`MacroGauge component deltas, ${c.published_at}`} />
        </div>
        <div className="table-card">
          <table className="data-table" data-testid="components-table">
            <thead><tr><th style={{ textAlign: "left" }}>Component</th><th>Data</th><th>YoY now</th><th>Previous</th><th>Δ</th><th>BLS YoY</th></tr></thead>
            <tbody>
              {c.components.map((x) => (
                <tr key={x.component}>
                  <td style={{ textAlign: "left" }}>{x.label}</td>
                  <td><span className="badge badge-muted">{x.mode === "live" ? "live" : "BLS carry"}</span></td>
                  <td>{fmtSigned(x.yoy_pct)}</td>
                  <td style={{ color: "var(--muted)" }}>{fmtSigned(x.prev_yoy_pct)}</td>
                  <td style={{ color: sign(x.delta_pp), fontWeight: 600 }}>{fmtPp(x.delta_pp)}</td>
                  <td style={{ color: "var(--muted)" }}>{fmtSigned(x.bls_yoy_pct)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>

      <Section title="Sources and gates">
        <div className="table-card">
          <table className="data-table">
            <thead><tr><th style={{ textAlign: "left" }}>Source</th><th>New rows</th></tr></thead>
            <tbody>
              {c.sources_landed.map((s) => <tr key={s.source}><td style={{ textAlign: "left" }}>{s.source}</td><td>{s.new_rows}</td></tr>)}
              {c.sources_landed.length === 0 && <tr><td colSpan={2} style={{ color: "var(--muted)", textAlign: "left" }}>No source landed new rows on this publish.</td></tr>}
            </tbody>
          </table>
        </div>
        <p className="method">
          Gate holds: {c.gate_holds.length ? JSON.stringify(c.gate_holds) : "none"} — a component whose just-arrived print jumped more than 5% is held one day (see <Link href="/methodology">methodology</Link>).
          {" "}Failed sources: {c.sources_failed.length ? c.sources_failed.join(", ") : "none"}.
        </p>
      </Section>
    </div>
  );
}
