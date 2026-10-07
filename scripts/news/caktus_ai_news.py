#!/usr/bin/env python3
"""Live AI/data-center news exporter: caktus.db -> filtered JSON -> public R2 object.

Runs on the Mac every few minutes (launchd, installed by install_live_exporter.sh),
next to the Kepler caktus Litestream follower. Each run:

  1. takes a STABLE snapshot of the follower (never queries it in place — the
     same stable-copy contract as notebook/scripts/caktus_news.py), falling
     back to a verified Litestream restore from R2;
  2. keeps posts from the last `window_days` that MENTION a ticker in the
     config universe (config/ai_news.json — the notebook's AI-infra taxonomy),
     in an included category (flow / macro / geopolitics are dropped), not
     flagged as a duplicate;
  3. splits each post's WhatsApp markup into a headline + labelled points;
  4. writes the feed JSON locally (--out) and/or PUTs it to the public R2
     bucket (--upload; SigV4, credentials from the macOS Keychain).

The site fetches that object in the browser for the live overlay; the daily
pipeline's `news` phase bakes the same object into site/public/data/news.json.

caktus is a SECONDARY source (one social feed, opinions mixed with headlines);
the site labels it so. Stdlib only — the installed copy runs outside the repo.

    python3 scripts/news/caktus_ai_news.py --config config/ai_news.json --out /tmp/ai-news.json
    python3 scripts/news/caktus_ai_news.py --config ~/.local/share/macrogauge-news/ai_news.json --upload
"""
from __future__ import annotations

import argparse
import hashlib
import hmac
import json
import os
import re
import shutil
import sqlite3
import subprocess
import sys
import tempfile
import time
import unicodedata
import urllib.request
from datetime import datetime, timedelta, timezone

FEED_SCHEMA = "macrogauge.ai_news.v1"
FOLLOWER_DB = os.environ.get(
    "CAKTUS_DB_PATH", os.path.expanduser("~/Library/Application Support/Kepler/caktus.db"))
SNAPSHOT_CMD = os.environ.get(
    "CAKTUS_SNAPSHOT_CMD", os.path.expanduser("~/.local/bin/kepler-caktus-litestream-reader"))
KEYCHAIN_PREFIX = "com.macrogauge.news-r2"
STABLE_SAMPLE_SECONDS = 0.1
STABLE_COPY_ATTEMPTS = 5
MAX_POINTS = 6
MAX_CHARS = 600

# ---------------------------------------------------------------- snapshot


def _verify(path: str) -> None:
    con = sqlite3.connect(f"file:{path}?mode=ro&immutable=1", uri=True)
    try:
        row = con.execute("PRAGMA quick_check").fetchone()
        if not row or row[0] != "ok":
            raise sqlite3.DatabaseError(f"quick_check failed: {row}")
    finally:
        con.close()


def _follower_state(db: str):
    s, t = os.stat(db), os.stat(db + "-txid")
    with open(db + "-txid") as f:
        return s.st_size, s.st_mtime_ns, t.st_size, t.st_mtime_ns, f.read().strip()


def _copy_stable(db: str, dst: str) -> str:
    for _ in range(STABLE_COPY_ATTEMPTS):
        before = _follower_state(db)
        time.sleep(STABLE_SAMPLE_SECONDS)
        if before != _follower_state(db):
            continue
        shutil.copy2(db, dst)
        time.sleep(STABLE_SAMPLE_SECONDS)
        if before == _follower_state(db):
            try:
                _verify(dst)
                return dst
            except sqlite3.DatabaseError:
                pass
        if os.path.exists(dst):
            os.remove(dst)
    raise RuntimeError("follower did not stay stable long enough to snapshot")


def snapshot(tmpdir: str) -> tuple[str, str]:
    """(path, mechanism). Follower copy first, verified R2 restore second."""
    dst = os.path.join(tmpdir, "caktus.db")
    if os.path.isfile(FOLLOWER_DB) and os.path.isfile(FOLLOWER_DB + "-txid"):
        try:
            return _copy_stable(FOLLOWER_DB, dst), "follower"
        except (OSError, RuntimeError, sqlite3.Error) as e:
            print(f"follower snapshot failed ({e}); restoring from R2", file=sys.stderr)
    if not os.access(SNAPSHOT_CMD, os.X_OK):
        raise RuntimeError(f"no follower and no restore command at {SNAPSHOT_CMD}")
    proc = subprocess.run([SNAPSHOT_CMD, "snapshot", dst], capture_output=True, text=True)
    if proc.returncode:
        raise RuntimeError(f"R2 restore failed: {(proc.stderr or proc.stdout).strip()}")
    _verify(dst)
    return dst, "r2"

# ---------------------------------------------------------------- parsing

