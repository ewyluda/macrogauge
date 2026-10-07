"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import type { NewsArtifact } from "@/lib/generated";
import {
  etDay, etTime, groupByEtDay, parseLiveFeed, pickNewer, relTime, snapshotView, type FeedView, type NewsFilter, type NewsPost,
} from "@/lib/news";
import {
  clusterStories, storyLayerCounts, storyMatches, storyTickerCounts, topFigures, type Story,
} from "@/lib/newsTape";
import { useUrlState } from "@/lib/useUrlState";
import { codecs } from "@/lib/urlState";

const POLL_MS = 120_000;
const TOP_TICKERS = 14;
const PAGE = 40;
const MODES = ["infra", "all"] as const;

/** Polls the live R2 object while the tab is visible. Automated browsers
 *  (navigator.webdriver — Playwright) stay on the baked snapshot so e2e
 *  never depends on the network or the bucket's CORS policy. */
function useLiveFeed(snapshot: NewsArtifact): [FeedView, number | null] {
  const [view, setView] = useState<FeedView>(() => snapshotView(snapshot));
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    setNow(Date.now());
    const url = snapshot.live_url;
    if (!url || navigator.webdriver) return;
    let ctrl: AbortController | null = null;
    // Mount always pulls once (a tab opened in the background still gets the
    // live tape); the interval and tab-refocus pulls only run while visible.
    const pull = async (force = false) => {
      if (!force && document.visibilityState !== "visible") return;
      ctrl?.abort();
      ctrl = new AbortController();
      try {
        const res = await fetch(url, { cache: "no-store", signal: ctrl.signal });
        if (!res.ok) return;
        const live = parseLiveFeed(await res.json(), snapshot.layers);
        setView((cur) => pickNewer(cur, live));
      } catch {
        // offline / CORS / aborted: keep showing what we have
      } finally {
        setNow(Date.now());
      }
    };
    const onVisible = () => void pull();
    void pull(true);
    const id = window.setInterval(onVisible, POLL_MS);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.clearInterval(id);
      document.removeEventListener("visibilitychange", onVisible);
      ctrl?.abort();
    };
  }, [snapshot.live_url, snapshot.layers]);
  return [view, now];
}

function FeedStatus({ view, now, snapshot }: { view: FeedView; now: number | null; snapshot: NewsArtifact }) {
  if (!view.generatedAt) {
    return <span className="badge badge-muted">Tape not connected</span>;
  }
  const ageH = now == null ? null : (now - Date.parse(view.generatedAt)) / 3_600_000;
  const live = view.origin === "live" && ageH != null && ageH <= 1;
  const stale = ageH != null && ageH > snapshot.stale_after_hours;
  return (
    <span className="news-status">
      <span className={`news-dot ${live ? "news-dot-live" : stale ? "news-dot-stale" : ""}`} aria-hidden="true" />
      <strong>{live ? "Live" : view.origin === "live" ? "Live (delayed)" : "Daily snapshot"}</strong>
      <span className="subtitle">
        {" "}· feed built {etDay(view.generatedAt)} {etTime(view.generatedAt)} ET
        {now != null && ` (${relTime(view.generatedAt, now)})`}
        {view.tapeLastPostAt && now != null && ` · newest tape post ${relTime(view.tapeLastPostAt, now)}`}
      </span>
      {stale && <span className="badge">stale</span>}
    </span>
  );
}

function Tags({ p, onTicker, active }: { p: NewsPost; onTicker?: (t: string) => void; active: string | null }) {
  return (
    <>
      {p.tickers.map((t) =>
        onTicker ? (
          <button key={t.ticker} type="button" className="news-chip" aria-pressed={active === t.ticker}
                  title={t.layer} onClick={() => onTicker(t.ticker)}>{t.ticker}</button>
        ) : (
          <span key={t.ticker} className="news-chip" title={t.layer}>{t.ticker}</span>
        ),
      )}
    </>
  );
}

const Source = ({ p }: { p: NewsPost }) =>
  p.url ? <a className="news-src" href={p.url} target="_blank" rel="noopener noreferrer nofollow">source ↗</a> : null;

/** One story: its lead headline, tags and source; the lead's bullet points
 *  and the repeats of the same story open on demand. */
