import Link from "next/link";
import type { Metadata } from "next";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { DATA_FILES, DATA_SECTIONS, dataUrl, newestAsOf } from "@/lib/dataFiles";
import { dataPageCsv } from "@/lib/exportSpecs";
import { DownloadData } from "@/components/DownloadData";
import { SITE_URL } from "@/lib/site";
import { fmtDay, fmtStamp } from "@/lib/format";

export const metadata: Metadata = {
  title: "Open Data — every artifact, its schema, and how to cite it",
  description: "Every JSON file the pipeline publishes, validated against a JSON Schema on every run, with sizes, stamps and a citation format.",
};

// Build-time reads of the committed artifacts (static export; no runtime fs).
const DATA_DIR = path.join(process.cwd(), "public", "data");
const SCHEMA_DIR = path.join(process.cwd(), "public", "schemas");
const present = new Set(readdirSync(SCHEMA_DIR));
const schemaFor = (file: string) => {
  const base = file.replace(/\.json$/, "");
  const candidates = [`${base}.schema.json`, base.startsWith("quilt_months") ? "quilt.schema.json" : "", base.startsWith("accountability") ? "accountability.schema.json" : ""].filter(Boolean);
  return candidates.find((c) => present.has(c)) ?? null;
};
type Field = { name: string; type: string; description: string | null };
/** A schema's top-level fields, for the DC and compute field previews. */
const fieldsOf = (schema: string | null): Field[] => {
  if (!schema) return [];
  try {
    const s = JSON.parse(readFileSync(path.join(SCHEMA_DIR, schema), "utf8")) as
      { properties?: Record<string, { type?: string | string[]; description?: string; $ref?: string }> };
    return Object.entries(s.properties ?? {}).map(([name, v]) => ({
      name, type: v.type ? [v.type].flat().join(" | ") : v.$ref ? "object" : "—", description: v.description ?? null,
    }));
  } catch { return []; }
};
const rows = DATA_FILES.map((d) => {
  const p = path.join(DATA_DIR, d.file);
  let json: unknown = null;
  try { json = JSON.parse(readFileSync(p, "utf8")); } catch { json = null; }
  const stamp = (json as { published_at?: string } | null)?.published_at ?? null;
  const schema = schemaFor(d.file);
  const csv = json ? dataPageCsv(d.file, json) : null;
  return { ...d, bytes: statSync(p).size, stamp, schema, newest: json ? newestAsOf(json) : null,
           csv, fields: csv ? fieldsOf(schema) : [] };
});
const groups = DATA_SECTIONS.map((section) => ({ section, rows: rows.filter((r) => r.section === section) }))
  .filter((g) => g.rows.length > 0);
const kb = (b: number) => (b >= 1_048_576 ? `${(b / 1_048_576).toFixed(1)} MB` : `${Math.round(b / 1024)} KB`);

export default function DataPage() {
  return (
    <div>
      <h1>
        Open Data <span className="subtitle">every artifact, its schema, and how to cite it</span>
      </h1>
      <p className="lede">
        The site computes nothing at request time — every page renders JSON the pipeline committed that morning. All
        of it is public, static, and validated inline against a JSON Schema before it can deploy (a schema-invalid file
        fails the run). Fetch any file below directly; the schema beside it is the contract. Fields are added, never
        renamed or removed, so an integration written today keeps working.
      </p>
      <p className="method">
        Base URL <code>{SITE_URL}/data/</code> · updated each weekday morning (see <Link href="/status">/status</Link> for the run) ·
        licence: MacroGauge-computed values (indexes, blends, nowcasts, composites, grades) are free to use with attribution —
        cite as <code>MacroGauge &lt;series&gt;, &lt;as-of&gt;, 2018-01=100, &lt;value&gt; — {SITE_URL}/&lt;page&gt;</code> (the
        Copy button under every headline number produces this string). Source observations republished alongside them
        (BLS, BEA, FRED/ALFRED, EIA, Treasury, Census, USDA and the private sources listed on <Link href="/methodology">/methodology</Link>) remain
        subject to each provider&apos;s own terms — check those before redistributing raw source series. The append-only vintage store behind the numbers is in the
        repository; <Link href="/as-of">Point in Time</Link> reads the publish ledger.
      </p>
      <p className="method">
        Embed a live reading: <code style={{ overflowWrap: "anywhere" }}>{`<img src="${SITE_URL}/badge/gauge.svg" alt="MacroGauge CPI YoY">`}</code> or{" "}
        <code style={{ overflowWrap: "anywhere" }}>{`<img src="${SITE_URL}/badge/dc-build.svg" alt="DC Build cost YoY">`}</code> — plain SVG badges regenerated with every
        publish (<a href="/badge/gauge.svg">gauge</a> · <a href="/badge/dc-build.svg">DC Build</a>). Link them back to the page they cite.
      </p>
      <div className="table-card">
        <table className="data-table">
          <thead><tr><th style={{ textAlign: "left" }}>File</th><th style={{ textAlign: "left" }}>What it holds</th><th>Newest data</th><th>Size</th><th>Published</th><th>Schema</th></tr></thead>
          <tbody>
            {groups.map((g) => [
              <tr key={`g-${g.section}`} className="data-group">
                <th colSpan={6} scope="colgroup">{g.section} <span>{g.rows.length} file{g.rows.length === 1 ? "" : "s"}</span></th>
              </tr>,
              ...g.rows.flatMap((r) => [
              <tr key={r.file}>
                <td style={{ textAlign: "left" }}><a href={dataUrl(r.file)} download style={{ fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace" }}>{r.file}</a></td>
                <td style={{ textAlign: "left", color: "var(--muted)" }}>{r.description}</td>
                <td style={{ whiteSpace: "nowrap" }}>{r.newest ? fmtDay(r.newest) : "—"}</td>
                <td>{kb(r.bytes)}</td>
                <td style={{ color: "var(--muted)" }}>{r.stamp ? fmtStamp(r.stamp) : "—"}</td>
                <td>{r.schema ? <a href={`/schemas/${r.schema}`} style={{ fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace", fontSize: 11 }}>{r.schema}</a> : "—"}</td>
              </tr>,
              ...(r.csv ? [
                <tr key={`${r.file}-more`} className="data-more">
                  <td colSpan={6} style={{ textAlign: "left" }}>
                    <div className="data-more-row">
                      <details className="data-fields" data-testid="data-fields">
                        <summary>Fields ({r.fields.length})</summary>
                        <ul>
                          {r.fields.map((f) => (
                            <li key={f.name}><code>{f.name}</code> <span className="data-field-type">{f.type}</span>
                              {f.description && <> — {f.description}</>}</li>
                          ))}
                        </ul>
                      </details>
                      <DownloadData spec={r.csv.spec} filename={`macrogauge-${r.file.replace(/\.json$/, "")}`} json={r.file}
                        csvLabel={r.csv.label} hideJson citation={`MacroGauge ${r.file}, ${r.stamp ? fmtStamp(r.stamp) : ""}`} />
                    </div>
                  </td>
                </tr>,
              ] : []),
              ]),
            ])}
          </tbody>
        </table>
      </div>
      <p className="method">
        {rows.length} artifacts, grouped by the section of the site they feed. Newest data is the latest observation
        date anywhere in the file (a curated input&apos;s review date doesn&apos;t count). The AI Infra cost and compute files
        list their fields and export their main table as CSV. The RSS feed at <a href="/feed.xml">/feed.xml</a> carries one item per publish. Sizes are of the committed
        files; replay.json is the largest because it holds every component&apos;s daily index since 2018.
      </p>
    </div>
  );
}
