/** Construction spend S-curve for the portfolio's midpoint escalation.
 *
 *  MODEL — sine-squared cumulative spend. With construction progress
 *  u = (t − start) / (delivery − start) ∈ [0, 1], the share of the project's
 *  spend incurred by u is
 *
 *      S(u) = sin²(πu / 2) = (1 − cos πu) / 2
 *
 *  whose spend RATE S'(u) = (π/2)·sin(πu) is a symmetric bell: zero at
 *  mobilisation and at delivery, peaking mid-build. It is symmetric
 *  (S(1 − u) = 1 − S(u)), so S(½) = ½ and the spend midpoint of a whole build
 *  is the calendar midpoint of start and delivery. It has a closed-form
 *  inverse, u = (2/π)·asin(√s), so the midpoint of any remaining tail is exact
 *  arithmetic, not a numerical search (chosen over a logistic, which never
 *  reaches 0 or 1 at the ends and needs a steepness parameter). Nothing about
 *  the DC Build index is assumed by it — it only decides WHEN the dollars go
 *  out.
 *
 *  MIDPOINT. A month-stepped escalation carries each dollar from the anchor to
 *  when it is spent; the standard single-point shortcut carries all of it to
 *  the spend midpoint — the month by which HALF the dollars still to be spent
 *  have gone out. Spend already incurred by the anchor is not carried at all.
 *  With f = S(u_anchor) incurred, the remaining tail runs from f to 1, its
 *  midpoint is the progress where S = (1 + f) / 2, and for a build that has
 *  not started (f = 0) that is u = ½ — the plain start/delivery midpoint.
 *
 *  Pure functions of "YYYY-MM" strings; no index data. */
import { addMonths, monthDiff } from "./dcEscalation";

/** Construction duration assumed when a project carries no start month. */
export const DEFAULT_DURATION_MONTHS = 24;

/** Cumulative share of spend at construction progress u (clamped to [0, 1]). */
export function cumulativeSpend(u: number): number {
  const x = Math.min(1, Math.max(0, u));
  const s = Math.sin((Math.PI * x) / 2);
  return s * s;
}

/** Progress u at which cumulative spend reaches s (clamped to [0, 1]). */
export function inverseCumulativeSpend(s: number): number {
  const x = Math.min(1, Math.max(0, s));
  return (2 / Math.PI) * Math.asin(Math.sqrt(x));
}

export type SpendSchedule = {
  startMonth: string;
  deliveryMonth: string;
  /** true when the project carries no start month and DEFAULT_DURATION_MONTHS was assumed */
  startAssumed: boolean;
  durationMonths: number;
  /** S(u) at the anchor: share of spend already incurred (0 if not yet started, 1 if delivered) */
  incurredFraction: number;
  /** 1 − incurredFraction: the share that is carried forward */
  remainingFraction: number;
  /** spend midpoint of the REMAINING spend, rounded to a month; null when nothing remains */
  midpointMonth: string | null;
  /** months from the anchor to midpointMonth (0 when nothing remains) */
  midpointHorizon: number;
};

/** The start month a project resolves to: its own, or delivery − 24 months. */
export function resolveStart(startMonth: string | undefined, deliveryMonth: string): { month: string; assumed: boolean } {
  return startMonth ? { month: startMonth, assumed: false } : { month: addMonths(deliveryMonth, -DEFAULT_DURATION_MONTHS), assumed: true };
}

/** Spend schedule of one project seen from `anchor` (the last complete month).
 *  Returns null when start is not strictly before delivery. Month positions
 *  are month-start instants on the same grid as monthDiff, so a build from
 *  2025-01 to 2027-01 seen from 2026-01 is exactly half way through. */
export function spendSchedule(startMonth: string | undefined, deliveryMonth: string, anchor: string): SpendSchedule | null {
  const start = resolveStart(startMonth, deliveryMonth);
  const duration = monthDiff(start.month, deliveryMonth);
  if (!(duration > 0)) return null;
  const elapsed = monthDiff(start.month, anchor);
  const incurred = cumulativeSpend(elapsed / duration);
  const remaining = 1 - incurred;
  const base = {
    startMonth: start.month, deliveryMonth, startAssumed: start.assumed, durationMonths: duration,
    incurredFraction: incurred, remainingFraction: remaining,
  };
  if (elapsed >= duration || remaining <= 0) return { ...base, incurredFraction: 1, remainingFraction: 0, midpointMonth: null, midpointHorizon: 0 };
  const uMid = inverseCumulativeSpend((1 + incurred) / 2);
  // never before the anchor: u_mid ≥ u_anchor, and rounding cannot cross an integer
  const offset = Math.max(Math.round(uMid * duration), Math.max(0, elapsed));
  const midpointMonth = addMonths(start.month, offset);
  return { ...base, midpointMonth, midpointHorizon: Math.max(0, monthDiff(anchor, midpointMonth)) };
}

/** Cost carried under the S-curve: the incurred share stays at its
 *  escalated-to-date value, the remaining share compounds at `annualizedPct`
 *  from the anchor to the remaining spend's midpoint. */
export function sCurveCost(toDate: number, schedule: SpendSchedule, annualizedPct: number): number {
  if (!schedule.midpointMonth || schedule.remainingFraction <= 0) return toDate;
  const factor = Math.pow(1 + annualizedPct / 100, schedule.midpointHorizon / 12);
  return toDate * (schedule.incurredFraction + schedule.remainingFraction * factor);
}