function StoryItem({ s, compact, onTicker, active }: {
  s: Story; compact: boolean; onTicker?: (t: string) => void; active: string | null;
}) {
  const p = s.lead;
  const hasDetail = p.points.length > 0 || p.impacted.length > 0;
  return (
    <li className="news-item" data-testid="news-item">
      <div className="news-meta">
        <time dateTime={s.latest}>{etTime(s.latest)}</time>
        {p.category === "earnings" && <span className="badge">earnings</span>}
      </div>
      <div className="news-body">
        <p className="news-headline">{p.headline}</p>
        <div className="news-tags">
          <Tags p={p} onTicker={onTicker} active={active} />
          {compact && s.also.length > 0 && <span className="subtitle news-also-n">+{s.also.length} more on this story</span>}
          <Source p={p} />
        </div>
        {!compact && hasDetail && (
          <details className="news-more">
            <summary>Details</summary>
            {p.points.length > 0 && (
              <ul className="news-points">
                {p.points.map((pt, i) => (
                  <li key={i}>{pt.label && <strong>{pt.label}: </strong>}{pt.text}</li>
                ))}
              </ul>
            )}
            {p.impacted.length > 0 && (
              <p className="subtitle news-impacted">Also read-through: {p.impacted.join(", ")}</p>
            )}
          </details>
        )}
        {!compact && s.also.length > 0 && (
          <details className="news-more" data-testid="news-also">
            <summary>{s.also.length} more {s.also.length === 1 ? "post" : "posts"} on this story</summary>
            <ol className="news-also">
              {s.also.map((a) => (
                <li key={a.id}>
                  <time dateTime={a.ts}>{etDay(a.ts)} {etTime(a.ts)}</time> {a.headline} <Source p={a} />
                </li>
              ))}
            </ol>
          </details>
        )}
      </div>
    </li>
  );
}

/** The week's largest stated capacity and deal-dollar figures, one per story. */
function BigNumbers({ stories }: { stories: Story[] }) {
  const cols = [
    { kind: "capacity" as const, title: "Capacity" },
    { kind: "dollars" as const, title: "Deal dollars" },
  ].map((c) => ({ ...c, rows: topFigures(stories, c.kind, 4) })).filter((c) => c.rows.length > 0);
  if (!cols.length) return null;
  return (
    <section className="news-numbers" aria-labelledby="news-numbers-title" data-testid="news-numbers">
      <h2 id="news-numbers-title">Biggest numbers on the tape this week</h2>
      <div className="news-numbers-grid">
        {cols.map((c) => (
          <div key={c.kind}>
            <h3>{c.title}</h3>
            <ol>
              {c.rows.map(({ story, figure }) => (
                <li key={story.lead.id}>
                  <span className="news-figure">{figure.label}</span>
                  <span className="news-numbers-headline">{story.lead.headline}</span>
                  <span className="subtitle">{etDay(story.latest)}</span>
                </li>
              ))}
            </ol>
          </div>
        ))}
      </div>
      <p className="subtitle">As stated in each post&apos;s headline; forecasts and revenue targets are left out. Unverified.</p>
    </section>
  );
}

