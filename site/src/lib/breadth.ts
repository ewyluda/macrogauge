/** Breadth and robust-central measures over the 14 component YoYs
 *  (quilt_months_*.json: month × component, ours and official). Everything
 *  here is arithmetic on published cells — nothing is re-priced.
 *
 *  The basket is COARSE (14 components vs Cleveland's 45-item trim), so read
 *  these as breadth diagnostics beside the Cleveland/Atlanta measures on
 *  /matrix, not as substitutes for them. */
export type QuiltComponent = {
  code: string;
  label: string;
  weight: number;
  ours_yoy_pct: (number | null)[];
  official_yoy_pct: (number | null)[];
};

export type BreadthSide = "ours" | "official";

export type BreadthRow = {
  month: string;
  /** share of components (by count) with YoY above `threshold` */
  aboveCountPct: number | null;
  /** share of basket weight with YoY above `threshold` */
  aboveWeightPct: number | null;
  /** share of basket weight whose YoY is higher than `accelLag` months earlier */
  acceleratingWeightPct: number | null;
  weightedMedian: number | null;
  trimmedMean: number | null;
};

function cellsAt(comps: QuiltComponent[], side: BreadthSide, k: number): { w: number; v: number }[] | null {
  const out: { w: number; v: number }[] = [];
  for (const c of comps) {
    const v = (side === "ours" ? c.ours_yoy_pct : c.official_yoy_pct)[k];
    if (v == null) return null;
    out.push({ w: c.weight, v });
  }
  return out;
}

/** Weighted median: the value where cumulative weight crosses half. */
export function weightedMedian(cells: { w: number; v: number }[]): number | null {
  if (!cells.length) return null;
  const sorted = [...cells].sort((a, b) => a.v - b.v);
  const total = sorted.reduce((s, c) => s + c.w, 0);
  let cum = 0;
  for (const c of sorted) {
    cum += c.w;
    if (cum >= total / 2) return c.v;
  }
  return sorted[sorted.length - 1].v;
}

/** Weight-trimmed mean: drop `trim` of the weight from each tail (splitting
 *  the component that straddles the cut), weighted mean of the rest —
 *  Cleveland Fed's construction for its 16% trimmed-mean CPI. */
export function trimmedMean(cells: { w: number; v: number }[], trim = 0.16): number | null {
  if (!cells.length) return null;
  const sorted = [...cells].sort((a, b) => a.v - b.v);
  const total = sorted.reduce((s, c) => s + c.w, 0);
  const lo = total * trim;
  const hi = total * (1 - trim);
  let cum = 0;
  let num = 0;
  let den = 0;
  for (const c of sorted) {
    const start = cum;
    const end = cum + c.w;
    cum = end;
    const keep = Math.max(0, Math.min(end, hi) - Math.max(start, lo));
    if (keep > 0) {
      num += keep * c.v;
      den += keep;
    }
  }
  return den > 0 ? num / den : null;
}

export function breadthRows(
  months: string[],
  comps: QuiltComponent[],
  side: BreadthSide,
  opts: { threshold?: number; accelLag?: number; trim?: number } = {},
): BreadthRow[] {
  const threshold = opts.threshold ?? 2;
  const lag = opts.accelLag ?? 3;
  return months.map((month, k) => {
    const cells = cellsAt(comps, side, k);
    if (!cells) {
      return { month, aboveCountPct: null, aboveWeightPct: null, acceleratingWeightPct: null, weightedMedian: null, trimmedMean: null };
    }
    const totalW = cells.reduce((s, c) => s + c.w, 0);
    const above = cells.filter((c) => c.v > threshold);
    let accel: number | null = null;
    if (k >= lag) {
      const prev = cellsAt(comps, side, k - lag);
      if (prev) {
        accel = (cells.reduce((s, c, j) => s + (c.v > prev[j].v ? c.w : 0), 0) / totalW) * 100;
      }
    }
    return {
      month,
      aboveCountPct: (above.length / cells.length) * 100,
      aboveWeightPct: (above.reduce((s, c) => s + c.w, 0) / totalW) * 100,
      acceleratingWeightPct: accel,
      weightedMedian: weightedMedian(cells),
      trimmedMean: trimmedMean(cells, opts.trim),
    };
  });
}

export function latestBreadth(rows: BreadthRow[]): BreadthRow | null {
  for (let i = rows.length - 1; i >= 0; i--) if (rows[i].weightedMedian != null) return rows[i];
  return null;
}
