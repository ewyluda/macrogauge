"""AI/data-center news tape (2026-10-06): the Mac-side live exporter
(scripts/news/caktus_ai_news.py) and the daily `news` phase that bakes its
public R2 object into news.json."""
import importlib.util
import json
import sqlite3
from datetime import datetime, timezone
from pathlib import Path

import jsonschema
import pytest

from pipeline.publish import news, validate

ROOT = Path(__file__).parent.parent
SCHEMAS = ROOT / "schemas"
FIXTURE = ROOT / "tests" / "fixtures" / "ai_news_feed.json"
NOW = datetime(2026, 10, 7, 3, 5, tzinfo=timezone.utc)

_spec = importlib.util.spec_from_file_location(
    "caktus_ai_news", ROOT / "scripts" / "news" / "caktus_ai_news.py")
exporter = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(exporter)


def _cfg(**over):
    cfg = news.load_config()
    return {**cfg, **over}


# ---------------------------------------------------------------- exporter


def _caktus(posts, tags):
    con = sqlite3.connect(":memory:")
    con.executescript("""
        CREATE TABLE posts (id TEXT PRIMARY KEY, ts TEXT NOT NULL, kind TEXT NOT NULL,
            text TEXT, media_path TEXT, category TEXT, published_at TEXT, post_url TEXT,
            duplicate_of TEXT);
        CREATE TABLE tags (post_id TEXT, ticker TEXT, relation TEXT, source TEXT);
    """)
    con.executemany("INSERT INTO posts (id, ts, published_at, kind, category, text, post_url, "
                    "media_path, duplicate_of) VALUES (?,?,?,?,?,?,?,?,?)", posts)
    con.executemany("INSERT INTO tags VALUES (?,?,?,'llm')", tags)
    return con


def test_exporter_keeps_universe_mentions_in_included_categories_only():
    rich = ("*$NVDA Nvidia agreed to supply chips.*\n\n"
            "• *Deal size:* About $40B, per the *FT*.\n• Plain bullet with no label")
    con = _caktus(
        posts=[
            ("a", "2026-10-06T22:00:00.500Z", "2026-10-06T21:59:58.000Z", "image", "company",
             rich, "https://whatsapp.com/channel/x/1", "/m/a.jpg", None),
            ("flow", "2026-10-06T21:00:00Z", None, "image", "flow",
             "$NVDA 240P 6/17/2027 for $33M", "https://w/2", None, None),
            ("macro", "2026-10-06T20:00:00Z", None, "text", "macro",
             "CPI hotter than expected", None, None, None),
            ("dup", "2026-10-06T19:00:00Z", None, "text", "company",
             "NVIDIA DUP HEADLINE", None, None, "a"),
            ("old", "2026-09-01T19:00:00Z", None, "text", "company", "ancient", None, None, None),
            ("offuniverse", "2026-10-06T18:00:00Z", None, "text", "company",
             "TTWO GTA news", None, None, None),
            ("impactonly", "2026-10-06T17:00:00Z", None, "text", "company",
             "AWS raises GPU prices", None, None, None),
            ("earn", "2026-10-06T16:00:00Z", None, "text", "earnings",
             "MRVL beats", "javascript:alert(1)", None, None),
        ],
        tags=[("a", "NVDA", "mentioned"), ("a", "NVDA", "impacted"), ("a", "AVGO", "impacted"),
              ("a", "GEO:CHINA", "mentioned"), ("flow", "NVDA", "mentioned"),
              ("macro", "MACRO:CPI", "mentioned"), ("macro", "NVDA", "mentioned"),
              ("dup", "NVDA", "mentioned"), ("old", "NVDA", "mentioned"),
              ("offuniverse", "TTWO", "mentioned"), ("impactonly", "CRWV", "impacted"),
              ("earn", "MRVL", "mentioned")])
    feed = exporter.build_feed(con, _cfg(), NOW)
    assert feed["schema"] == news.FEED_SCHEMA
    assert [p["id"] for p in feed["posts"]] == ["a", "earn"]   # newest first
    a, earn = feed["posts"]
    assert a["ts"] == "2026-10-06T21:59:58Z"                   # channel time, not observed
    assert a["headline"] == "$NVDA Nvidia agreed to supply chips."
    assert a["points"] == [{"label": "Deal size", "text": "About $40B, per the FT."},
                           {"label": None, "text": "Plain bullet with no label"}]
    assert a["tickers"] == [{"ticker": "NVDA", "layer": "AI Compute"}]   # GEO:* never a chip
    assert a["impacted"] == ["AVGO"]                           # NVDA already mentioned
    assert a["has_media"] is True and a["url"] == "https://whatsapp.com/channel/x/1"
    assert earn["url"] is None                                 # non-https link dropped
    assert feed["source"]["tape_last_post_at"] == "2026-10-06T21:59:58Z"


def test_split_post_handles_bare_headlines_and_unicode_noise():
    assert exporter.split_post("SPACEX SAID TO SEEK $40BN - FT") == ("SPACEX SAID TO SEEK $40BN - FT", [])
    head, pts = exporter.split_post("*Lead​ line*\n\n- *A:* 𝟑𝟑𝐌 calls")
    assert head == "Lead line" and pts == [{"label": "A", "text": "33M calls"}]
    assert exporter.split_post("   \n ") == (None, [])