_BOLD = re.compile(r"(?<![\w*])\*(?=\S)([^*\n]+?)(?<=\S)\*(?![\w*])")
_LABELLED = re.compile(r"^\*([^*\n]{1,60}?):\*\s*(.+)$")
_ZERO_WIDTH = dict.fromkeys(map(ord, "​‌‍⁠﻿"))


def _clean(s: str) -> str:
    return " ".join(unicodedata.normalize("NFKC", s).translate(_ZERO_WIDTH).split())


def _clip(s: str) -> str:
    return s if len(s) <= MAX_CHARS else s[:MAX_CHARS - 1].rstrip() + "…"


def split_post(text: str | None) -> tuple[str | None, list[dict]]:
    """WhatsApp markup -> (headline, [{label, text}]). The first non-empty line
    is the headline; bullet lines become points, `*Label:* text` split out."""
    lines = [ln.strip() for ln in (text or "").splitlines() if ln.strip()]
    if not lines:
        return None, []
    headline = _clip(_clean(_BOLD.sub(r"\1", lines[0])))
    points = []
    for ln in lines[1:]:
        ln = ln.lstrip("•·▪-–— ").strip()
        m = _LABELLED.match(ln)
        label, body = (m.group(1), m.group(2)) if m else (None, ln)
        body = _clean(_BOLD.sub(r"\1", body))
        if body:
            points.append({"label": _clean(label) if label else None, "text": _clip(body)})
        if len(points) == MAX_POINTS:
            break
    return headline or None, points

# ---------------------------------------------------------------- feed


def _iso(dt: datetime) -> str:
    return dt.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def _norm_ts(raw: str) -> str:
    return _iso(datetime.fromisoformat(raw.replace("Z", "+00:00")))


def build_feed(con: sqlite3.Connection, cfg: dict, now: datetime,
               mechanism: str = "follower") -> dict:
    """Pure over an open caktus connection: the feed object the site renders."""
    universe = cfg["universe"]
    cats = cfg["include_categories"]
    since = _iso(now - timedelta(days=cfg["window_days"]))
    tick_q = ",".join("?" * len(universe))
    cat_q = ",".join("?" * len(cats))
    rows = con.execute(
        f"SELECT p.id, COALESCE(p.published_at, p.ts), p.kind, p.category, p.text, "
        f"p.post_url, p.media_path IS NOT NULL FROM posts p "
        f"WHERE COALESCE(p.published_at, p.ts) >= ? AND p.duplicate_of IS NULL "
        f"AND p.category IN ({cat_q}) AND EXISTS (SELECT 1 FROM tags t WHERE "
        f"t.post_id = p.id AND t.relation = 'mentioned' AND t.ticker IN ({tick_q})) "
        f"ORDER BY 2 DESC LIMIT ?",
        [since, *cats, *universe, cfg["max_posts"]]).fetchall()
    tags: dict[str, dict[str, set]] = {}
    if rows:
        id_q = ",".join("?" * len(rows))
        for pid, ticker, rel in con.execute(
                f"SELECT post_id, ticker, relation FROM tags WHERE post_id IN ({id_q})",
                [r[0] for r in rows]):
            if ticker in universe:
                tags.setdefault(pid, {"mentioned": set(), "impacted": set()})[rel].add(ticker)
    posts = []
    for pid, ts, kind, category, text, url, has_media in rows:
        headline, points = split_post(text)
        if not headline:
            continue
        t = tags.get(pid, {"mentioned": set(), "impacted": set()})
        posts.append({
            "id": pid,
            "ts": _norm_ts(ts),
            "category": category,
            "kind": kind,
            "headline": headline,
            "points": points,
            "tickers": [{"ticker": k, "layer": universe[k]["layer"]} for k in sorted(t["mentioned"])],
            "impacted": sorted(t["impacted"] - t["mentioned"]),
            "url": url if url and url.startswith("https://") else None,
            "has_media": bool(has_media),
        })
    last = con.execute("SELECT MAX(COALESCE(published_at, ts)) FROM posts").fetchone()[0]
    return {
        "schema": FEED_SCHEMA,
        "generated_at": _iso(now),
        "source": {"name": "caktus.db (Kepler feed)", "snapshot": mechanism,
                   "tape_last_post_at": _norm_ts(last) if last else None},
        "window_days": cfg["window_days"],
        "universe_size": len(universe),
        "posts": posts,
    }

# ---------------------------------------------------------------- upload (SigV4)


def _hmac(key: bytes, msg: str) -> bytes:
    return hmac.new(key, msg.encode(), hashlib.sha256).digest()


