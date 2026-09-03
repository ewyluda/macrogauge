import type { Metadata } from "next";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { DATA_FILES, dataUrl } from "@/lib/dataFiles";
import { SITE_URL } from "@/lib/site";
import { fmtStamp } from "@/lib/format";

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
const rows = DATA_FILES.map((d) => {
  const p = path.join(DATA_DIR, d.file);
  let stamp: string | null = null;
  try { stamp = (JSON.parse(readFileSync(p, "utf8")) as { published_at?: string }).published_at ?? null; } catch { stamp = null; }
  return { ...d, bytes: statSync(p).size, stamp, schema: schemaFor(d.file) };
});
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
        Base URL <code>{SITE_URL}/data/</code> · updated each weekday morning (see <a href="/status">/status</a> for the run) ·
        licence: free to use with attribution — cite as <code>MacroGauge &lt;series&gt;, &lt;as-of&gt;, 2018-01=100, &lt;value&gt; — {SITE_URL}/&lt;page&gt;</code> (the
        Copy button under every headline number produces this string). The append-only vintage store behind the numbers is in the
        repository; <a href="/as-of">Point in Time</a> reads the publish ledger.
      </p>
      <div className="table-card">
        <table className="data-table">
          <thead><tr><th style={{ textAlign: "left" }}>File</th><th style={{ textAlign: "left" }}>What it holds</th><th>Size</th><th>Published</th><th>Schema</th></tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.file}>
                <td style={{ textAlign: "left" }}><a href={dataUrl(r.file)} download style={{ fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace" }}>{r.file}</a></td>
                <td style={{ textAlign: "left", color: "var(--muted)" }}>{r.description}</td>
                <td>{kb(r.bytes)}</td>
                <td style={{ color: "var(--muted)" }}>{r.stamp ? fmtStamp(r.stamp) : "—"}</td>
                <td>{r.schema ? <a href={`/schemas/${r.schema}`} style={{ fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace", fontSize: 11 }}>{r.schema}</a> : "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="method">
        {rows.length} artifacts. The RSS feed at <a href="/feed.xml">/feed.xml</a> carries one item per publish. Sizes are of the committed
        files; replay.json is the largest because it holds every component&apos;s daily index since 2018.
      </p>
    </div>
  );
}
