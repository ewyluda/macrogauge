import type { Metadata } from "next";
import qa from "../../../public/data/qa.json";
import sourcesStatus from "../../../public/data/sources_status.json";
import methodology from "../../../public/data/methodology.json";
import { KpiCard, type Accent } from "@/components/KpiCard";
import { Section } from "@/components/Section";
import { StatusPill } from "@/components/StatusPill";
import { fmtDay, fmtStamp } from "@/lib/format";
import {
  CHECK_SECTION, CHECK_SECTIONS, CURATED_INPUTS, daysBetween, groupBy, SOURCE_SECTION, SOURCE_SECTIONS,
  sourceFreshness, type Freshness,
} from "@/lib/statusSections";
import Link from "next/link";

export const metadata: Metadata = {
  title: "System Status",
  description:
    "Live data-integrity self-test and per-source freshness — the same checks the daily publish runs, in public.",
};

type QaCheck = { name: string; critical: boolean; pass: boolean; detail: string };
type Source = {
  name: string;
  route: string;
  cadence: string;
  ok: boolean;
  fetched: number;
  new_rows: number;
  error: string | null;
  finished_at: string;
  series_count: number;
  latest_obs: string | null;
};

/** A source's series as one bar: fresh, stale, expected-absent. */
function FreshBar({ f }: { f: Freshness | undefined }) {
  if (!f) return <span style={{ color: "var(--muted)" }}>—</span>;
  const n = f.fresh + f.stale + f.absent;
  const pct = (k: number) => `${(100 * k) / n}%`;
  const label = `${f.fresh} of ${n} series fresh${f.stale ? `, ${f.stale} stale` : ""}${f.absent ? `, ${f.absent} expected absent` : ""}`;
  return (
    <span className="status-fresh" title={label}>
      <span className="status-fresh-bar" aria-hidden="true">
        <span className="is-fresh" style={{ width: pct(f.fresh) }} />
        <span className="is-stale" style={{ width: pct(f.stale) }} />
        <span className="is-absent" style={{ width: pct(f.absent) }} />
      </span>
      <span className="status-fresh-text">{f.fresh}/{n}{f.stale ? ` · ${f.stale} stale` : ""}</span>
      <span className="sr-only">{label}</span>
    </span>
  );
}

/** A section's header row inside a grouped table. */
function GroupRow({ cols, title, summary }: { cols: number; title: string; summary: string }) {
  return (
    <tr className="status-group">
      <th colSpan={cols} scope="colgroup">{title} <span>{summary}</span></th>
    </tr>
  );
}

