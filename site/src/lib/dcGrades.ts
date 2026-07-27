/** Reading helpers for the escalation grading harness (dc_grades.json).
 *
 *  The strict leg (99 anchors from 2018-01, vintage-true, no downturn) and
 *  the extended leg (187 anchors from 2010-12, final-revision, contains a
 *  downturn) measure the SAME thing on two different samples of history.
 *  Their shortfall rates diverge because the strict sample never lived
 *  through a downturn -- that spread is the finding. Quoting either leg
 *  alone would hide it.
 *
 *  Every accessor here therefore returns BOTH legs, and every formatter
 *  names both. There is deliberately no single-leg accessor -- a caller
 *  cannot render one leg alone without writing new code to do it.
 *
 *  The same rule governs AGGREGATES, which is subtler: two legs averaged
 *  over different horizon sets are not a pair, they are two different
 *  statistics printed next to each other. `pairedBasisMeans` below is the
 *  only supported way to take a cross-horizon mean, and it aggregates both
 *  legs over the intersection of their published horizons.
 */
import type { DcGrades, Leg } from "./types";

export type LegKey = "strict" | "extended";

export const BASIS_LABELS: Record<string, string> = {
  long_run: "Long-run",
  trailing_3yr: "Trailing 3yr",
  current_momentum: "Current momentum",
};

/** /escalation's basis keys (dcContingency.ts's BASES) and the grading
 *  harness's basis keys (BASIS_LABELS above) are two vocabularies for an
 *  overlapping set of concepts — passing one straight into the other's
 *  accessors silently returns nothing. Total over /escalation's five keys:
 *  `gfc` and `covid` map to `null` on purpose. They are hindsight-selected
 *  historical episodes, not rules, and carry no grade anywhere in this
 *  feature (see /dc-scoreboard's Scenario section) — a `null` means "render
 *  the ungradeable note", not "grade unavailable this publish".
 *
 *  Lives here, beside the vocabulary it bridges, so /escalation (which reads
 *  it forwards) and /dc-scoreboard (which reads it backwards, to line the
 *  graded reconstruction up against the published index) cannot drift into
 *  two disagreeing copies. */
export const ESCALATION_BASIS_TO_GRADE: Record<string, string | null> = {
  longrun: "long_run",
  trailing3y: "trailing_3yr",
  momentum: "current_momentum",
  gfc: null,
  covid: null,
};

/** The ONLY slice of dc_grades.json a shortfall lookup needs.
 *
 *  /escalation is a static page: whatever its server component hands the
 *  client is serialized into escalation.html verbatim. The full artifact is
 *  ~58KB, dominated by the 286-row `anchors` array that page never reads —
 *  so the page passes this instead (~4KB) and the accessors below type
 *  against it. `DcGrades` is structurally assignable to it, so
 *  /dc-scoreboard's fuller object still works unchanged. */
export type GradeLegs = { legs: Record<string, Leg> };

/** Purpose-built payload for /escalation's inline paired verdict. Named
 *  rather than inlined at the call site so the boundary crossing is a
 *  deliberate, greppable decision instead of an accident of `{...data}`. */
export function escalationGradeSlice(data: DcGrades): GradeLegs {
  return { legs: data.legs };
}

/** The horizons the harness grades, matching /escalation's 48-month cap.
 *  Not every leg publishes every horizon -- see `Leg.published_horizons`. */
export const HORIZONS = [12, 24, 36, 48] as const;

export function horizonKey(months: number): string {
  return `h${months}`;
}

/** Snap an arbitrary delivery window onto the nearest graded horizon.
 *
 *  Ties round DOWN: claiming a longer horizon's grade for a shorter delivery
 *  window would borrow a thinner sample than the reader actually faces. The
 *  tie-break (`h < best`) is coded explicitly rather than left to fall out
 *  of scan order, so it holds even if HORIZONS is ever reordered. Pinned at
 *  every exact midpoint (18, 30, 42 months) in dcGrades.test.ts. */
