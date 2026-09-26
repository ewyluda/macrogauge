"use client";
import { useState } from "react";
import { rowsFromSpec, toCsv, type CsvRow, type CsvSpec } from "@/lib/csv";
import { dataUrl } from "@/lib/dataFiles";
import { fetchJson } from "@/lib/fetchJson";
import { ToolDisclosure } from "./ToolDisclosure";

/** CSV / JSON download pair for a table or chart.
 *
 *  CSV is serialized client-side, citation on the first `#` line, from either
 *  `rows` (the exact rows the reader sees — right for small or derived
 *  tables) or a `spec` (lib/csv CsvSpec): a recipe resolved against the
 *  published `json` artifact, fetched only when ↓ CSV is clicked, so a long
 *  history never rides inline in the page HTML. JSON links straight to the
 *  published artifact under /data — the same file the page was built from —
 *  so the download is the primary source, not a re-encoding of it. */
export function DownloadData({
  rows,
  spec,
  filename,
  json,
  citation,
  columns,
  compact = true,
}: {
  rows?: CsvRow[];
  /** lazy rows: built from `json` on click (requires `json`) */
  spec?: CsvSpec;
  /** basename without extension, e.g. "macrogauge-grocery" */
  filename: string;
  /** published artifact, e.g. "grocery_basket.json" (omit for derived tables) */
  json?: string;
  citation?: string;
  columns?: string[];
  compact?: boolean;
}) {
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const save = (csvRows: CsvRow[]) => {
    const text = toCsv(csvRows, { columns, comment: citation });
    const blob = new Blob([text], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${filename}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  const downloadCsv = async () => {
    if (!spec || !json) {
      save(rows ?? []);
      return;
    }
    setBusy(true);
    setFailed(false);
    try {
      save(rowsFromSpec(await fetchJson<unknown>(dataUrl(json)), spec));
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  };
  const lazy = !!spec && !!json;
  const content = (
    <span className="tool-row download-data" aria-label="Download data">
      <button type="button" className="tool-btn" onClick={downloadCsv} disabled={busy || (!lazy && (rows ?? []).length === 0)}>
        {busy ? "↓ CSV…" : "↓ CSV"}
      </button>
      {json && (
        <a className="tool-btn" href={dataUrl(json)} download>
          ↓ JSON
        </a>
      )}
      {failed && <span role="status" style={{ fontSize: 11, color: "var(--accent-red)" }}>CSV unavailable — retry</span>}
    </span>
  );
  return compact ? (
    <ToolDisclosure label="Export data">{content}</ToolDisclosure>
  ) : content;
}