/** Full tape (/news) or the compact latest-N strip (/datacenter). */
export function NewsFeed({ snapshot, compact = false, limit }: { snapshot: NewsArtifact; compact?: boolean; limit?: number }) {
  const [view, now] = useLiveFeed(snapshot);
  const [mode, setMode] = useUrlState<(typeof MODES)[number]>("tape", "infra", codecs.enumOf(MODES));
  const [filter, setFilter] = useState<NewsFilter>({ layer: null, ticker: null });
  const [pages, setPages] = useState(1);
  const stories = useMemo(() => clusterStories(view.posts), [view.posts]);
  const infraStories = useMemo(() => stories.filter((s) => s.infra), [stories]);
  const pool = compact || mode === "infra" ? infraStories : stories;
  const matched = useMemo(() => pool.filter((s) => storyMatches(s, filter)), [pool, filter]);
  const shown = limit ? matched.slice(0, limit) : matched.slice(0, PAGE * pages);
  const layers = useMemo(() => storyLayerCounts(pool, snapshot.layers), [pool, snapshot.layers]);
  const tickers = useMemo(() => storyTickerCounts(pool.filter((s) => storyMatches(s, { ...filter, ticker: null }))).slice(0, TOP_TICKERS),
    [pool, filter]);
  const toggleTicker = (t: string) => setFilter((f) => ({ ...f, ticker: f.ticker === t ? null : t }));
  const pick = (f: NewsFilter) => { setFilter(f); setPages(1); };

  if (compact) {
    return (
      <div className="table-card news-strip" data-testid="news-strip">
        <div className="news-strip-head">
          <span className="badge">AI infra tape</span>
          <FeedStatus view={view} now={now} snapshot={snapshot} />
          <Link href="/news">All AI-infra news →</Link>
        </div>
        {shown.length === 0 ? (
          <p className="subtitle news-empty">No AI-infra stories on the tape yet.</p>
        ) : (
          <ol className="news-list">
            {shown.map((s) => <StoryItem key={s.lead.id} s={s} compact active={null} />)}
          </ol>
        )}
      </div>
    );
  }

  const hiddenPosts = view.posts.length - infraStories.reduce((n, s) => n + 1 + s.also.length, 0);
  return (
    <div data-testid="news-feed">
      <div className="news-toolbar">
        <FeedStatus view={view} now={now} snapshot={snapshot} />
        <div className="news-modes" role="group" aria-label="Which posts to show">
          <button type="button" className="news-chip" aria-pressed={mode === "infra"}
                  onClick={() => { setMode("infra"); pick({ layer: null, ticker: null }); }}>
            AI-infra stories · {infraStories.length}
          </button>
          <button type="button" className="news-chip" aria-pressed={mode === "all"}
                  onClick={() => { setMode("all"); pick({ layer: null, ticker: null }); }}>
            Everything · {stories.length}
          </button>
        </div>
      </div>
      {mode === "infra" && view.posts.length > 0 && (
        <p className="subtitle news-mode-note" data-testid="news-mode-note">
          {view.posts.length} posts on the tape, folded into {stories.length} stories. Showing the {infraStories.length} about
          the build-out: capacity, power, chips, memory and the money behind them. {hiddenPosts} posts on apps, consumer
          products, analyst calls and market color are under Everything.
        </p>
      )}
      {mode === "infra" && !filter.layer && !filter.ticker && <BigNumbers stories={infraStories} />}
      {layers.length > 0 && (
        <div className="news-filters" role="group" aria-label="Filter by AI-infra layer">
          <button type="button" className="news-chip" aria-pressed={filter.layer === null}
                  onClick={() => pick({ layer: null, ticker: null })}>All · {pool.length}</button>
          {layers.map(([l, n]) => (
            <button key={l} type="button" className="news-chip" aria-pressed={filter.layer === l}
                    onClick={() => pick({ layer: filter.layer === l ? null : l, ticker: null })}>{l} · {n}</button>
          ))}
        </div>
      )}
      {tickers.length > 0 && (
        <div className="news-filters" role="group" aria-label="Filter by ticker">
          <span className="subtitle news-filter-label">Most mentioned</span>
          {tickers.map(([t, n]) => (
            <button key={t} type="button" className="news-chip" aria-pressed={filter.ticker === t}
                    onClick={() => toggleTicker(t)}>{t} <span className="news-chip-n">{n}</span></button>
          ))}
          {filter.ticker && !tickers.some(([t]) => t === filter.ticker) && (
            <button type="button" className="news-chip" aria-pressed onClick={() => toggleTicker(filter.ticker!)}>{filter.ticker} ×</button>
          )}
        </div>
      )}
      {view.posts.length === 0 ? (
        <p className="subtitle news-empty">
          {snapshot.status === "unconfigured"
            ? "The live tape is not connected yet — posts appear here once the exporter publishes its first feed."
            : `No AI-infra posts on the tape in the last ${snapshot.window_days} days.`}
        </p>
      ) : shown.length === 0 ? (
        <p className="subtitle news-empty">No stories match these filters.</p>
      ) : (
        <>
          {groupByEtDay(shown, (s) => s.latest).map((g) => (
            <section key={g.day} className="news-day" aria-label={g.label}>
              <h3 className="news-day-head">{g.label} <span className="subtitle">· {g.items.length}</span></h3>
              <ol className="news-list">
                {g.items.map((s) => (
                  <StoryItem key={s.lead.id} s={s} compact={false} onTicker={toggleTicker} active={filter.ticker} />
                ))}
              </ol>
            </section>
          ))}
          {matched.length > shown.length && (
            <button type="button" className="tool-btn news-older" onClick={() => setPages((n) => n + 1)}>
              Show {Math.min(PAGE, matched.length - shown.length)} older stories ({matched.length - shown.length} left)
            </button>
          )}
        </>
      )}
    </div>
  );
}
