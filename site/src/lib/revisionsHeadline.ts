import type { RevisionLevelSummary } from "./types";

/** /revisions' title takeaway: which way first payroll prints have been
 *  revised. A bias under a fifth of the average revision reads as no lean. */
export function payrollTakeaway(s: RevisionLevelSummary): string | null {
  const size = s.mean_abs_change_revision_k;
  const bias = s.mean_revision;
  if (size == null || bias == null || s.n === 0) return null;
  const k = (v: number) => `${Math.round(Math.abs(v))}k`;
  const over = `over the last ${s.n} months`;
  if (Math.abs(bias) < 0.2 * size)
    return `First payroll prints move by ${k(size)} a month on average once revised, with no lean either way, ${over}.`;
  return bias < 0
    ? `First payroll prints have overstated job growth by ${k(bias)} a month on average ${over}; the typical revision is ${k(size)}.`
    : `First payroll prints have understated job growth by ${k(bias)} a month on average ${over}; the typical revision is ${k(size)}.`;
}
