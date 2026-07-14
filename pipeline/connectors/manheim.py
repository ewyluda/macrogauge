"""Manheim Used Vehicle Value Index — Cox Automotive Insights feed + post scrape.

Wholesale leads retail: the engine reads this series shifted +30 days
(config/basket.json used_vehicles.lead_days), per spec §5. One observation
per run — the latest published report (Cox posts a mid-month update, then
the full-month figure); monthly cadence accepted.

Re-point (2026-07-13): the previous scrape target,
site.manheim.com/en/services/consulting/used-vehicle-value-index.html, froze
at the Mid-December 2025 report (verified live 2026-07-13: page still serves
"Mid-December 2025 Trends" / 206.0) while Cox kept publishing elsewhere — the
scrape stayed green for 7 months, silently re-fetching the same stale value
into carry-forward. The live channel is the Cox Automotive Insights hub: the
WordPress feed at coxautoinc.com/insights/feed/ lists ~50 posts newest-first,
and the monthly report is the item titled "Manheim Used Vehicle Value Index:
(Mid-)<Month> <Year> Trends" (no filtered per-series feed exists — the
insight_series query param is ignored on the feed endpoint). Title anchoring
matters: the same feed carries other MUVVI-titled items ("Replay Available:
... Index Call", quarterly commentary) that must not be selected. Feed bodies
are excerpt-only — no index value — so a second GET fetches the linked post.

Post-page traps (all recorded live 2026-07-13, pinned in fixtures): the
report heading appears many times in <head> (title tag, og:title, JSON-LD),
and on some months the JSON-LD description ALSO carries a full "(MUVVI)
increased to <value>" sentence with a stale boilerplate value — 209.2 on
every one of the Feb–May 2026 posts while the real values ranged 209.9–215.3.
A <title>-anchored forward scan latches onto that decoy. The parse therefore
anchors on the post body's single <h1> heading (after <head>) and reads
forward to the first "(MUVVI) <verb> to <value>" clause. Some posts encode
that clause's spaces as &nbsp; entities (March 2026 does), so entities are
normalized before matching. The prose also carries several other in-range
NNN.N values (prior-month figures, chart callouts) — a value-only scan would
latch onto the wrong one; the heading→clause anchor is load-bearing.
Recorded at re-point time: value 212.9, reference month June 2026 — pinned
into tests/fixtures/manheim_feed.xml + manheim_post.html (+ the trap-carrying
manheim_post_march.html) and tests/test_manheim.py."""
import re
from datetime import datetime

import requests

from pipeline.connectors.fred import today_et
from pipeline.connectors.util import get_text
from pipeline.models import Observation

FEED_URL = "https://www.coxautoinc.com/insights/feed/"
ITEM_RE = re.compile(r"<item>(.*?)</item>", re.DOTALL)
# Item-scoped title match keeps channel-level <title> and excerpt text out.
FEED_TITLE_RE = re.compile(
    r"<title>\s*Manheim Used Vehicle Value Index:\s*(?:Mid-)?\w+\s+\d{4}\s+Trends\s*</title>")
LINK_RE = re.compile(r"<link>\s*(\S+?)\s*</link>")
# Anchored on the body's <h1> — NOT the <title> tag — to stay clear of the
# <head> JSON-LD decoy; see module docstring.
INDEX_RE = re.compile(
    r"<h1[^>]*>\s*Manheim\s+Used Vehicle Value Index:\s*(?:Mid-)?(\w+)\s+(\d{4})\s+Trends\s*</h1>"
    r".*?\(MUVVI\)\s+(?:increased|decreased|rose|fell|climbed|declined|dropped)"
    r"\s+to\s+(\d{3}\.\d)",
    re.DOTALL,
)
PLAUSIBLE = (100.0, 350.0)  # index points (base Jan 1997 = 100) — outside this, structure drift


def parse_post(html: str) -> tuple[str, float]:
    """Extract (obs_date, value) from a UVVI trends post page.

    Shared with scripts/backfill_manheim.py so the backfill inherits the
    same anchor and traps coverage. Raises ValueError on drift.
    """
    m = INDEX_RE.search(html.replace("&nbsp;", " ").replace("\xa0", " "))
    if not m:
        raise ValueError("Cox UVVI post: value not found (structure drift?)")
    month_name, year, value_str = m.groups()
    value = float(value_str)
    if not (PLAUSIBLE[0] <= value <= PLAUSIBLE[1]):
        raise ValueError(f"Manheim UVVI {value} implausible (range {PLAUSIBLE}) — "
                         f"structure drift?")
    month = datetime.strptime(f"{month_name} {year}", "%B %Y")
    return month.strftime("%Y-%m-01"), value


def fetch(vintage_date: str | None = None, http_get=None) -> list[Observation]:
    http_get = http_get or requests.get
    vintage = vintage_date or today_et()
    feed = get_text(FEED_URL, http_get)
    post_url = None
    for item in ITEM_RE.finditer(feed):
        if FEED_TITLE_RE.search(item.group(1)):
            link = LINK_RE.search(item.group(1))
            if link:
                post_url = link.group(1)
            break  # items are newest-first; first title match is the latest report
    if not post_url:
        raise ValueError("Cox insights feed: UVVI trends post not found (structure drift?)")
    obs_date, value = parse_post(get_text(post_url, http_get))
    return [Observation(series_code="manheim_uvvi_m",
                        obs_date=obs_date, value=value,
                        vintage_date=vintage, source="MANHEIM", route="SCRAPE")]
