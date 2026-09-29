/** Text alternative for an ECharts canvas (review 2026-09-01 B15).
 *
 *  A canvas is opaque to assistive technology, so every chart's container is
 *  `role="img"` with an aria-label built here from the option itself: the
 *  chart's title (when the wrapper passes one), then each series' name and
 *  its LATEST value — the last non-null point, with its x position — which is
 *  the number a sighted reader takes from the line's right edge. Pure, so it
 *  is unit-tested without a DOM. */

type Obj = Record<string, unknown>;

const MAX_SERIES = 8;

const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);

function fmtNum(v: number): string {
  if (Math.abs(v) >= 1000) return v.toLocaleString("en-US", { maximumFractionDigits: 0 });
  return v.toFixed(2);
}

function fmtX(x: unknown): string | null {
  if (typeof x === "string" && x) return x;
  if (typeof x === "number" && Number.isFinite(x)) return fmtNum(x);
  return null;
}

/** [value, x] of one data point, or null when it carries no number. */
function point(d: unknown, i: number, categories: unknown[] | null): [number, string | null] | null {
  if (typeof d === "number") return Number.isFinite(d) ? [d, fmtX(categories?.[i])] : null;
  if (Array.isArray(d)) {
    // [x, y] pairs (time/category axes) and [x, y, …] scatter tuples
    const y = d.length >= 2 ? d[1] : d[0];
    return typeof y === "number" && Number.isFinite(y) ? [y, d.length >= 2 ? fmtX(d[0]) : fmtX(categories?.[i])] : null;
  }
  if (isObj(d) && "value" in d) {
    const p = point(d.value, i, categories);
    return p ? [p[0], p[1] ?? fmtX(d.name) ?? fmtX(categories?.[i])] : null;
  }
  return null;
}

function categoryData(axis: unknown): unknown[] | null {
  const a = Array.isArray(axis) ? axis[0] : axis;
  return isObj(a) && Array.isArray(a.data) ? (a.data as unknown[]) : null;
}

function countLeaves(nodes: unknown[]): number {
  return nodes.reduce<number>((n, d) => n + (isObj(d) && Array.isArray(d.children) ? countLeaves(d.children) : 1), 0);
}

export function chartAriaLabel(option: Obj, title?: string): string {
  const raw = option.series;
  const series: Obj[] = (Array.isArray(raw) ? raw : raw ? [raw] : []).filter(isObj);
  const horizontal = isObj(option.yAxis) && option.yAxis.type === "category";
  const categories = categoryData(horizontal ? option.yAxis : option.xAxis);
  const kind = typeof series[0]?.type === "string" ? `${series[0].type} chart` : "chart";
  const parts: string[] = [];
  for (const [si, s] of series.entries()) {
    const data = Array.isArray(s.data) ? (s.data as unknown[]) : [];
    const name = typeof s.name === "string" && s.name ? s.name : null;
    if (s.type === "treemap") {
      parts.push(`${name ?? "treemap"}: ${countLeaves(data)} items`);
      continue;
    }
    let latest: [number, string | null] | null = null;
    for (let i = data.length - 1; i >= 0 && !latest; i--) latest = point(data[i], i, categories);
    if (!latest) continue; // markLine/markArea carrier series hold no data
    parts.push(`${name ?? `series ${si + 1}`} ${fmtNum(latest[0])}${latest[1] ? ` at ${latest[1]}` : ""}`);
  }
  const head = title ?? kind[0].toUpperCase() + kind.slice(1);
  if (parts.length === 0) return `${head} (no data)`;
  const shown = parts.slice(0, MAX_SERIES).join("; ");
  const more = parts.length > MAX_SERIES ? `; and ${parts.length - MAX_SERIES} more series` : "";
  return `${head} — latest: ${shown}${more}`;
}
