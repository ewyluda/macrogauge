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
 */
import type { DcGrades, Leg } from "./types";

export type LegKey = "strict" | "extended";

export const BASIS_LABELS: Record<string, string> = {
  long_run: "Long-run",
  trailing_3yr: "Trailing 3yr",
  current_momentum: "Current momentum",
};

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
export function pairedShortfall(data: DcGrades, basis: string, months: number): PairedShortfall {
  return {
    strict: legShortfall(data.legs?.["strict"], basis, months),
    extended: legShortfall(data.legs?.["extended"], basis, months),
  };
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
