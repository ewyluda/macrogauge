import { describe, expect, it } from "vitest";
import newsJson from "../../public/data/news.json";
import { artifact } from "./artifact";
import {
  FEED_SCHEMA, FUTURE_SLACK_MS, groupByEtDay, parseLiveFeed, pickNewer, relTime,
  snapshotView, type NewsPost,
} from "./news";

const LAYERS = ["AI Compute", "Power & Grid"];

const post = (over: Partial<NewsPost> = {}): NewsPost => ({
  id: "p1", ts: "2026-10-06T22:36:19Z", category: "company", kind: "image",
  headline: "$NVDA Nvidia wins", points: [{ label: "Deal", text: "Big" }],
  tickers: [{ ticker: "NVDA", layer: "AI Compute" }], impacted: [], url: "https://w/1", has_media: true,
  ...over,
});

describe("parseLiveFeed — the live R2 object is untrusted", () => {
  it("rejects anything that is not a v1 feed", () => {
    expect(parseLiveFeed(null, LAYERS)).toBeNull();
    expect(parseLiveFeed({ schema: "other", generated_at: "2026-10-07T03:00:00Z", posts: [] }, LAYERS)).toBeNull();
    expect(parseLiveFeed({ schema: FEED_SCHEMA, generated_at: "nope", posts: [] }, LAYERS)).toBeNull();
    expect(parseLiveFeed({ schema: FEED_SCHEMA, generated_at: "2026-10-07T03:00:00Z", posts: {} }, LAYERS)).toBeNull();
  });

  it("drops malformed posts, unsafe links and unknown layers; dedupes and sorts newest first", () => {
    const view = parseLiveFeed({
      schema: FEED_SCHEMA,
      generated_at: "2026-10-07T03:00:00Z",
      source: { tape_last_post_at: "2026-10-07T02:59:00Z" },
      posts: [
        post({ id: "old", ts: "2026-10-05T10:00:00Z", url: "javascript:alert(1)" }),
        post({ id: "new" }),
        post({ id: "new" }),
        post({ id: "flow", category: "flow" as NewsPost["category"] }),
        post({ id: "nolayer", tickers: [{ ticker: "NVDA", layer: "Made Up" }] }),
        post({ id: "badts", ts: "yesterday" }),
        { id: "x" },
        "junk",
      ],
    }, LAYERS)!;
    expect(view.origin).toBe("live");
    expect(view.posts.map((p) => p.id)).toEqual(["new", "old"]);
    expect(view.posts[1].url).toBeNull();
    expect(view.tapeLastPostAt).toBe("2026-10-07T02:59:00Z");
  });
});

describe("parseLiveFeed — dates (audit F4, F5)", () => {
  const NOW = Date.parse("2026-10-08T12:00:00Z");
  const feed = (generated_at: string, posts: unknown[] = []) => ({ schema: FEED_SCHEMA, generated_at, posts });

  it("keeps valid posts and drops impossible or normalizing dates, and grouping never throws", () => {
    const view = parseLiveFeed(feed("2026-10-08T12:00:00Z", [
      post({ id: "ok", ts: "2026-10-08T11:00:00Z" }),
      post({ id: "month99", ts: "2026-99-99T12:00:00Z" }),     // passed the pattern, then threw in Intl
      post({ id: "feb30", ts: "2026-02-30T12:00:00Z" }),       // Date would roll it into March
      post({ id: "hour25", ts: "2026-10-08T25:00:00Z" }),
    ]), LAYERS, NOW)!;
    expect(view.posts.map((p) => p.id)).toEqual(["ok"]);
    expect(() => groupByEtDay(view.posts, (p) => p.ts)).not.toThrow();
  });

  it("rejects a feed dated past the producer's one-hour future slack, and posts past the feed's", () => {
    expect(parseLiveFeed(feed("2030-01-01T00:00:00Z"), LAYERS, NOW)).toBeNull();
    expect(parseLiveFeed(feed("2026-10-08T13:30:00Z"), LAYERS, NOW)).toBeNull();
    const skewed = parseLiveFeed(feed("2026-10-08T12:30:00Z", [
      post({ id: "inside", ts: "2026-10-08T13:20:00Z" }),
      post({ id: "beyond", ts: "2026-10-08T13:40:00Z" }),
    ]), LAYERS, NOW)!;
    expect(skewed.generatedAt).toBe("2026-10-08T12:30:00Z");   // 30 min of clock skew is allowed
    expect(skewed.posts.map((p) => p.id)).toEqual(["inside"]);
    expect(FUTURE_SLACK_MS).toBe(3_600_000);                    // = pipeline/publish/news.py FUTURE_SLACK
  });

  it("recovers from a selected feed dated past the slack instead of freezing on it", () => {
    const frozen = { posts: [], generatedAt: "2030-01-01T00:00:00Z", tapeLastPostAt: null, origin: "live" as const };
    const healthy = { ...frozen, generatedAt: "2026-10-08T11:55:00Z" };
    expect(pickNewer(frozen, healthy, NOW)).toBe(healthy);
    // an honest feed a few minutes ahead is still only displaced by a newer one
    const ahead = { ...frozen, generatedAt: "2026-10-08T12:20:00Z" };
    expect(pickNewer(ahead, healthy, NOW)).toBe(ahead);
  });
});

describe("pickNewer", () => {
  const snap = { posts: [], generatedAt: "2026-10-07T03:00:00Z", tapeLastPostAt: null, origin: "snapshot" as const };
  it("swaps in live only when strictly newer", () => {
    const live = { ...snap, origin: "live" as const };
    expect(pickNewer(snap, live).origin).toBe("snapshot");
    expect(pickNewer(snap, { ...live, generatedAt: "2026-10-07T03:05:00Z" }).origin).toBe("live");
    expect(pickNewer(snap, null)).toBe(snap);
    expect(pickNewer({ ...snap, generatedAt: null }, live).origin).toBe("live");
  });
});

describe("grouping and time", () => {
  const posts = [
    post({ id: "a", tickers: [{ ticker: "NVDA", layer: "AI Compute" }, { ticker: "VST", layer: "Power & Grid" }] }),
    post({ id: "b", ts: "2026-10-06T03:00:00Z", tickers: [{ ticker: "VST", layer: "Power & Grid" }] }),
    post({ id: "c", ts: "2026-10-05T15:00:00Z" }),
  ];
  it("groups under New York days (03:00Z is still the previous evening in NY)", () => {
    const g = groupByEtDay(posts, (p) => p.ts);
    expect(g.map((d) => [d.day, d.items.map((p) => p.id)])).toEqual([
      ["2026-10-06", ["a"]],
      ["2026-10-05", ["b", "c"]],
    ]);
  });
  it("formats relative time", () => {
    const now = Date.parse("2026-10-07T03:00:00Z");
    expect(relTime("2026-10-07T02:59:50Z", now)).toBe("just now");
    expect(relTime("2026-10-07T02:48:00Z", now)).toBe("12m ago");
    expect(relTime("2026-10-07T00:00:00Z", now)).toBe("3h ago");
    expect(relTime("2026-10-04T03:00:00Z", now)).toBe("3d ago");
  });
});

describe("the committed news.json", () => {
  it("round-trips through parseLiveFeed unchanged (the baked copy and the live object share one post shape)", () => {
    const a = artifact("news", newsJson);
    const reparsed = parseLiveFeed(
      { schema: FEED_SCHEMA, generated_at: a.feed_generated_at ?? "2026-01-01T00:00:00Z", posts: a.posts },
      a.layers,
    )!;
    expect(reparsed.posts).toEqual(snapshotView(a).posts);
  });
});
