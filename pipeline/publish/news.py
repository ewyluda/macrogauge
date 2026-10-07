"""Writer for news.json — the AI/data-center news tape (/news + the /datacenter
strip), added 2026-10-06.

Posts come from the Kepler caktus.db market-news tape (one WhatsApp channel,
LLM-tagged by ticker), which Litestream replicates to a private R2 bucket. A
browser cannot query that, so scripts/news/caktus_ai_news.py runs on the Mac
next to the follower every few minutes, filters to the config universe (the
notebook's AI-infra taxonomy) and PUTs the result to a public R2 object
(config `live_url`). The site fetches that object client-side for the live
overlay; this phase bakes the same object into news.json once a day so the
page renders without it (static fallback, crawlable, carried in the ledger of
deploys like every other artifact).

The remote object is UNTRUSTED input to a schema-validated artifact — and a
jsonschema.ValidationError fails the whole run — so build() re-derives every
field it publishes: categories and tickers are re-filtered against config,
layers come from config (never the feed), malformed posts are dropped and
counted. A wrong-shaped object raises ValueError ("structure drift?"), which
the phase isolation turns into news_ok = false. live_url null (the bucket not
set up yet) publishes status "unconfigured" with no posts — not a failure.
"""
import json
from datetime import datetime, timedelta, timezone
from pathlib import Path

import requests

from pipeline.publish.util import write_json

CONFIG = Path(__file__).resolve().parents[2] / "config" / "ai_news.json"
FEED_SCHEMA = "macrogauge.ai_news.v1"
MAX_TEXT = 600
MAX_POINTS = 6
FUTURE_SLACK = timedelta(hours=1)


def load_config(path: Path = CONFIG) -> dict:
    cfg = json.loads(Path(path).read_text())
    layers = set(cfg["layers"])
    bad = sorted(t for t, row in cfg["universe"].items() if row["layer"] not in layers)
    if bad:
        raise ValueError(f"ai_news universe tickers with unknown layers: {bad}")
    return cfg


def fetch(url: str, http_get=None) -> dict:
    http_get = http_get or requests.get
    resp = http_get(url, timeout=60)
    resp.raise_for_status()
    feed = resp.json()
    if (not isinstance(feed, dict) or feed.get("schema") != FEED_SCHEMA
            or not isinstance(feed.get("posts"), list)
            or not isinstance(feed.get("generated_at"), str)):
        raise ValueError(f"news feed at {url}: not a {FEED_SCHEMA} object (structure drift?)")
    return feed


def _ts(raw) -> datetime | None:
    if not isinstance(raw, str):
        return None
    try:
        dt = datetime.fromisoformat(raw.replace("Z", "+00:00"))
    except ValueError:
        return None
    return dt.astimezone(timezone.utc) if dt.tzinfo else None


def _iso(dt: datetime) -> str:
    return dt.strftime("%Y-%m-%dT%H:%M:%SZ")


def _text(v, limit=MAX_TEXT) -> str | None:
    if not isinstance(v, str) or not v.strip():
        return None
    v = " ".join(v.split())
    return v if len(v) <= limit else v[:limit - 1].rstrip() + "…"


def _post(raw, cfg: dict, floor: datetime, ceiling: datetime) -> dict | None:
    """One feed post -> a publishable row, or None when it fails any check."""
    if not isinstance(raw, dict):
        return None
    universe = cfg["universe"]
    ts = _ts(raw.get("ts"))
    pid, headline = raw.get("id"), _text(raw.get("headline"))
    if (ts is None or not (floor <= ts <= ceiling) or not isinstance(pid, str) or not pid
            or headline is None or raw.get("category") not in cfg["include_categories"]):
        return None
    tickers = sorted({t.get("ticker") for t in raw.get("tickers") or []
                      if isinstance(t, dict) and t.get("ticker") in universe})
    if not tickers:
        return None
    points = []
    for p in raw.get("points") or []:
        text = _text(p.get("text")) if isinstance(p, dict) else None
        if text:
            points.append({"label": _text(p.get("label"), 60), "text": text})
    url = raw.get("url")
    return {
        "id": pid[:64],
        "ts": _iso(ts),
        "category": raw["category"],
        "kind": raw.get("kind") if raw.get("kind") in ("text", "image", "video") else "text",
        "headline": headline,
        "points": points[:MAX_POINTS],
        "tickers": [{"ticker": t, "layer": universe[t]["layer"]} for t in tickers],
        "impacted": sorted({t for t in raw.get("impacted") or []
                            if isinstance(t, str) and t in universe} - set(tickers)),
        "url": url if isinstance(url, str) and url.startswith("https://") else None,
        "has_media": raw.get("has_media") is True,
    }


def build(cfg: dict, feed: dict | None, now: datetime) -> dict:
    base = {"live_url": cfg["live_url"], "window_days": cfg["window_days"],
            "stale_after_hours": cfg["stale_after_hours"], "layers": cfg["layers"],
            "universe_size": len(cfg["universe"]),
            "source_name": "caktus.db (Kepler feed)"}
    if feed is None:
        return {**base, "status": "unconfigured", "feed_generated_at": None,
                "tape_last_post_at": None, "age_hours": None, "dropped": 0, "posts": []}
    generated = _ts(feed["generated_at"])
    if generated is None:
        raise ValueError(f"news feed: unparsable generated_at {feed['generated_at']!r}")
    if generated > now + FUTURE_SLACK:
        raise ValueError(f"news feed: generated_at {feed['generated_at']} is in the future")
    floor = generated - timedelta(days=cfg["window_days"])
    rows, seen = [], set()
    for raw in feed["posts"]:
        row = _post(raw, cfg, floor, generated + FUTURE_SLACK)
        if row is not None and row["id"] not in seen:
            seen.add(row["id"])
            rows.append(row)
    rows.sort(key=lambda r: r["ts"], reverse=True)
    posts = rows[:cfg["max_posts"]]
    age = (now - generated).total_seconds() / 3600
    tape = _ts((feed.get("source") or {}).get("tape_last_post_at"))
    return {**base,
            "status": "live" if age <= cfg["stale_after_hours"] else "stale",
            "feed_generated_at": _iso(generated),
            "tape_last_post_at": _iso(tape) if tape else None,
            "age_hours": round(max(age, 0.0), 2),
            "dropped": len(feed["posts"]) - len(posts),
            "posts": posts}


def write(payload: dict, out_dir: Path, published_at: str) -> Path:
    return write_json({"published_at": published_at, **payload}, out_dir, "news.json")