def test_sigv4_matches_the_aws_s3_get_object_example():
    """AWS's published S3 SigV4 header-auth example (GET /test.txt, Range 0-9)."""
    hdrs = exporter.sigv4_headers(
        "GET", "examplebucket.s3.amazonaws.com", "/test.txt", {"Range": "bytes=0-9"}, b"",
        "AKIAIOSFODNN7EXAMPLE", "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY",
        datetime(2013, 5, 24, tzinfo=timezone.utc), region="us-east-1")
    assert hdrs["authorization"] == (
        "AWS4-HMAC-SHA256 Credential=AKIAIOSFODNN7EXAMPLE/20130524/us-east-1/s3/aws4_request, "
        "SignedHeaders=host;range;x-amz-content-sha256;x-amz-date, "
        "Signature=f0e8bdb87c964420e857bd35b5d6ed310bd44f0170aba48dd91039c6036bdb41")


# ---------------------------------------------------------------- publish phase


class _Resp:
    def __init__(self, obj):
        self._obj = obj

    def raise_for_status(self):
        pass

    def json(self):
        return self._obj


def test_config_universe_layers_are_declared():
    cfg = news.load_config()
    assert cfg["live_url"] is None or cfg["live_url"].startswith("https://")
    assert {r["layer"] for r in cfg["universe"].values()} <= set(cfg["layers"])
    assert "flow" not in cfg["include_categories"] and "macro" not in cfg["include_categories"]


def test_unconfigured_publishes_an_empty_valid_tape(tmp_path):
    path = news.write(news.build(_cfg(live_url=None), None, NOW), tmp_path, "2026-10-07")
    validate.validate_file(path, SCHEMAS / "news.schema.json")
    out = json.loads(path.read_text())
    assert out["status"] == "unconfigured" and out["posts"] == []


def test_recorded_feed_bakes_to_a_valid_live_artifact(tmp_path):
    feed = news.fetch("https://x.example/ai-news.json",
                      lambda url, timeout: _Resp(json.loads(FIXTURE.read_text())))
    out = news.build(_cfg(live_url="https://x.example/ai-news.json"), feed, NOW)
    path = news.write(out, tmp_path, "2026-10-07")
    validate.validate_file(path, SCHEMAS / "news.schema.json")
    assert out["status"] == "live" and out["age_hours"] == pytest.approx(0.03, abs=0.01)
    assert [p["ts"] for p in out["posts"]] == sorted((p["ts"] for p in out["posts"]), reverse=True)
    assert {t["ticker"] for t in out["posts"][0]["tickers"]} == {"AVGO", "NVDA"}
    assert out["dropped"] == 0


def test_untrusted_posts_are_refiltered_not_trusted():
    good = json.loads(FIXTURE.read_text())["posts"][1]
    feed = {"schema": news.FEED_SCHEMA, "generated_at": "2026-10-07T03:00:00Z", "posts": [
        good,
        {**good, "id": "flow1", "category": "flow"},                       # excluded category
        {**good, "id": "x2", "tickers": [{"ticker": "TTWO", "layer": "AI Compute"}]},
        {**good, "id": "x3", "tickers": [{"ticker": "NVDA", "layer": "Made Up"}]},
        {**good, "id": "x4", "ts": "2026-08-01T00:00:00Z"},                # outside window
        {**good, "id": "x5", "headline": "  "},
        {**good, "id": "x6", "url": "http://insecure"},
        good,                                                              # duplicate id
        "not a post",
    ]}
    out = news.build(_cfg(), feed, NOW)
    assert [p["id"] for p in out["posts"]] == [good["id"], "x3", "x6"]
    assert out["posts"][1]["tickers"] == [{"ticker": "NVDA", "layer": "AI Compute"}]  # config layer
    assert out["posts"][2]["url"] is None
    assert out["dropped"] == 6


def test_stale_and_future_feeds():
    feed = {"schema": news.FEED_SCHEMA, "generated_at": "2026-10-05T00:00:00Z", "posts": []}
    assert news.build(_cfg(), feed, NOW)["status"] == "stale"
    with pytest.raises(ValueError, match="future"):
        news.build(_cfg(), {**feed, "generated_at": "2026-10-08T00:00:00Z"}, NOW)


def test_wrong_shaped_object_is_structure_drift_not_a_schema_failure():
    with pytest.raises(ValueError, match="structure drift"):
        news.fetch("https://x", lambda url, timeout: _Resp({"posts": "nope"}))
    with pytest.raises(ValueError, match="structure drift"):
        news.fetch("https://x", lambda url, timeout: _Resp(["not", "a", "feed"]))


def test_schema_rejects_a_flow_post():
    out = news.build(_cfg(), json.loads(FIXTURE.read_text()), NOW)
    out = {"published_at": "x", **out}
    out["posts"][0]["category"] = "flow"
    with pytest.raises(jsonschema.ValidationError):
        jsonschema.validate(out, json.loads((SCHEMAS / "news.schema.json").read_text()))