export default function Status() {
  const checks = qa.checks as QaCheck[];
  const sources = sourcesStatus.sources as Source[];
  const allPass = qa.passed === qa.total;
  const criticalFailing = checks.filter((c) => c.critical && !c.pass).length;
  const sourcesOk = sources.filter((s) => s.ok).length;
  const checkGroups = groupBy(checks, (c) => CHECK_SECTION[c.name] ?? "Pipeline", CHECK_SECTIONS);
  const sourceGroups = groupBy(sources, (s) => SOURCE_SECTION[s.name] ?? "Shared", SOURCE_SECTIONS);
  const freshness = sourceFreshness(methodology.inventory);
  // one three-way state drives both the KPI text and its accent, so the two
  // can never disagree
  const [selfTestContext, selfTestAccent]: [string, Accent] = allPass
    ? ["all checks passing", "emerald"]
    : criticalFailing > 0
      ? [
          `${criticalFailing} critical check${criticalFailing === 1 ? "" : "s"} failing`,
          "red",
        ]
      : ["advisory checks failing", "amber"];

  return (
    <div>
      <h1>
        System Status{" "}
        <span className="subtitle">
          data-integrity self-test and source freshness, in public
        </span>
      </h1>
      <p className="lede" style={{ maxWidth: 760 }}>
        Every publish runs the checks below and ships the results alongside the
        data. Source errors are sanitized and published verbatim — a broken
        source lowers freshness and shows up here; it never silently disappears.
      </p>
      <div className="kpi-row">
        <KpiCard
          label="Self-test"
          value={`${qa.passed}/${qa.total}`}
          context={selfTestContext}
          accent={selfTestAccent}
        />
        <KpiCard
          label="Sources OK"
          value={`${sourcesOk}/${sources.length}`}
          context="connectors on the last run"
          accent={sourcesOk === sources.length ? "emerald" : "amber"}
        />
        <KpiCard
          label="Last publish"
          value={qa.generated_at.slice(0, 10)}
          context={fmtStamp(qa.generated_at)}
          accent="sky"
        />
      </div>

      <Section title="Data-integrity self-test">
        <div className="table-card">
          <table className="data-table">
            <thead>
              <tr>
                <th>Check</th>
                <th>Level</th>
                <th>Status</th>
                <th style={{ textAlign: "left" }}>Detail</th>
              </tr>
            </thead>
            <tbody>
              {checkGroups.map((g) => {
                const failing = g.items.filter((c) => !c.pass).length;
                return [
                  <GroupRow key={`g-${g.section}`} cols={4} title={g.section}
                    summary={`${g.items.length} check${g.items.length === 1 ? "" : "s"} · ${failing ? `${failing} failing` : "all passing"}`} />,
                  ...g.items.map((c) => (
                <tr key={c.name}>
                  <td style={{ fontFamily: "ui-monospace, monospace", fontSize: 12 }}>
                    {c.name}
                  </td>
                  <td>
                    <span className={c.critical ? "badge" : "badge badge-muted"}>
                      {c.critical ? "critical" : "advisory"}
                    </span>
                  </td>
                  <td>
                    <StatusPill
                      tone={c.pass ? "ok" : c.critical ? "critical" : "advisory"}
                      label={c.pass ? "pass" : "fail"}
                    />
                  </td>
                  <td
                    style={{
                      textAlign: "left",
                      color: "var(--muted)",
                      maxWidth: 520,
                      whiteSpace: "normal",
                      overflowWrap: "anywhere",
                    }}
                  >
                    {c.detail}
                  </td>
                </tr>
                  )),
                ];
              })}
            </tbody>
          </table>
        </div>
      </Section>

      <Section title="Data sources — last pull">
        <div className="table-card">
          <table className="data-table">
            <thead>
              <tr>
                <th>Source</th>
                <th>Route</th>
                <th>Cadence</th>
                <th>Status</th>
                <th>Series freshness</th>
                <th>Fetched</th>
                <th>New rows</th>
                <th>Latest obs</th>
                <th>Finished</th>
              </tr>
            </thead>
            <tbody>
              {sourceGroups.map((g) => {
                const errors = g.items.filter((s) => !s.ok).length;
                return [
                  <GroupRow key={`g-${g.section}`} cols={9} title={g.section === "Shared" ? "Shared across sections" : g.section}
                    summary={`${g.items.length} source${g.items.length === 1 ? "" : "s"} · ${errors ? `${errors} with errors` : "all ok"}`} />,
                  ...g.items.map((s) => (
                <tr key={s.name}>
                  <td style={{ fontWeight: 600 }}>{s.name}</td>
                  <td>
                    <span className="badge badge-muted">{s.route}</span>
                  </td>
                  <td style={{ color: "var(--muted)" }}>{s.cadence}</td>
                  <td>
                    <StatusPill
                      tone={s.ok ? "ok" : "advisory"}
                      label={s.ok ? "ok" : "error"}
                    />
                  </td>
                  <td><FreshBar f={freshness[s.name]} /></td>
                  <td style={{ color: "var(--muted)" }}>{s.fetched}</td>
                  <td>{s.new_rows}</td>
                  <td>{s.latest_obs ?? "—"}</td>
                  <td style={{ color: "var(--muted)" }}>
                    {fmtStamp(s.finished_at)}
                  </td>
                </tr>
                  )),
                ];
              })}
            </tbody>
          </table>
        </div>
        {sources.some((s) => s.error) && (
          <div className="table-card" style={{ padding: "12px 16px" }}>
            {sources
              .filter((s) => s.error)
              .map((s) => (
                <p
                  key={s.name}
                  className="method wrap-anywhere"
                  style={{ margin: "4px 0", color: "var(--accent-red)" }}
                >
                  <strong>{s.name}:</strong> {s.error}
                </p>
              ))}
          </div>
        )}
      </Section>

      <Section title="Curated inputs — last review">
        <div className="table-card">
          <table className="data-table">
            <thead>
              <tr>
                <th style={{ textAlign: "left" }}>Input</th>
                <th>Page</th>
                <th>Last reviewed</th>
                <th>Age</th>
              </tr>
            </thead>
            <tbody>
              {CURATED_INPUTS.map((c) => (
                <tr key={c.label}>
                  <td style={{ textAlign: "left" }}>
                    {c.label}
                    {c.note && <small style={{ display: "block", color: "var(--muted)" }}>{c.note}</small>}
                  </td>
                  <td><Link href={c.href}>{c.href}</Link></td>
                  <td>{fmtDay(c.reviewed)}</td>
                  <td style={{ color: "var(--muted)" }}>{daysBetween(c.reviewed, qa.generated_at)}d</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="method">
          These AI Infra inputs are hand-curated from filings, broker reports and company statements rather than
          pulled by a connector, so they carry a review date instead of a fetch time. Age is counted to the last
          publish.
        </p>
      </Section>

      <p className="method">
        Connector failure isolation is a hard invariant of the pipeline: a
        broken source records an error, lowers freshness and surfaces above —
        it never blocks the run. Carry-forward store semantics make a missed
        day harmless. A schema-invalid artifact, by contrast, fails the run
        outright and never deploys.
      </p>
    </div>
  );
}