export function nearestHorizon(months: number): number {
  let best: number = HORIZONS[0];
  let bestGap = Math.abs(months - best);
  for (const h of HORIZONS) {
    const gap = Math.abs(months - h);
    if (gap < bestGap || (gap === bestGap && h < best)) {
      best = h;
      bestGap = gap;
    }
  }
  return best;
}

/** One leg's answer for a single (basis, horizon) cell -- three distinct
 *  states, not a bare `number | null`:
 *
 *   - "graded": a real shortfall rate exists.
 *   - "withheld": this leg's own `published_horizons` excludes the horizon.
 *     Today only the strict leg at h=36/h=48 -- a deliberate editorial
 *     decision (roughly one independent draw there), not a missing figure.
 *   - "not_gradeable": the leg (or the whole legs block) is missing, or the
 *     horizon nominally publishes but no anchor reached that far. A real
 *     absence of measurement.
 *
 *  These must never collapse into the same rendered string -- see
 *  formatPairedVerdict(). */
export type LegShortfall =
  | { status: "graded"; shortfallPct: number }
  | { status: "withheld"; reason: string }
  | { status: "not_gradeable" };

export type PairedShortfall = { strict: LegShortfall; extended: LegShortfall };

/** Rendered explanation for the "withheld" state. This names an editorial
 *  decision (spec §2.1a's human ruling), not a computed threshold, so a
 *  fixed string is appropriate -- it will not go stale as the sample grows. */
export const WITHHELD_REASON = "vintage-true sample too thin at this horizon";

function legShortfall(leg: Leg | undefined, basis: string, months: number): LegShortfall {
  if (!leg) return { status: "not_gradeable" };
  const horizon = nearestHorizon(months);
  if (!leg.published_horizons.includes(horizon)) {
    return { status: "withheld", reason: WITHHELD_REASON };
  }
  const stat = leg.grades?.[basis]?.[horizonKey(horizon)];
  if (stat == null) return { status: "not_gradeable" };
  return { status: "graded", shortfallPct: stat.shortfall_rate_pct };
}

/** Read a (basis, horizon) shortfall rate off BOTH legs at once. The only
 *  way to reach a leg's shortfall rate -- there is no single-leg accessor,
 *  so the paired-legs rule cannot be violated by a caller reaching for a
 *  convenient shortcut. */
export function pairedShortfall(data: GradeLegs, basis: string, months: number): PairedShortfall {
  return {
    strict: legShortfall(data.legs?.["strict"], basis, months),
    extended: legShortfall(data.legs?.["extended"], basis, months),
  };
}

// ---------------------------------------------------------------------------
// Cross-horizon means
// ---------------------------------------------------------------------------

export type LegMeans = { meanMae: number; meanShortfall: number };

export type PairedBasisMeans = {
  basis: string;
  /** The horizons these means cover — the set EVERY present leg grades for
   *  this basis. Carried in the result, not assumed by the caller, because a
   *  mean is meaningless without it and the page must be able to say so. */
  horizons: number[];
  strict: LegMeans | null;
  extended: LegMeans | null;
};

/** Which horizons a set of legs can be COMPARED over: the intersection of
 *  their `published_horizons`.
 *
 *  Today [12, 24] — the strict leg withholds h36/h48 — but computed, never
 *  assumed: the strict leg's withheld set is an editorial ruling that can be
 *  revisited as its sample deepens. */
export function sharedHorizons(legs: Leg[]): number[] {
  if (!legs.length) return [];
  return HORIZONS.filter((h) => legs.every((l) => l.published_horizons.includes(h)));
}

function meansOver(leg: Leg, basis: string, horizons: number[]): LegMeans {
  const stats = horizons.map((h) => leg.grades[basis][horizonKey(h)]!);
  return {
    meanMae: stats.reduce((a, s) => a + s.mae_pp, 0) / stats.length,
    meanShortfall: stats.reduce((a, s) => a + s.shortfall_rate_pct, 0) / stats.length,
  };
}

