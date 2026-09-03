"""Writer for revisions.json — first print vs latest value, per reference
period, for the three graded targets (batch 5b, 2026-09-03).

The vintage store keeps every release of CPIAUCNS / PCEPI / PAYEMS (the
daily collect appends a new vintage row whenever a value changes, and the
ALFRED backfills seeded history), so this is a pure store read:
first_releases() gives the first stored value and its vintage date,
latest() the current value. Revisions are reported as a level change
(percent for the two price indexes, thousands of jobs for payrolls) and as
the YoY / MoM the reader actually quotes — first-print YoY uses the first
value over the LATEST base (the base was already revised by the time the
print landed; this isolates the print's own revision). The scoreboard
grades against FIRST prints; this page shows how far those first prints
later moved. No vintage rows -> empty target block, never a crash.
"""
from pathlib import Path

from pipeline.dates import months_back, prior_month
from pipeline.publish.util import write_json
from pipeline.store import vintage

TARGETS = [("cpi", "CPIAUCNS", "index"), ("pce", "PCEPI", "index"), ("nfp", "PAYEMS", "level_k")]
WINDOW = 36


def _count_vintages(conn, code) -> dict[str, int]:
    rows = conn.execute("SELECT obs_date, COUNT(DISTINCT vintage_date) FROM observations "
                        "WHERE series_code = ? GROUP BY obs_date", (code,)).fetchall()
    return {d: n for d, n in rows}


def _rows(conn, code, kind):
    first = {d: (v, rel) for d, v, rel in vintage.first_releases(conn, code)}
    latest = dict(vintage.latest(conn, code))
    n_v = _count_vintages(conn, code)
    latest_vintage = {}
    for d, vd in conn.execute("SELECT obs_date, MAX(vintage_date) FROM observations "
                              "WHERE series_code = ? GROUP BY obs_date", (code,)).fetchall():
        latest_vintage[d] = vd
    out = []
    for d in sorted(first)[-WINDOW:]:
        f, released = first[d]
        cur = latest.get(d)
        if cur is None:
            continue
        base = latest.get(months_back(d, 12))
        prev = latest.get(prior_month(d))
        row = {"reference_period": d[:7], "first_value": round(f, 3), "first_release_date": released,
               "latest_value": round(cur, 3), "latest_vintage": latest_vintage.get(d),
               "n_vintages": n_v.get(d, 1)}
        if kind == "index":
            row["revision_pct"] = round((cur / f - 1) * 100, 3) if f else None
            row["yoy_first_pct"] = round((f / base - 1) * 100, 2) if base else None
            row["yoy_latest_pct"] = round((cur / base - 1) * 100, 2) if base else None
            row["yoy_revision_pp"] = (round(row["yoy_latest_pct"] - row["yoy_first_pct"], 2)
                                      if base else None)
        else:
            row["revision_k"] = round(cur - f, 1)
            row["change_first_k"] = round(f - prev, 1) if prev is not None else None
            row["change_latest_k"] = round(cur - prev, 1) if prev is not None else None
            row["change_revision_k"] = (round(row["change_latest_k"] - row["change_first_k"], 1)
                                        if prev is not None else None)
        out.append(row)
    return out


def _summary(rows, kind):
    if kind == "index":
        vals = [r["yoy_revision_pp"] for r in rows if r.get("yoy_revision_pp") is not None]
        key = "mean_abs_yoy_revision_pp"
    else:
        vals = [r["change_revision_k"] for r in rows if r.get("change_revision_k") is not None]
        key = "mean_abs_change_revision_k"
    revised = sum(1 for r in rows if r["n_vintages"] > 1)
    return {"n": len(rows), "n_revised": revised,
            key: round(sum(abs(v) for v in vals) / len(vals), 3) if vals else None,
            "mean_revision": round(sum(vals) / len(vals), 3) if vals else None}


def build(conn) -> dict:
    targets = {}
    for key, code, kind in TARGETS:
        rows = _rows(conn, code, kind)
        targets[key] = {"code": code, "kind": kind, "rows": rows, "summary": _summary(rows, kind)}
    return {"window": WINDOW, "targets": targets}


def write(payload: dict, out_dir: Path, published_at: str) -> Path:
    return write_json({"published_at": published_at, **payload}, out_dir, "revisions.json")
