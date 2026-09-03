import type { DcGradesAnchor } from "./types";
import { horizonKey } from "./dcGrades";

/** One vintage anchor, read for a single basis × horizon: what the basis
 *  said the annualized escalation would be at that month, and what the
 *  index actually did over the next `h` months. Both in %/yr. */
export type AnchorPoint = {
  m: string;
  expected: number;
  realized: number;
  /** realized − expected when the basis under-provisioned, else 0 */
  shortfallPp: number;
};

export function anchorPoints(
  anchors: DcGradesAnchor[],
  leg: string,
  basis: string,
  h: number,
): AnchorPoint[] {
  const hk = horizonKey(h);
  const out: AnchorPoint[] = [];
  for (const a of anchors) {
    if (a.leg !== leg) continue;
    const expected = a.bases[basis];
    const realized = a.realized[hk];
    if (expected == null || realized == null) continue;
    out.push({ m: a.m, expected, realized, shortfallPp: Math.max(0, realized - expected) });
  }
  return out;
}

export type AnchorStats = {
  n: number;
  maePp: number;
  biasPp: number;
  shortfallRatePct: number;
  meanShortfallPp: number | null;
  worstShortfallPp: number | null;
};

/** The same statistics the pipeline publishes in legs.*.grades, recomputed
 *  from the anchors so the scatter's caption cannot drift from the table
 *  (dcAnchors.test.ts pins them against the committed artifact). Bias is
 *  expected − realized (negative = the basis ran short). */
export function anchorStats(points: AnchorPoint[]): AnchorStats | null {
  if (!points.length) return null;
  const n = points.length;
  const errs = points.map((p) => p.expected - p.realized);
  const short = points.filter((p) => p.shortfallPp > 0);
  return {
    n,
    maePp: errs.reduce((s, e) => s + Math.abs(e), 0) / n,
    biasPp: errs.reduce((s, e) => s + e, 0) / n,
    shortfallRatePct: (short.length / n) * 100,
    meanShortfallPp: short.length ? short.reduce((s, p) => s + p.shortfallPp, 0) / short.length : null,
    worstShortfallPp: short.length ? Math.max(...short.map((p) => p.shortfallPp)) : null,
  };
}

/** Bases that carry at least one non-null value on this leg, in first-seen order. */
export function anchorBases(anchors: DcGradesAnchor[], leg: string): string[] {
  const seen: string[] = [];
  for (const a of anchors) {
    if (a.leg !== leg) continue;
    for (const [k, v] of Object.entries(a.bases)) if (v != null && !seen.includes(k)) seen.push(k);
  }
  return seen;
}
