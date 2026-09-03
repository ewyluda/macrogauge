import pulse from "../../../public/data/pulse.json";
import official from "../../../public/data/official.json";
import dc from "../../../public/data/datacenter.json";
import { SITE_DESCRIPTION } from "@/lib/nav";
import { SITE_URL } from "@/lib/site";
import { fmtPct, fmtPp, fmtSigned } from "@/lib/format";
import { sinceYesterdayText } from "@/components/SinceYesterday";

export const dynamic = "force-static";

const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** RSS of the daily publish. The static export carries one item — the
 *  latest publish — with a guid equal to its timestamp, so a reader that
 *  polls sees exactly one new entry per deploy. Batch 4e's "since yesterday"
 *  diff will become the item body. */
export function GET() {
  const stamp = pulse.published_at;
  const date = new Date(stamp).toUTCString();
  const title = `Macrogauge ${fmtPct(pulse.gauge.yoy_pct)} vs official CPI ${fmtPct(pulse.official.yoy_pct)} — ${stamp.slice(0, 10)}`;
  const movers = official.components
    .filter((c) => c.mom_pct != null)
    .slice()
    .sort((a, b) => Math.abs(b.mom_pct ?? 0) - Math.abs(a.mom_pct ?? 0))
    .slice(0, 5)
    .map((c) => `${c.label} ${fmtSigned(c.mom_pct)} MoM`)
    .join(" · ");
  const body = [
    `Macrogauge (CPI-comparable) ${fmtPct(pulse.gauge.yoy_pct)} YoY as of ${pulse.gauge.as_of}, ${fmtPp(pulse.gap_pp)} vs the official ${fmtPct(pulse.official.yoy_pct)} print (${pulse.official.month.slice(0, 7)}).`,
    `CPI-Tracker ${fmtPct(pulse.tracker.yoy_pct)} (${fmtPp(pulse.tracker_gap_pp)} gap). Live basket coverage ${pulse.gauge.coverage_pct.toFixed(0)}%.`,
    `DC Build ${fmtSigned(dc.indexes.build.headline_yoy_pct)} · DC Ops ${fmtSigned(dc.indexes.ops.headline_yoy_pct)} · DC Hardware ${fmtSigned(dc.indexes.hardware.headline_yoy_pct)} YoY.`,
    `Since the previous publish: ${sinceYesterdayText()}`,
    movers ? `Top official movers: ${movers}.` : "",
    `Next CPI print ${pulse.next_print.date} (reference ${pulse.next_print.reference_month}).`,
  ].filter(Boolean).join(" ");

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>MacroGauge — daily US inflation &amp; macro</title>
    <link>${SITE_URL}/</link>
    <atom:link href="${SITE_URL}/feed.xml" rel="self" type="application/rss+xml"/>
    <description>${esc(SITE_DESCRIPTION)}</description>
    <language>en-us</language>
    <lastBuildDate>${date}</lastBuildDate>
    <item>
      <title>${esc(title)}</title>
      <link>${SITE_URL}/</link>
      <guid isPermaLink="false">${esc(stamp)}</guid>
      <pubDate>${date}</pubDate>
      <description>${esc(body)}</description>
    </item>
  </channel>
</rss>
`;
  return new Response(xml, {
    headers: { "Content-Type": "application/rss+xml; charset=utf-8" },
  });
}