def sigv4_headers(method: str, host: str, path: str, headers: dict, body: bytes,
                  access_key: str, secret_key: str, now: datetime,
                  region: str = "auto", service: str = "s3") -> dict:
    """AWS Signature V4 (header auth) for an S3-compatible request; returns the
    full header set to send. `path` must already be URI-encoded."""
    amz_date = now.strftime("%Y%m%dT%H%M%SZ")
    day = amz_date[:8]
    payload_hash = hashlib.sha256(body).hexdigest()
    hdrs = {k.lower(): str(v).strip() for k, v in headers.items()}
    hdrs.update({"host": host, "x-amz-date": amz_date, "x-amz-content-sha256": payload_hash})
    signed = ";".join(sorted(hdrs))
    canonical = "\n".join([method, path, "",
                           "".join(f"{k}:{hdrs[k]}\n" for k in sorted(hdrs)),
                           signed, payload_hash])
    scope = f"{day}/{region}/{service}/aws4_request"
    to_sign = "\n".join(["AWS4-HMAC-SHA256", amz_date, scope,
                         hashlib.sha256(canonical.encode()).hexdigest()])
    key = _hmac(_hmac(_hmac(_hmac(f"AWS4{secret_key}".encode(), day), region), service),
                "aws4_request")
    sig = hmac.new(key, to_sign.encode(), hashlib.sha256).hexdigest()
    hdrs["authorization"] = (f"AWS4-HMAC-SHA256 Credential={access_key}/{scope}, "
                             f"SignedHeaders={signed}, Signature={sig}")
    return hdrs


def _keychain(service: str) -> str:
    user = os.environ.get("USER") or subprocess.run(
        ["/usr/bin/id", "-un"], capture_output=True, text=True).stdout.strip()
    proc = subprocess.run(["/usr/bin/security", "find-generic-password", "-a", user,
                           "-s", f"{KEYCHAIN_PREFIX}.{service}", "-w"],
                          capture_output=True, text=True)
    if proc.returncode:
        raise RuntimeError(f"Keychain item {KEYCHAIN_PREFIX}.{service} missing — "
                           "run scripts/news/install_live_exporter.sh")
    return proc.stdout.strip()


def upload(feed: dict, bucket: str, key: str, now: datetime) -> None:
    account = _keychain("account-id")
    host = f"{account}.r2.cloudflarestorage.com"
    path = "/" + "/".join(urllib.request.quote(p, safe="") for p in [bucket, *key.split("/")])
    body = json.dumps(feed, ensure_ascii=False, separators=(",", ":")).encode()
    hdrs = sigv4_headers("PUT", host, path,
                         {"content-type": "application/json; charset=utf-8",
                          "cache-control": "public, max-age=60"},
                         body, _keychain("access-key-id"), _keychain("secret-access-key"), now)
    hdrs.pop("host")
    req = urllib.request.Request(f"https://{host}{path}", data=body, method="PUT", headers=hdrs)
    with urllib.request.urlopen(req, timeout=60) as resp:
        if resp.status != 200:
            raise RuntimeError(f"R2 PUT returned HTTP {resp.status}")

# ---------------------------------------------------------------- main


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description="Export the live AI/DC news feed from caktus.db.")
    ap.add_argument("--config", required=True, help="path to ai_news.json")
    ap.add_argument("--out", help="also write the feed JSON here")
    ap.add_argument("--upload", action="store_true", help="PUT the feed to the public R2 bucket")
    ap.add_argument("--bucket", default=os.environ.get("MACROGAUGE_NEWS_BUCKET", "macrogauge-public"))
    ap.add_argument("--key", default=os.environ.get("MACROGAUGE_NEWS_KEY", "ai-news.json"))
    args = ap.parse_args(argv)
    with open(args.config) as f:
        cfg = json.load(f)
    now = datetime.now(timezone.utc)
    tmpdir = tempfile.mkdtemp(prefix="mg_news_")
    try:
        path, mechanism = snapshot(tmpdir)
        con = sqlite3.connect(f"file:{path}?mode=ro&immutable=1", uri=True)
        try:
            feed = build_feed(con, cfg, now, mechanism)
        finally:
            con.close()
    finally:
        shutil.rmtree(tmpdir, ignore_errors=True)
    if args.out:
        tmp = args.out + ".tmp"
        with open(tmp, "w") as f:
            json.dump(feed, f, ensure_ascii=False, indent=1)
        os.replace(tmp, args.out)
    if args.upload:
        upload(feed, args.bucket, args.key, now)
    print(f"{_iso(now)} {len(feed['posts'])} posts via {mechanism}"
          f" (tape last {feed['source']['tape_last_post_at']})"
          + (f" -> r2://{args.bucket}/{args.key}" if args.upload else ""))
    return 0


if __name__ == "__main__":
    sys.exit(main())
