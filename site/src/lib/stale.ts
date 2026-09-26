/** Stale-phase detection. run_daily publishes every artifact of one run
 *  with the same `published_at`, and each phase runs in its own try/except:
 *  a failed phase leaves YESTERDAY's file in place while the rest of the site
 *  moves on. A page whose artifact is older than pulse.json (the headline
 *  every run writes) is therefore showing a section whose refresh failed. */
export type Staleness = { shownFrom: string; latest: string };

/** The oldest of `publishedAt` when it predates `latest`, else null.
 *  Unparseable or missing stamps never raise a banner. */
export function staleness(publishedAt: (string | null | undefined)[], latest: string): Staleness | null {
  const latestMs = Date.parse(latest);
  if (Number.isNaN(latestMs)) return null;
  let oldest: string | null = null;
  for (const p of publishedAt) {
    if (!p || Number.isNaN(Date.parse(p))) continue;
    if (oldest == null || Date.parse(p) < Date.parse(oldest)) oldest = p;
  }
  if (oldest == null || Date.parse(oldest) >= latestMs) return null;
  return { shownFrom: oldest, latest };
}
