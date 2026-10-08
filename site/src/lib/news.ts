import type { NewsArtifact } from "./generated";

/** The AI/data-center news tape (/news + the /datacenter strip).
 *
 *  The page renders the baked `news.json` (the daily pipeline's copy of the
 *  live feed), then — in the browser — fetches the live object at
 *  `live_url` (written every few minutes by scripts/news/caktus_ai_news.py)
 *  and swaps it in when it is newer. The live object is untrusted input that
 *  never went through the pipeline's schema validation, so parseLiveFeed
 *  re-checks every field the UI reads and drops anything malformed. */

export type NewsPost = NewsArtifact["posts"][number];
export type FeedView = {
  posts: NewsPost[];
  generatedAt: string | null;
  tapeLastPostAt: string | null;
  origin: "live" | "snapshot";
};

export const FEED_SCHEMA = "macrogauge.ai_news.v1";
const CATEGORIES = new Set(["company", "earnings", "other"]);
const KINDS = new Set(["text", "image", "video"]);
const ISO_Z = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/;
/** How far ahead of the reader's clock a feed (and a post, of its feed) may
 *  be dated: the producer's FUTURE_SLACK (pipeline/publish/news.py). */
export const FUTURE_SLACK_MS = 3_600_000;

/** A real UTC instant in the feed's second-precision form: the pattern alone
 *  passes "2026-99-99T12:00:00Z" (which later throws in Intl formatting) and
 *  "2026-02-30T12:00:00Z" (which Date silently rolls into March). */
function isInstant(s: string): boolean {
  if (!ISO_Z.test(s)) return false;
  const ms = Date.parse(s);
  return !Number.isNaN(ms) && new Date(ms).toISOString() === `${s.slice(0, -1)}.000Z`;
}

export function snapshotView(a: NewsArtifact): FeedView {
  return { posts: a.posts, generatedAt: a.feed_generated_at, tapeLastPostAt: a.tape_last_post_at, origin: "snapshot" };
}

const str = (v: unknown): v is string => typeof v === "string" && v.trim().length > 0;

function parsePost(raw: unknown, layers: Set<string>, latestMs: number): NewsPost | null {
  if (!raw || typeof raw !== "object") return null;
  const p = raw as Record<string, unknown>;
  if (!str(p.id) || !str(p.ts) || !isInstant(p.ts) || Date.parse(p.ts) > latestMs || !str(p.headline)) return null;
  if (typeof p.category !== "string" || !CATEGORIES.has(p.category)) return null;
  const tickers = Array.isArray(p.tickers)
    ? p.tickers.filter(
        (t): t is { ticker: string; layer: string } =>
          !!t && typeof t === "object" && str((t as { ticker?: unknown }).ticker) &&
          layers.has((t as { layer?: unknown }).layer as string),
      ).map((t) => ({ ticker: t.ticker, layer: t.layer }))
    : [];
  if (tickers.length === 0) return null;
  const points = Array.isArray(p.points)
    ? p.points
        .filter((x): x is { label: unknown; text: string } => !!x && typeof x === "object" && str((x as { text?: unknown }).text))
        .slice(0, 6)
        .map((x) => ({ label: str(x.label) ? x.label : null, text: x.text }))
    : [];
  return {
    id: p.id,
    ts: p.ts,
    category: p.category as NewsPost["category"],
    kind: (typeof p.kind === "string" && KINDS.has(p.kind) ? p.kind : "text") as NewsPost["kind"],
    headline: p.headline,
    points,
    tickers,
    impacted: Array.isArray(p.impacted) ? p.impacted.filter(str) : [],
    url: str(p.url) && p.url.startsWith("https://") ? p.url : null,
    has_media: p.has_media === true,
  };
}

/** The live R2 object -> a FeedView, or null when it is not a feed at all.
 *  A feed dated more than FUTURE_SLACK_MS past `nowMs` is rejected (the
 *  producer's own rule): accepted, it would outrank every honest feed after
 *  it and read as "Live". Posts dated past the feed's own slack are dropped. */
export function parseLiveFeed(x: unknown, layers: readonly string[], nowMs: number = Date.now()): FeedView | null {
  if (!x || typeof x !== "object") return null;
  const f = x as Record<string, unknown>;
  if (f.schema !== FEED_SCHEMA || !str(f.generated_at) || !Array.isArray(f.posts)) return null;
  const generatedMs = Date.parse(f.generated_at);
  if (Number.isNaN(generatedMs) || generatedMs > nowMs + FUTURE_SLACK_MS) return null;
  const allowed = new Set(layers);
  const seen = new Set<string>();
  const posts: NewsPost[] = [];
  for (const raw of f.posts) {
    const p = parsePost(raw, allowed, generatedMs + FUTURE_SLACK_MS);
    if (p && !seen.has(p.id)) {
      seen.add(p.id);
      posts.push(p);
    }
  }
  posts.sort((a, b) => (a.ts < b.ts ? 1 : a.ts > b.ts ? -1 : 0));
  const src = f.source as Record<string, unknown> | undefined;
  return {
    posts,
    generatedAt: f.generated_at,
    tapeLastPostAt: src && str(src.tape_last_post_at) ? src.tape_last_post_at : null,
    origin: "live",
  };
}

/** Live wins only when it is strictly newer than what the page already shows
 *  — or when what it shows is itself dated past the future slack (it can
 *  never be outranked, so it would freeze the page). */
export function pickNewer(current: FeedView, live: FeedView | null, nowMs: number = Date.now()): FeedView {
  if (!live || !live.generatedAt) return current;
  if (!current.generatedAt) return live;
  const cur = Date.parse(current.generatedAt);
  if (Number.isNaN(cur) || cur > nowMs + FUTURE_SLACK_MS) return live;
  return Date.parse(live.generatedAt) > cur ? live : current;
}

export type NewsFilter = { layer: string | null; ticker: string | null };

const ET_DAY = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", weekday: "short", month: "short", day: "numeric" });
const ET_TIME = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", hour: "numeric", minute: "2-digit" });
const ET_KEY = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" });

/** "6:36 PM" in New York — deterministic on server and client (no hydration drift). */
export const etTime = (iso: string) => ET_TIME.format(new Date(iso));
export const etDay = (iso: string) => ET_DAY.format(new Date(iso));
/** "2026-10-07": the New York calendar day of an instant, sortable. */
export const etDayKey = (iso: string) => ET_KEY.format(new Date(iso));

/** Items grouped under the New York calendar day of `ts(item)`, in input
 *  order (newest first in, newest day first out). */
export function groupByEtDay<T>(items: T[], ts: (item: T) => string): { day: string; label: string; items: T[] }[] {
  const out: { day: string; label: string; items: T[] }[] = [];
  for (const it of items) {
    const d = new Date(ts(it));
    const day = ET_KEY.format(d);
    const last = out[out.length - 1];
    if (last && last.day === day) last.items.push(it);
    else out.push({ day, label: ET_DAY.format(d), items: [it] });
  }
  return out;
}

/** "just now" / "12m ago" / "3h ago" / "2d ago". */
export function relTime(iso: string, nowMs: number): string {
  const mins = Math.max(0, Math.round((nowMs - Date.parse(iso)) / 60_000));
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  return hrs < 48 ? `${hrs}h ago` : `${Math.round(hrs / 24)}d ago`;
}
