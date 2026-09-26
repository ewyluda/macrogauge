import pulse from "../../../public/data/pulse.json";
import official from "../../../public/data/official.json";
import dc from "../../../public/data/datacenter.json";
import ledger from "../../../public/data/ledger.json";
import { SITE_DESCRIPTION } from "@/lib/nav";
import { SITE_URL } from "@/lib/site";
import { fmtPct, fmtPp, fmtSigned } from "@/lib/format";
import { sinceYesterdayText } from "@/components/SinceYesterday";

export const dynamic = "force-static";

const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** RSS of the daily publish: the latest publish in full (since-yesterday
 *  diff, movers, next print) plus the previous 19 publishes from the
 *  append-only ledger, so a reader subscribing today — or one that missed
 *  days — gets history, not a single item. guid = each publish's timestamp. */
type LedgerRow = { published_at: string; date: string; gauge_yoy_pct: number | null;
  official_yoy_pct: number | null; official_month: string | null; tracker_yoy_pct: number | null;
  dc_build_yoy_pct?: number | null };
const HISTORY_ITEMS = 19;
const pct = (v: number | null) => (v == null ? "—" : fmtPct(v));
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
    // next_print is null once the release calendar has no future CPI entry
    // (schema allows it); this route runs at build time, so a bare
    // dereference would fail the whole static export.
    pulse.next_print
      ? `Next CPI print ${pulse.next_print.date} (reference ${pulse.next_print.reference_month}).`
      : "Next CPI print: date not yet scheduled.",
  ].filter(Boolean).join(" ");

  const history = (ledger.rows as LedgerRow[])
    .filter((r) => r.published_at !== stamp)
    .slice(-HISTORY_ITEMS)
    .reverse()
    .map((r) => {
      const t = `Macrogauge ${pct(r.gauge_yoy_pct)} vs official CPI ${pct(r.official_yoy_pct)} — ${r.date}`;
      const d = `Macrogauge ${pct(r.gauge_yoy_pct)} YoY; official ${pct(r.official_yoy_pct)} (${(r.official_month ?? "").slice(0, 7)}); `
        + `CPI-Tracker ${pct(r.tracker_yoy_pct)}`
        + (r.dc_build_yoy_pct != null ? `; DC Build ${fmtSigned(r.dc_build_yoy_pct)} YoY.` : ".")
        + ` Readings as published that day (append-only ledger).`;
      return `    <item>
      <title>${esc(t)}</title>
      <link>${SITE_URL}/as-of?date=${esc(r.date)}</link>
      <guid isPermaLink="false">${esc(r.published_at)}</guid>
      <pubDate>${new Date(r.published_at).toUTCString()}</pubDate>
      <description>${esc(d)}</description>
    </item>`;
    })
    .join("\n");

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
${history}
  </channel>
</rss>
`;
  return new Response(xml, {
    headers: { "Content-Type": "application/rss+xml; charset=utf-8" },
  });
}
