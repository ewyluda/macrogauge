import json
from pathlib import Path

from pipeline.models import Observation
from pipeline.publish import official as official_pub
from pipeline.publish import validate
from pipeline.registry import load_registry
from pipeline.store import vintage

SCHEMAS = Path(__file__).parent.parent / "schemas"


def seed_full(tmp_path):
    """Minimal 13-month histories for every registry series so build() succeeds."""
    _, series = load_registry()
    obs = []
    months = [f"2025-{m:02d}-01" for m in range(4, 13)] + \
             [f"2026-{m:02d}-01" for m in range(1, 6)]
    for s in series:
        if s.code in ("fmp_gold", "fmp_wti", "fiscal_debt_total",
                      "pmms_30yr", "eia_gasreg_w"):
            obs += [Observation(s.code, "2025-06-20", 100.0, "2026-07-07", s.source, "API"),
                    Observation(s.code, "2026-06-29", 110.0, "2026-07-07", s.source, "API")]
        else:
            obs += [Observation(s.code, m, 200.0 + i, "2026-07-07", s.source, "API")
                    for i, m in enumerate(months)]
    vintage.append(obs, tmp_path)
    return vintage.load(tmp_path)


def test_build_and_write_validates(tmp_path):
    conn = seed_full(tmp_path)
    _, series = load_registry()
    payload = official_pub.build(conn, series)
    assert len(payload["components"]) == 14
    assert len(payload["quotes"]) == 13
    groups = {q["group"] for q in payload["quotes"]}
    assert groups == {"grocery", "energy", "rates", "markets", "fiscal"}
    q = {q["code"]: q for q in payload["quotes"]}
    assert q["fmp_gold"]["yoy_pct"] == 10.0  # 110/100 - 1
    assert payload["headline"]["cpi"]["month"] == "2026-05-01"
    path = official_pub.write(payload, tmp_path / "out", "2026-07-07T12:00:00Z")
    validate.validate_file(path, SCHEMAS / "official.schema.json")
    data = json.loads(path.read_text())
    assert data["published_at"] == "2026-07-07T12:00:00Z"
