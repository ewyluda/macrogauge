"use client";
import { toCsv, type CsvRow } from "@/lib/csv";
import { dataUrl } from "@/lib/dataFiles";

/** CSV / JSON download pair for a table or chart.
 *
 *  CSV is serialized client-side from `rows` (the exact rows the reader sees,
 *  citation on the first `#` line). JSON links straight to the published
 *  artifact under /data — the same file the page was built from — so the
 *  download is the primary source, not a re-encoding of it. */
export function DownloadData({
  rows,
  filename,
  json,
  citation,
  columns,
}: {
  rows: CsvRow[];
  /** basename without extension, e.g. "macrogauge-grocery" */
  filename: string;
  /** published artifact, e.g. "grocery_basket.json" (omit for derived tables) */
  json?: string;
  citation?: string;
  columns?: string[];
}) {
  const downloadCsv = () => {
    const text = toCsv(rows, { columns, comment: citation });
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
  return (
    <span className="tool-row download-data" aria-label="Download data">
      <button type="button" className="tool-btn" onClick={downloadCsv} disabled={rows.length === 0}>
        ↓ CSV
      </button>
      {json && (
        <a className="tool-btn" href={dataUrl(json)} download>
          ↓ JSON
        </a>
      )}
    </span>
  );
}
