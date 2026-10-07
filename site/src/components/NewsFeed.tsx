"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import type { NewsArtifact } from "@/lib/generated";
import {
  etDay, etTime, filterPosts, groupByEtDay, layerCounts, parseLiveFeed, pickNewer, relTime,
  snapshotView, tickerCounts, type FeedView, type NewsFilter, type NewsPost,
} from "@/lib/news";

const POLL_MS = 120_000;
const TOP_TICKERS = 14;

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

function PostItem({ p, compact, onTicker, active }: {
  p: NewsPost; compact: boolean; onTicker?: (t: string) => void; active: string | null;
}) {
  return (
    <li className="news-item" data-testid="news-item">
      <div className="news-meta">
        <time dateTime={p.ts}>{etTime(p.ts)}</time>
        {p.category === "earnings" && <span className="badge">earnings</span>}
      </div>
      <div className="news-body">
        <p className="news-headline">{p.headline}</p>
        {!compact && p.points.length > 0 && (
          <ul className="news-points">
            {p.points.map((pt, i) => (
              <li key={i}>{pt.label && <strong>{pt.label}: </strong>}{pt.text}</li>
            ))}
          </ul>
        )}
        <div className="news-tags">
          {p.tickers.map((t) =>
            onTicker ? (
              <button key={t.ticker} type="button" className="news-chip" aria-pressed={active === t.ticker}
                      title={t.layer} onClick={() => onTicker(t.ticker)}>{t.ticker}</button>
            ) : (
              <span key={t.ticker} className="news-chip" title={t.layer}>{t.ticker}</span>
            ),
          )}
          {!compact && p.impacted.length > 0 && (
            <span className="subtitle news-impacted">also read-through: {p.impacted.join(", ")}</span>
          )}
          {p.url && (
            <a className="news-src" href={p.url} target="_blank" rel="noopener noreferrer nofollow">source ↗</a>
          )}
        </div>
      </div>
    </li>
  );
}

/** Full tape (/news) or the compact latest-N strip (/datacenter). */
export function NewsFeed({ snapshot, compact = false, limit }: { snapshot: NewsArtifact; compact?: boolean; limit?: number }) {
  const [view, now] = useLiveFeed(snapshot);
  const [filter, setFilter] = useState<NewsFilter>({ layer: null, ticker: null });
  const shown = useMemo(() => {
    const f = filterPosts(view.posts, filter);
    return limit ? f.slice(0, limit) : f;
  }, [view.posts, filter, limit]);
  const layers = useMemo(() => layerCounts(view.posts, snapshot.layers), [view.posts, snapshot.layers]);
  const tickers = useMemo(() => tickerCounts(filterPosts(view.posts, { ...filter, ticker: null })).slice(0, TOP_TICKERS),
    [view.posts, filter]);
  const toggleTicker = (t: string) => setFilter((f) => ({ ...f, ticker: f.ticker === t ? null : t }));

  if (compact) {
    return (
      <div className="table-card news-strip" data-testid="news-strip">
        <div className="news-strip-head">
          <span className="badge">AI infra tape</span>
          <FeedStatus view={view} now={now} snapshot={snapshot} />
          <Link href="/news">All AI-infra news →</Link>
        </div>
        {shown.length === 0 ? (
          <p className="subtitle news-empty">No posts on the tape yet.</p>
        ) : (
          <ol className="news-list">
            {shown.map((p) => <PostItem key={p.id} p={p} compact active={null} />)}
          </ol>
        )}
      </div>
    );
  }

  return (
    <div data-testid="news-feed">
      <div className="news-toolbar">
        <FeedStatus view={view} now={now} snapshot={snapshot} />
      </div>
      {layers.length > 0 && (
        <div className="news-filters" role="group" aria-label="Filter by AI-infra layer">
          <button type="button" className="news-chip" aria-pressed={filter.layer === null}
                  onClick={() => setFilter({ layer: null, ticker: null })}>All · {view.posts.length}</button>
          {layers.map(([l, n]) => (
            <button key={l} type="button" className="news-chip" aria-pressed={filter.layer === l}
                    onClick={() => setFilter({ layer: filter.layer === l ? null : l, ticker: null })}>{l} · {n}</button>
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
        <p className="subtitle news-empty">No posts match these filters.</p>
      ) : (
        groupByEtDay(shown).map((g) => (
          <section key={g.day} className="news-day" aria-label={g.label}>
            <h3 className="news-day-head">{g.label} <span className="subtitle">· {g.posts.length}</span></h3>
            <ol className="news-list">
              {g.posts.map((p) => (
                <PostItem key={p.id} p={p} compact={false} onTicker={toggleTicker} active={filter.ticker} />
              ))}
            </ol>
          </section>
        ))
      )}
    </div>
  );
}
