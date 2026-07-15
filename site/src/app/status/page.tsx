import type { Metadata } from "next";
import qa from "../../../public/data/qa.json";
import sourcesStatus from "../../../public/data/sources_status.json";
import { KpiCard, type Accent } from "@/components/KpiCard";
import { Section } from "@/components/Section";
import { StatusPill } from "@/components/StatusPill";
import { fmtStamp } from "@/lib/format";

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

export default function Status() {
  const checks = qa.checks as QaCheck[];
  const sources = sourcesStatus.sources as Source[];
  const allPass = qa.passed === qa.total;
  const criticalFailing = checks.filter((c) => c.critical && !c.pass).length;
  const sourcesOk = sources.filter((s) => s.ok).length;
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
              {checks.map((c) => (
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
                    <StatusPill ok={c.pass} label={c.pass ? "pass" : "fail"} />
                  </td>
                  <td
                    style={{
                      textAlign: "left",
                      color: "var(--muted)",
                      maxWidth: 520,
                      whiteSpace: "normal",
                    }}
                  >
                    {c.detail}
                  </td>
                </tr>
              ))}
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
                <th>Series</th>
                <th>New rows</th>
                <th>Latest obs</th>
                <th>Finished</th>
              </tr>
            </thead>
            <tbody>
              {sources.map((s) => (
                <tr key={s.name}>
                  <td style={{ fontWeight: 600 }}>{s.name}</td>
                  <td>
                    <span className="badge badge-muted">{s.route}</span>
                  </td>
                  <td style={{ color: "var(--muted)" }}>{s.cadence}</td>
                  <td>
                    <StatusPill ok={s.ok} label={s.ok ? "ok" : "error"} />
                  </td>
                  <td>{s.series_count}</td>
                  <td>{s.new_rows}</td>
                  <td>{s.latest_obs ?? "—"}</td>
                  <td style={{ color: "var(--muted)" }}>
                    {fmtStamp(s.finished_at)}
                  </td>
                </tr>
              ))}
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
                  className="method"
                  style={{ margin: "4px 0", color: "var(--accent-red)" }}
                >
                  <strong>{s.name}:</strong> {s.error}
                </p>
              ))}
          </div>
        )}
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
