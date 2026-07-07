import json
from pathlib import Path

from pipeline.models import Observation
from pipeline.publish import official as official_pub
from pipeline.publish import validate
from pipeline.registry import load_registry
from pipeline.store import vintage

SCHEMAS = Path(__file__).parent.parent / "schemas"


def seed_full_from(store_dir, series):
    """Minimal 14-month histories for the given series list so build() succeeds."""
    obs = []
    months = [f"2025-{m:02d}-01" for m in range(4, 13)] + \
             [f"2026-{m:02d}-01" for m in range(1, 6)]
    for s in series:
        if s.code == "fmp_wti":
            # single observation: no YoY base -> yoy_pct must be None
            obs += [Observation(s.code, "2026-06-29", 71.85, "2026-07-07", s.source, "API")]
        elif s.code in ("fmp_gold", "fiscal_debt_total", "pmms_30yr", "eia_gasreg_w"):
            obs += [Observation(s.code, "2025-06-20", 100.0, "2026-07-07", s.source, "API"),
                    Observation(s.code, "2026-06-29", 110.0, "2026-07-07", s.source, "API")]
        else:
            slope = 1 + (sum(s.code.encode()) % 7)  # deterministic, distinct YoY per series
            obs += [Observation(s.code, m, 200.0 + i * slope, "2026-07-07", s.source, "API")
                    for i, m in enumerate(months)]
    vintage.append(obs, store_dir)
    return vintage.load(store_dir)


def seed_full(tmp_path):
    """Minimal 14-month histories for every registry series so build() succeeds."""
    return seed_full_from(tmp_path, load_registry()[1])


def test_build_and_write_validates(tmp_path):
    conn = seed_full(tmp_path)
    _, series = load_registry()
    payload = official_pub.build(conn, series)
    assert len(payload["components"]) == 14
    yoys = [c["yoy_pct"] for c in payload["components"]]
    assert yoys == sorted(yoys, reverse=True) and len(set(yoys)) > 1
    assert len(payload["quotes"]) == 13
    groups = {q["group"] for q in payload["quotes"]}
    assert groups == {"grocery", "energy", "rates", "markets", "fiscal"}
    q = {q["code"]: q for q in payload["quotes"]}
    assert q["fmp_gold"]["yoy_pct"] == 10.0  # 110/100 - 1
    assert q["fmp_wti"]["yoy_pct"] is None  # single obs: no YoY base
    assert payload["headline"]["cpi"]["month"] == "2026-05-01"
    path = official_pub.write(payload, tmp_path / "out", "2026-07-07T12:00:00Z")
    validate.validate_file(path, SCHEMAS / "official.schema.json")
    data = json.loads(path.read_text())
    assert data["published_at"] == "2026-07-07T12:00:00Z"


def test_build_skips_quote_series_with_no_rows(tmp_path):
    _, series = load_registry()
    # simulate a series that never collected: seed a store WITHOUT bananas,
    # then build against the full registry — the zero-row code must be
    # skipped, not raise
    series_no_bananas = [s for s in series if s.code != "APU0000711211"]
    store2 = tmp_path / "s2"
    conn2 = seed_full_from(store2, series_no_bananas)
    payload = official_pub.build(conn2, series)  # full registry, thin store
    codes = {q["code"] for q in payload["quotes"]}
    assert "APU0000711211" not in codes
    assert len(payload["quotes"]) == 12  # skipped, not raised