/** Per-basis mean MAE and mean shortfall for BOTH legs, over the SAME
 *  horizons.
 *
 *  This is the paired-legs rule applied to aggregates. Averaging each leg
 *  over its own `published_horizons` and printing the two side by side reads
 *  as a comparison but is not one: the strict leg would average h12/h24 while
 *  the extended leg averaged h12/h24/h36/h48, and the extended figure would
 *  be dragged by two horizons the strict leg never contributes to. Measured
 *  on the live artifact that understated the strict-vs-extended shortfall
 *  spread on the best-MAE basis by ~7pp (11.1pp shown against 18.4pp
 *  like-for-like) — i.e. it shrank the branch's central finding by ~40%.
 *
 *  These means are the ONE class of statistic this feature computes in the
 *  page rather than the pipeline. They are plain unweighted averages of the
 *  per-horizon figures the artifact publishes and the table renders directly
 *  above them, over the horizons named in `horizons` — reproducible by hand
 *  from that table, which is what the acceptance criterion asks for. */
export function pairedBasisMeans(data: GradeLegs): PairedBasisMeans[] {
  const present = (["strict", "extended"] as const)
    .map((key) => ({ key, leg: data.legs?.[key] }))
    .filter((e): e is { key: LegKey; leg: Leg } => e.leg != null);
  const shared = sharedHorizons(present.map((e) => e.leg));
  const out: PairedBasisMeans[] = [];
  for (const basis of Object.keys(BASIS_LABELS)) {
    // A horizon counts only where EVERY present leg actually has a stat for
    // this basis: a horizon inside published_horizons can still come back
    // null when no anchor reached it, and averaging one leg over more
    // horizons than the other is the exact defect above in miniature.
    const horizons = shared.filter((h) =>
      present.every((e) => e.leg.grades?.[basis]?.[horizonKey(h)] != null),
    );
    if (!horizons.length) continue;
    const row: PairedBasisMeans = { basis, horizons, strict: null, extended: null };
    for (const e of present) row[e.key] = meansOver(e.leg, basis, horizons);
    out.push(row);
  }
  return out;
}

/** "12- and 24-month" — the horizon set spelled out for prose, so a mean
 *  never renders without naming what it covers. */
export function formatHorizonList(horizons: number[]): string {
  if (!horizons.length) return "no";
  if (horizons.length === 1) return `${horizons[0]}-month`;
  const head = horizons.slice(0, -1).join("-, ");
  return `${head}- and ${horizons[horizons.length - 1]}-month`;
}

const SAMPLE_NAME: Record<LegKey, string> = {
  strict: "vintage-true sample",
  extended: "deeper sample that includes a downturn",
};

/** One sentence naming both legs. Never renders a figure without its
 *  counterpart leg: a graded figure always states which sample it's on; a
 *  withheld leg appends its explanation as a parenthetical (never collapsed
 *  into "not gradeable"); a truly ungradeable leg says so plainly. The
 *  fully-ungradeable case returns one fixed sentence rather than an empty
 *  "under-provisioned ." -- there is nothing to lead with. */
export function formatPairedVerdict(basis: string, months: number, pair: PairedShortfall): string {
  const h = nearestHorizon(months);
  const label = BASIS_LABELS[basis] ?? basis;

  if (pair.strict.status === "not_gradeable" && pair.extended.status === "not_gradeable") {
    return `Not gradeable at a ${h}-month horizon on either sample.`;
  }

  const gradedParts: string[] = [];
  const notes: string[] = [];
  for (const key of ["strict", "extended"] as const) {
    const leg = pair[key];
    if (leg.status === "graded") {
      gradedParts.push(`${leg.shortfallPct.toFixed(1)}% of ${h}-month windows on the ${SAMPLE_NAME[key]}`);
    } else if (leg.status === "withheld") {
      notes.push(leg.reason);
    } else {
      notes.push(`not gradeable on the ${SAMPLE_NAME[key]}`);
    }
  }

  const lead =
    gradedParts.length > 0
      ? `${label} under-provisioned ${gradedParts.join(" and ")}.`
      : `${label} has no figure at a ${h}-month horizon on either sample.`;

  return notes.length > 0 ? `${lead} (${notes.join("; ")}.)` : lead;
}
