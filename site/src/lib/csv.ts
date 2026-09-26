/** RFC-4180 CSV serialization for the download buttons.
 *
 *  - header = union of keys in first-seen order (or an explicit `columns`)
 *  - null/undefined → empty cell; numbers/booleans unquoted; everything else
 *    quoted only when it needs to be (comma, quote, CR/LF)
 *  - optional `comment` lines are emitted first, `# `-prefixed, so the
 *    citation rides inside the file without breaking spreadsheet imports
 *    that skip comment rows (and is harmless in those that don't).
 *  - CRLF line endings per the RFC. */
export type CsvRow = Record<string, unknown>;

export function csvCell(v: unknown): string {
  if (v === null || v === undefined) return "";
  if (typeof v === "number") return Number.isFinite(v) ? String(v) : "";
  if (typeof v === "boolean") return v ? "true" : "false";
  const s = typeof v === "string" ? v : JSON.stringify(v);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function csvColumns(rows: CsvRow[]): string[] {
  const seen = new Set<string>();
  for (const r of rows) for (const k of Object.keys(r)) seen.add(k);
  return [...seen];
}

export function toCsv(
  rows: CsvRow[],
  opts: { columns?: string[]; comment?: string | string[] } = {},
): string {
  const cols = opts.columns ?? csvColumns(rows);
  const comments = opts.comment == null ? [] : ([] as string[]).concat(opts.comment);
  const lines = [
    ...comments.map((c) => `# ${c.replace(/[\r\n]+/g, " ")}`),
    cols.map(csvCell).join(","),
    ...rows.map((r) => cols.map((c) => csvCell(r[c])).join(",")),
  ];
  return lines.join("\r\n") + "\r\n";
}

/** Rows from parallel arrays (the shape most artifacts publish): one row per
 *  index of `key`, one column per series. Lengths are trusted; a shorter
 *  series yields empty cells rather than throwing. */
export function columnsToRows(
  key: { name: string; values: readonly unknown[] },
  series: { name: string; values: readonly unknown[] }[],
): CsvRow[] {
  return key.values.map((k, i) => {
    const row: CsvRow = { [key.name]: k };
    for (const s of series) row[s.name] = s.values[i] ?? null;
    return row;
  });
}

/** One flat row from a nested artifact object: nested objects become dotted
 *  keys (`zori.yoy_pct`), arrays are dropped (sparkline tails do not belong
 *  in a table row). */
export function flattenRow(obj: object, prefix = ""): CsvRow {
  const out: CsvRow = {};
  for (const [k, v] of Object.entries(obj)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (Array.isArray(v)) continue;
    if (v && typeof v === "object") Object.assign(out, flattenRow(v, key));
    else out[key] = v;
  }
  return out;
}

/** A serializable recipe for CSV rows, resolved against the published
 *  artifact only when the reader clicks ↓ CSV. A server page hands the client
 *  DownloadData these few bytes instead of every row — /rates inlined 2,182
 *  keyed row objects (59% of an 820 kB page) that the JSON under /data
 *  already carries. Paths are dotted keys into the artifact.
 *  - `columns`: parallel arrays → one row per key entry (columnsToRows),
 *    optionally keeping only key values ≥ `from` (a trailing window);
 *  - `rows`: an array of row objects, optionally flattened (flattenRow). */
export type CsvSpec =
  | {
      kind: "columns";
      key: { name: string; path: string };
      series: { name: string; path: string }[];
      from?: string;
    }
  | { kind: "rows"; path: string; flatten?: boolean };

/** Value at a dotted path ("liquidity.history.dates"); undefined if absent. */
export function getPath(obj: unknown, path: string): unknown {
  let cur: unknown = obj;
  for (const k of path.split(".")) {
    if (cur == null || typeof cur !== "object") return undefined;
    cur = (cur as Record<string, unknown>)[k];
  }
  return cur;
}

const asArray = (v: unknown): readonly unknown[] => (Array.isArray(v) ? v : []);

/** Build the rows a CsvSpec describes from a fetched artifact. */
export function rowsFromSpec(data: unknown, spec: CsvSpec): CsvRow[] {
  if (spec.kind === "rows") {
    const rows = asArray(getPath(data, spec.path)) as object[];
    return spec.flatten ? rows.map((r) => flattenRow(r)) : (rows as CsvRow[]);
  }
  const key = asArray(getPath(data, spec.key.path));
  const series = spec.series.map((s) => ({ name: s.name, values: asArray(getPath(data, s.path)) }));
  const rows = columnsToRows({ name: spec.key.name, values: key }, series);
  const from = spec.from;
  return from == null ? rows : rows.filter((r) => String(r[spec.key.name]) >= from);
}
