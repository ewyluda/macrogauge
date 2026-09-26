import Link from "next/link";
import pulse from "../../public/data/pulse.json";
import { fmtDay } from "@/lib/format";
import { staleness } from "@/lib/stale";

/** Compact build-time banner for a page whose artifact(s) did not refresh on
 *  the latest publish (its pipeline phase failed and the previous file was
 *  kept). Pass every artifact the page renders; the oldest one decides.
 *  Renders nothing when the page is current. */
export function StaleBanner({
  publishedAt,
  latest = pulse.published_at,
}: {
  publishedAt: string | null | undefined | (string | null | undefined)[];
  /** reference publish — pulse.json's, written by every run */
  latest?: string;
}) {
  const s = staleness(Array.isArray(publishedAt) ? publishedAt : [publishedAt], latest);
  if (!s) return null;
  return (
    <div className="stale-banner" role="status" data-testid="stale-banner">
      <span className="stale-banner-tag">Stale</span>
      <span>
        Showing data from the {fmtDay(s.shownFrom.slice(0, 10))} publish — the {fmtDay(s.latest.slice(0, 10))} refresh
        of this section failed. See <Link href="/status">status</Link>.
      </span>
    </div>
  );
}
