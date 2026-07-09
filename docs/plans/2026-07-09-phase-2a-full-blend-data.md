# Phase 2a — Full-Blend Data Layer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every one of the 14 basket components rides its spec'd source (6 new connectors), the
gauge publishes five variants, and quilt + grocery artifacts land — published files 9 → 13.

**Architecture:** Same one-way flow (collect → store → engine → publish → validate). New
connectors follow the existing injected-HTTP pattern with per-source failure isolation. All
engine changes stay inside the five pure stages; new variant behavior is config, not code. The
Manheim +30d shift and the USDA compositing both ride existing mechanisms (a date-shift view at
blend time; multi-source `live_blend` weights).

**Tech Stack:** Python 3.12 (stdlib + requests + jsonschema — no new deps; scrapes parse with
tight regex + plausible-range checks), pytest, Next.js static export (site changes are minor).

**Spec:** `docs/superpowers/specs/2026-07-09-phase-2a-full-blend-data-design.md`

## Global Constraints

- **TDD with verbatim evidence:** every task captures RED and GREEN pytest output via
  `pytest ... 2>&1 | tee /tmp/phase2a-tN-<red|green>.txt` — reviewers run forensic checks and
  independently re-run suites. Reconstructed output is a firing offense (three prior incidents).
- **No network in tests, ever.** Connectors take `http_get`/`http_post`; tests pass fakes
  returning fixture files from `tests/fixtures/`.
- **Store rows are immutable** — never rewrite a committed partition; new `Observation` fields
  may be added, never renamed/removed/retyped. The Manheim lead shift must NOT store shifted
  dates.
- **run_daily ordering is load-bearing:** `sources_status` publishes first;
  `jsonschema.ValidationError` re-raises (fails the run) before the generic engine-isolation
  `except`; `load_basket()` stays inside the try block. Pinned by existing tests — do not move.
- **Connector failure isolation is a hard invariant:** a broken source records `SourceResult.error`
  (sanitized — errors are published), lowers freshness, never blocks the run.
- **Basket weights and pce_weights must each sum to 1.0** (validated on load).
- **Schema bumps that touch committed data** regenerate `site/public/data/*.json` from the
  committed store in the same task (1c Task-3 precedent; reviewer reproduces byte-for-byte).
- **`git push` = production deploy** — only the controller pushes, with the user's explicit
  approval. Subagents never push and never edit `.superpowers/sdd/progress.md`.
- **Rebase over daily bot commits** (`data: daily publish <date>`) before any push; store JSONL
  conflicts resolve by union.
- Base month 2018-01; grid start 2017-01 internally; writers publish from 2018-01.
- Commit messages end with `Co-Authored-By:` per the session's configured trailer.

## File Map

| File | Status | Responsibility |
|---|---|---|
| `pipeline/engine/gauge.py` | modify | expose per-component own-YoY daily series (ours + official); per-variant weights/subset; CoL payment override |
| `pipeline/engine/variants.py` | modify | `VARIANTS` 2→5; `build_component` takes explicit `live_blend` |
| `pipeline/engine/blend.py` | modify | add `shift_days()` (lead-days view) |
| `pipeline/engine/payment.py` | create | CoL marginal-buyer payment index (pure) |
| `pipeline/basket.py` | modify | `pce_weight`, `lead_days`, `supercore_components` |
| `config/basket.json` | modify | pce weights, supercore list, fuel/used_vehicles/food_home blends, col/pce live_variants |
| `config/series.json` | modify | +6 sources, +~25 series |
| `pipeline/connectors/{aptlist,redfin,aaa,mnd,manheim,usda}.py` | create | one module per source |
| `pipeline/connectors/fmp.py` | modify | `fetch_history()` for the backfill |
| `scripts/backfill_fmp.py` | create | one-time history pull → store |
| `pipeline/collect.py` | modify | FETCHERS entries for the 6 new sources |
| `pipeline/publish/replay.py` | modify | own-YoY arrays |
| `pipeline/publish/methodology.py` | modify | live_active annotation; 5 variant descriptions |
| `pipeline/publish/compare.py` | modify | per-variant grading references (CPI/core/PCE) |
| `pipeline/publish/gaptable.py` | modify | variant summary block (5 cuts) |
| `pipeline/publish/quilt.py` | create | `quilt_months_{24,48,all}.json` |
| `pipeline/publish/grocery.py` | create | `grocery_basket.json` |
| `pipeline/publish/qa.py` | modify | fuel divergence + quilt/grocery checks; coverage floor |
| `pipeline/run_daily.py` | modify | wire quilt + grocery + new QA inputs |
| `schemas/{replay,compare,gauge_daily,gaptable,methodology}.schema.json` | modify | new fields/variants |
| `schemas/{quilt,grocery_basket}.schema.json` | create | new artifacts |
| `site/src/components/Treemap.tsx` | modify | read own-YoY arrays; drop final-frame caveat |
| `site/src/app/methodology/page.tsx` | modify | phase-in annotation, lead_lag chip, 5 variants |
| `tests/test_{aptlist,redfin,aaa,mnd,manheim,usda,payment,quilt,grocery}.py` | create | per-module suites |

Baseline: 135 tests passing at plan time. Each task states its expected count delta.

---

### Task 1: replay.json own-observation YoY + Treemap consumption

The treemap's YoY and vs-BLS modes compute naive 365-day level ratios client-side; for lagging
components between prints this misstates YoY (nat_gas showed ~−30 vs +9.36 published). The
engine already computes honest own-observation YoY (`own_yoy` in `gauge.run`) — expose it,
ship it in `replay.json`, and make the treemap read it. The final-frame footer caveat comes out.

**Files:**
- Modify: `pipeline/engine/gauge.py` (components dict, ~line 89)
- Modify: `pipeline/publish/replay.py`
- Modify: `schemas/replay.schema.json`
- Modify: `site/src/components/Treemap.tsx`
- Test: `tests/test_gauge.py`, `tests/test_replay.py`
- Regenerate: `site/public/data/replay.json` (committed-data contract)

**Interfaces:**
- Consumes: `gauge.run()` internals — `own_yoy[code]` (daily dict `{date: float|None}`) already
  computed at gauge.py:73-78; `official_daily` per component.
- Produces: `gauge.run()` components gain `"own_yoy_daily": dict[str, float|None]` and
  `"official_own_yoy_daily": dict[str, float|None]`. `replay.build()` components gain
  `"yoy": list[float|None]` and `"bls_yoy": list[float|None]` (rounded 2dp, aligned to `dates`).
  Task 13 (quilt) and Task 12 rely on `own_yoy_daily` existing on every variant's components.

- [ ] **Step 1: Write the failing engine test** — append to `tests/test_gauge.py`:

```python
def test_components_carry_own_yoy_daily(realish_store_conn=None):
    """Every component exposes its own-obs YoY (ours and official) as daily
    forward-filled series covering the grid end."""
    conn = _store_with_two_years()  # existing helper in this file; if named
    # differently, use the same fixture-store builder the sawtooth tests use.
    result = gauge.run(conn, today="2026-07-01")
    g = result["variants"]["gauge"]
    for code, entry in g["components"].items():
        assert "own_yoy_daily" in entry, code
        assert "official_own_yoy_daily" in entry, code
        end = g["as_of"]
        assert end in entry["own_yoy_daily"], code
        assert end in entry["official_own_yoy_daily"], code
```

Adapt the store-builder call to this file's existing fixture helper (the sawtooth tests from 1c
Task 2 build a two-year store; reuse exactly that helper — do not write a new one).

- [ ] **Step 2: Run to verify it fails**

Run: `pytest tests/test_gauge.py::test_components_carry_own_yoy_daily -v 2>&1 | tee /tmp/phase2a-t1-red.txt`
Expected: FAIL with `KeyError: 'own_yoy_daily'` or AssertionError on the `in` check.

- [ ] **Step 3: Expose both series in `gauge.py`**

In `gauge.run()`, the `own_yoy` dict is built before the components loop. Add the official
equivalent right after it (official series are monthly, so their own-obs dates are the official
observation dates):

```python
        official_own_yoy = {}
        for code, off_idx in official_rebased.items():
            filled = aggregate.yoy(official_daily[code])
            at_obs = {d: filled[d] for d in off_idx if d in filled}
            official_own_yoy[code] = aggregate.fill_yoy(at_obs, GRID_START, end)
```

and extend the per-component dict:

```python
            components[c.code] = {
                "weight": c.weight, "mode": modes[c.code],
                "yoy_pct": own_yoy[c.code].get(own_end),
                "end_value": daily[c.code][end],  # end_value stays at grid end; QA uses it
                "daily_index": daily[c.code],
                "official_daily_index": official_daily[c.code],
                "own_yoy_daily": own_yoy[c.code],
                "official_own_yoy_daily": official_own_yoy[c.code]}
```

- [ ] **Step 4: Run engine test to verify it passes**

Run: `pytest tests/test_gauge.py -v 2>&1 | tee /tmp/phase2a-t1-green-engine.txt`
Expected: all pass, including the new test.

- [ ] **Step 5: Write the failing writer test** — append to `tests/test_replay.py`:

```python
def test_replay_carries_own_yoy_arrays():
    result = _fake_gauge_result()  # this file's existing builder for replay tests
    payload = replay.build(result, _fake_comps())
    for comp in payload["components"]:
        assert len(comp["yoy"]) == len(payload["dates"])
        assert len(comp["bls_yoy"]) == len(payload["dates"])
    # a date where own_yoy is None must publish null, not a level ratio
```

Extend this file's fake gauge-result builder so components include `own_yoy_daily` /
`official_own_yoy_daily` dicts with at least one `None` value, and assert that `None` survives
into the array (`assert None in payload["components"][0]["yoy"]` when the fake contains one).

- [ ] **Step 6: Run to verify it fails**

Run: `pytest tests/test_replay.py -v 2>&1 | tee /tmp/phase2a-t1-red-writer.txt`
Expected: new test FAILS with KeyError `'yoy'`.

- [ ] **Step 7: Extend `replay.build()`**

```python
        components.append({
            "code": comp.code, "label": comp.label, "weight": comp.weight,
            "mode": e["mode"],
            "index": [round(e["daily_index"][d], 2) for d in dates],
            "bls_index": [round(e["official_daily_index"][d], 2)
                          for d in dates],
            "yoy": [None if e["own_yoy_daily"].get(d) is None
                    else round(e["own_yoy_daily"][d], 2) for d in dates],
            "bls_yoy": [None if e["official_own_yoy_daily"].get(d) is None
                        else round(e["official_own_yoy_daily"][d], 2)
                        for d in dates]})
```

- [ ] **Step 8: Extend `schemas/replay.schema.json`** — in the component item definition, add
alongside `index`/`bls_index` (mirror their structure exactly, but items are nullable):

```json
"yoy": {"type": "array", "items": {"type": ["number", "null"]}},
"bls_yoy": {"type": "array", "items": {"type": ["number", "null"]}}
```

and add both to the component's `required` list.

- [ ] **Step 9: Run pipeline suite**

Run: `pytest -q 2>&1 | tee /tmp/phase2a-t1-green-pipeline.txt`
Expected: 137 passed (135 + 2 new), 0 failed. `tests/test_published_data.py` will FAIL against
the committed `replay.json` until Step 10 — if it does, proceed to Step 10 then re-run.

- [ ] **Step 10: Regenerate committed replay.json from the committed store**

```bash
FRED_API_KEY=dummy python - <<'EOF'
from pathlib import Path
from datetime import datetime, timezone
from pipeline.store import vintage
from pipeline.engine import gauge
from pipeline import basket as basket_mod
from pipeline.publish import replay, validate
conn = vintage.load(Path("store"))
from pipeline.connectors.fred import today_et
result = gauge.run(conn, today=today_et())
_, comps = basket_mod.load_basket()
published_at = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
p = replay.write(replay.build(result, comps), Path("site/public/data"), published_at=published_at)
validate.validate_file(p, Path("schemas/replay.schema.json"))
print("regenerated:", p)
EOF
pytest -q 2>&1 | tee /tmp/phase2a-t1-green-full.txt
```

Expected: 137 passed, 0 skipped. Verify `git diff --stat site/public/data/` touches ONLY
replay.json.

- [ ] **Step 11: Update `site/src/components/Treemap.tsx`**

(a) Extend the `Replay` type's component entry:

```ts
    index: number[];
    bls_index: number[];
    yoy: (number | null)[];
    bls_yoy: (number | null)[];
```

(b) In `modeValue`, the `yoy` and `vs_bls` cases read published arrays instead of level ratios
(other modes are short-window transforms and stay as-is):

```ts
    case "yoy":
      return c.yoy[i];
    case "vs_bls": {
      const a = c.yoy[i];
      const b = c.bls_yoy[i];
      return a === null || b === null ? null : a - b;
    }
```

(c) The footer headline sums now use the same arrays. Replace the `oursHeadline`/`blsHeadline`
computations with:

```ts
  const oursHeadline =
    mode === "yoy" && values.every((x) => x.v !== null)
      ? values.reduce((s, x) => s + x.c.weight * (x.v as number), 0)
      : null;
  const blsHeadline =
    mode === "yoy" && data.components.every((c) => c.bls_yoy[frame.i] !== null)
      ? data.components.reduce(
          (s, c) => s + c.weight * (c.bls_yoy[frame.i] as number),
          0
        )
      : null;
```

(Note this also fixes a latent operator-precedence bug in the old `oursHeadline` — the
`&& mode === "yoy"` lived inside `every()`.)

(d) Delete the final-frame caveat: remove the comment block and the
`{at === monthEnds.length - 1 && oursHeadline !== null ? " · 365-day ratio…" : ""}` expression.

- [ ] **Step 12: Build the site and eyeball the reconciliation**

```bash
cd site && npm run build
```

Expected: build green. Then `npm run dev`, open the homepage treemap, YoY mode, last frame:
footer "Ours" must now read ≈ the published headline (3.38-ish, whatever pulse.json says at the
time), and nat_gas's tile in vs-BLS mode must be near its gaptable gap, not −30.

- [ ] **Step 13: Commit**

```bash
git add pipeline/engine/gauge.py pipeline/publish/replay.py schemas/replay.schema.json \
  site/src/components/Treemap.tsx site/public/data/replay.json tests/test_gauge.py tests/test_replay.py
git commit -m "feat: replay carries own-obs YoY — treemap final frame reconciles with headline"
```

---

### Task 2: methodology live_sources phase-in annotation + lead_lag render

`methodology.json` lists configured blend sources even when they've never delivered a row
(aptlist/redfin today), and the page never shows the lead_lag stat compare.json already
publishes. Fix both.

**Files:**
- Modify: `pipeline/publish/methodology.py` (basket rows, ~line 84)
- Modify: `schemas/methodology.schema.json`
- Modify: `site/src/app/methodology/page.tsx`
- Test: `tests/test_methodology.py`
- Regenerate: `site/public/data/methodology.json`

**Interfaces:**
- Consumes: `vintage.max_obs_date(conn, code) -> str | None` (None = never seen).
- Produces: basket rows gain `"live_active": [codes]` (subset of `live_sources` with ≥1 store
  row). The page renders inactive ones with a `(phase-in)` suffix. Later connector tasks make
  sources active with zero further methodology changes.

- [ ] **Step 1: Write the failing test** — append to `tests/test_methodology.py`, reusing this
file's existing fixture store/conn and build-args helper:

```python
def test_basket_rows_split_active_vs_phase_in_sources():
    payload = _build_payload()  # this file's existing helper wrapping methodology.build
    row = next(r for r in payload["basket"] if r["code"] == "shelter_owned")
    assert set(row["live_active"]).issubset(set(row["live_sources"]))
    # the fixture store has zori rows but no aptlist/redfin rows:
    assert "zori_us" in row["live_active"]
    assert "aptlist_us" not in row["live_active"]
```

If the fixture store used by this file doesn't include `zori_us` rows, extend the fixture store
builder with one `zori_us` observation rather than weakening the assertions.

- [ ] **Step 2: Run to verify it fails**

Run: `pytest tests/test_methodology.py -v 2>&1 | tee /tmp/phase2a-t2-red.txt`
Expected: FAIL with `KeyError: 'live_active'`.

- [ ] **Step 3: Implement** — in `methodology.build()`'s basket loop:

```python
        live_sources = sorted(comp.live_blend) if comp.live_blend else []
        basket_rows.append({
            "code": comp.code, "label": comp.label, "weight": comp.weight,
            "mode": e["mode"],
            "live_sources": live_sources,
            "live_active": [s for s in live_sources
                            if vintage.max_obs_date(conn, s) is not None],
            "official_series": comp.official_series,
            "yoy_pct": None if e["yoy_pct"] is None else round(e["yoy_pct"], 2)})
```

- [ ] **Step 4: Schema** — in `schemas/methodology.schema.json`, add to the basket-row item
properties (and its `required`):

```json
"live_active": {"type": "array", "items": {"type": "string"}}
```

- [ ] **Step 5: Run suite green**

Run: `pytest -q 2>&1 | tee /tmp/phase2a-t2-green.txt`
Expected: 138 passed. If `test_published_data.py` fails on the committed methodology.json,
regenerate it in Step 6 first, then re-run.

- [ ] **Step 6: Regenerate committed methodology.json** — same pattern as Task 1 Step 10, but
building the full argument set (mirror the exact call in `run_daily.py:108-111`: it needs
`gauge_result, conn, sources, series, comps, compare_payload["validation"], gaptable_payload,
cpi, today`). Build `compare_payload` and `gaptable_payload` from the committed store exactly
as run_daily does. Verify `git diff --stat site/public/data/` touches only methodology.json.

- [ ] **Step 7: Page — phase-in annotation.** In `site/src/app/methodology/page.tsx`, the
sources cell (line ~130) becomes:

```tsx
                  <td style={{ ...td, color: "var(--muted)", fontSize: 12 }}>
                    {b.live_sources.length
                      ? b.live_sources
                          .map((s) =>
                            (b.live_active as string[]).includes(s) ? s : `${s} (phase-in)`
                          )
                          .join(" + ")
                      : b.official_series}
                  </td>
```

- [ ] **Step 8: Page — lead_lag chip.** In the "Validation vs official CPI" section, after the
per-variant chips and before the BLS-reconstruction chip, add:

```tsx
          {"lead_lag" in v.gauge && v.gauge.lead_lag ? (
            <div style={statChip}>
              <div style={{ fontSize: 11, letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--muted)" }}>
                lead vs print
              </div>
              <div style={{ fontSize: 15, marginTop: 4 }}>
                best corr <b>{v.gauge.lead_lag.corr}</b> at{" "}
                <b>{v.gauge.lead_lag.best_shift_months}mo</b> ahead
              </div>
            </div>
          ) : null}
```

(The page imports methodology.json — v.gauge.lead_lag exists there since 1c; if TypeScript
narrows the imported JSON type without it, cast via the same pattern the file already uses for
`v[name]` access.)

- [ ] **Step 9: Build + verify**

```bash
cd site && npm run build
```

Expected: green. Dev-server check: /methodology shows `aptlist_us (phase-in) + redfin_us
(phase-in) + zori_us` on both shelter rows, and the lead-vs-print chip with corr 0.942 / 1mo.

- [ ] **Step 10: Commit**

```bash
git add pipeline/publish/methodology.py schemas/methodology.schema.json \
  site/src/app/methodology/page.tsx site/public/data/methodology.json tests/test_methodology.py
git commit -m "feat: methodology phase-in annotation + lead_lag rendered on /methodology"
```

---

### Task 3: FMP history backfill

`fmp_gold`/`fmp_wti` have quotes only from 2026-07 forward, so `official.latest_quote()` returns
`yoy_pct=None` and the Markets KPI shows "—" until 2027. Pull daily history 2017-01-01→now once,
append to the store (today's vintage — we learned it today), commit the store rows.

**Files:**
- Modify: `pipeline/connectors/fmp.py` (add `fetch_history`)
- Create: `scripts/backfill_fmp.py`
- Create: `tests/fixtures/fmp_history.json`
- Test: `tests/test_fmp.py`
- Commit: new rows in `store/obs/2026-07.jsonl`

**Interfaces:**
- Consumes: FMP `stable/historical-price-eod/light?symbol=GCUSD&from=2017-01-01&apikey=...`
  returning `[{"symbol": "GCUSD", "date": "2017-01-03", "price": 1162.1, ...}, ...]`. **Spike
  first:** verify the exact route/fields with one live curl before writing the fixture; if the
  field is `close` not `price`, the fixture records reality and the code follows it.
- Produces: `fmp.fetch_history(symbols: list[str], api_key: str, from_date: str = "2017-01-01",
  vintage_date: str | None = None, http_get=None) -> list[Observation]`.

- [ ] **Step 1: Access spike (live, evidence-only).** Run one manual request with the real key
(from `.env` / GitHub secret owner) for `GCUSD`, capture the first 3 rows of JSON into the task
report, and save a 10-row sample as `tests/fixtures/fmp_history.json` **with real structure,
values may be truncated**. Record the exact URL used.

- [ ] **Step 2: Write the failing test** — append to `tests/test_fmp.py` (mirror this file's
existing fake-http pattern):

```python
def test_fetch_history_parses_daily_rows():
    fixture = json.loads((FIXTURES / "fmp_history.json").read_text())
    def fake_get(url, params=None, timeout=None):
        assert "historical-price-eod" in url
        assert params["symbol"] in ("GCUSD",)
        assert params["from"] == "2017-01-01"
        return FakeResponse(fixture)
    obs = fmp.fetch_history(["GCUSD"], "k", vintage_date="2026-07-10", http_get=fake_get)
    assert len(obs) == len(fixture)
    assert obs[0].series_code == "GCUSD"
    assert obs[0].route == "API" and obs[0].source == "FMP"
    assert obs[0].vintage_date == "2026-07-10"
```

Use this file's existing `FakeResponse`/fixture conventions verbatim (adjust names to match).

- [ ] **Step 3: RED**

Run: `pytest tests/test_fmp.py -v 2>&1 | tee /tmp/phase2a-t3-red.txt`
Expected: FAIL — `AttributeError: module ... has no attribute 'fetch_history'`.

- [ ] **Step 4: Implement in `pipeline/connectors/fmp.py`**

```python
HISTORY_URL = "https://financialmodelingprep.com/stable/historical-price-eod/light"


def fetch_history(symbols: list[str], api_key: str, from_date: str = "2017-01-01",
                  vintage_date: str | None = None, http_get=None) -> list[Observation]:
    """One-time backfill route (Phase 2a): daily closes since from_date.

    Vintage = today: we learned the history today; never backdate vintages."""
    http_get = http_get or requests.get
    vintage = vintage_date or today_et()
    out: list[Observation] = []
    for sym in symbols:
        resp = http_get(HISTORY_URL, params={"symbol": sym, "from": from_date,
                                             "apikey": api_key}, timeout=120)
        resp.raise_for_status()
        for row in resp.json():
            out.append(Observation(series_code=sym, obs_date=row["date"],
                                   value=float(row["price"]), vintage_date=vintage,
                                   source="FMP", route="API"))
    return out
```

(Field name per the Step-1 spike — if the live shape says `close`, use `close` here AND in the
fixture; the test then pins reality.)

- [ ] **Step 5: GREEN**

Run: `pytest tests/test_fmp.py -v 2>&1 | tee /tmp/phase2a-t3-green.txt`
Expected: all pass (previous fmp tests + 1 new).

- [ ] **Step 6: Write `scripts/backfill_fmp.py`**

```python
"""One-time FMP history backfill (Phase 2a). Run locally with FMP_API_KEY set:

    FMP_API_KEY=... python scripts/backfill_fmp.py --store store

Appends daily GCUSD/CLUSD closes since 2017 with TODAY's vintage; the store's
value-dedupe skips rows that already match, so re-running is harmless."""
import argparse
import os
import sys
from pathlib import Path

from pipeline.connectors import fmp
from pipeline.store import vintage


def main(argv=None) -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--store", required=True, type=Path)
    args = parser.parse_args(argv)
    key = os.environ.get("FMP_API_KEY")
    if not key:
        sys.exit("FMP_API_KEY not set")
    obs = fmp.fetch_history(["GCUSD", "CLUSD"], key)
    # store rows keep the registry's internal codes, mirroring collect_all's id_map
    id_map = {"GCUSD": "fmp_gold", "CLUSD": "fmp_wti"}
    from dataclasses import replace
    obs = [replace(o, series_code=id_map[o.series_code]) for o in obs]
    written = vintage.append(obs, args.store)
    print(f"fetched {len(obs)}, wrote {written} new rows")
    return 0


if __name__ == "__main__":
    sys.exit(main())
```

- [ ] **Step 7: Run the backfill for real, verify, and check the Markets KPI unblocks**

```bash
FMP_API_KEY=<real> python scripts/backfill_fmp.py --store store 2>&1 | tee /tmp/phase2a-t3-backfill.txt
python - <<'EOF'
from pathlib import Path
from pipeline.store import vintage
from pipeline.engine import official
conn = vintage.load(Path("store"))
for code in ("fmp_gold", "fmp_wti"):
    q = official.latest_quote(conn, code)
    print(code, q["obs_date"], "yoy:", q["yoy_pct"])
    assert q["yoy_pct"] is not None, f"{code} yoy still None"
EOF
git diff --stat store/
```

Expected: both series print a non-None YoY; `git diff` shows only `store/obs/2026-07.jsonl`
grew (append-only — REVIEW GATE: any change to an earlier partition is a hard stop).

- [ ] **Step 8: Full suite + commit**

```bash
pytest -q 2>&1 | tee /tmp/phase2a-t3-green-full.txt
git add pipeline/connectors/fmp.py scripts/backfill_fmp.py tests/test_fmp.py \
  tests/fixtures/fmp_history.json store/obs/2026-07.jsonl
git commit -m "feat: FMP history backfill — Markets KPI YoY live before 2027"
```

Expected: 139 passed.

---

### Task 4: Apartment List connector

First new source. CSV route, monthly cadence, national rent estimate. Activates the second leg
of the shelter blend that `config/basket.json` already declares (`aptlist_us: 0.3`) —
`blend.py`'s renormalization phases it in with zero engine changes.

**Files:**
- Create: `pipeline/connectors/aptlist.py`
- Create: `tests/fixtures/aptlist.csv`, `tests/test_aptlist.py`
- Modify: `config/series.json` (source `APTLIST` + series `aptlist_us`)
- Modify: `pipeline/collect.py` (import + fetcher + FETCHERS entry)
- Modify: `tests/test_run_daily.py` (extend `fake_get` to the new URL; bump source-count pins)
- Modify: `tests/test_registry.py` if it pins source/series counts

**Interfaces:**
- Consumes: Apartment List research data page (https://www.apartmentlist.com/research/data) —
  monthly rent-estimate CSV, wide format (one row per location, one column per month).
  **Spike first (Step 1)**: pin the real download URL and exact column names; the code below
  assumes a `location_name` column with a `National` row and `YYYY_MM`-style month columns —
  adjust BOTH fixture and parser to recorded reality, keeping signatures identical.
- Produces: `aptlist.fetch(vintage_date=None, http_get=None) -> list[Observation]` emitting
  series_code `aptlist_us`, monthly first-of-month obs_dates, `source="APTLIST"`,
  `route="CSV"`. Store code `aptlist_us` is what basket.json already references.

- [ ] **Step 1: Access spike.** Locate the current rent-estimates CSV URL on the research/data
page; download once; record URL + header row + the national row's first 4 columns in the task
report. Save a trimmed fixture (`tests/fixtures/aptlist.csv`): header + the national row +
one city row (to prove filtering), months 2017-01 through at least 2018-02.

- [ ] **Step 2: Write the failing test** — `tests/test_aptlist.py` (mirror `test_zillow.py`'s
structure and fake-response class):

```python
import pathlib

from pipeline.connectors import aptlist

FIXTURES = pathlib.Path(__file__).parent / "fixtures"


class FakeResponse:
    def __init__(self, text):
        self.text = text

    def raise_for_status(self):
        pass


def test_fetch_parses_national_monthly_rows():
    csv_text = (FIXTURES / "aptlist.csv").read_text()

    def fake_get(url, timeout=None):
        return FakeResponse(csv_text)

    obs = aptlist.fetch(vintage_date="2026-07-10", http_get=fake_get)
    assert all(o.series_code == "aptlist_us" for o in obs)
    assert all(o.source == "APTLIST" and o.route == "CSV" for o in obs)
    assert all(o.obs_date.endswith("-01") for o in obs)
    assert all(o.obs_date >= "2017-01-01" for o in obs)
    dates = [o.obs_date for o in obs]
    assert dates == sorted(dates) and len(dates) >= 12


def test_fetch_raises_when_national_row_missing():
    def fake_get(url, timeout=None):
        return FakeResponse("location_name,2017_01\nDenver, CO,1400\n")

    try:
        aptlist.fetch(vintage_date="2026-07-10", http_get=fake_get)
        assert False, "expected ValueError"
    except ValueError as e:
        assert "National" in str(e)
```

(Match `test_zillow.py`'s exact FakeResponse/fake_get conventions if they differ.)

- [ ] **Step 3: RED**

Run: `pytest tests/test_aptlist.py -v 2>&1 | tee /tmp/phase2a-t4-red.txt`
Expected: FAIL — `ModuleNotFoundError: No module named 'pipeline.connectors.aptlist'`.

- [ ] **Step 4: Implement `pipeline/connectors/aptlist.py`** (pattern: `zillow.py`)

```python
"""Apartment List rent estimates — https://www.apartmentlist.com/research/data

Monthly national rent estimate, wide CSV (one row per location, one column per
month). Second leg of the shelter blend (basket.json aptlist_us: 0.3). URL
lives in a constant — moves are a one-line fix, caught by the QA connector
check."""
import csv
import io

import requests

from pipeline.connectors.fred import today_et
from pipeline.connectors.util import get_text, month_first
from pipeline.models import Observation

# Pinned by the Task-4 access spike — update the comment with the spike date.
CSV_URL = "<URL from Step 1>"
START = "2017-01-01"


def fetch(vintage_date: str | None = None, http_get=None) -> list[Observation]:
    http_get = http_get or requests.get
    vintage = vintage_date or today_et()
    reader = csv.DictReader(io.StringIO(get_text(CSV_URL, http_get)))
    for row in reader:
        if row.get("location_name") != "National":
            continue
        out = []
        for col, val in row.items():
            # month columns per the spike, e.g. "2017_01" -> "2017-01-01"
            if len(col) == 7 and col[4] == "_" and val not in (None, ""):
                obs_date = month_first(col.replace("_", "-"))
                if obs_date >= START:
                    out.append(Observation(series_code="aptlist_us",
                                           obs_date=obs_date, value=float(val),
                                           vintage_date=vintage,
                                           source="APTLIST", route="CSV"))
        return sorted(out, key=lambda o: o.obs_date)
    raise ValueError("National row not found in Apartment List CSV")
```

`CSV_URL` and the column-name predicate come from the spike — the fixture records the same
reality, so the tests pin whatever shape is real.

- [ ] **Step 5: GREEN**

Run: `pytest tests/test_aptlist.py -v 2>&1 | tee /tmp/phase2a-t4-green.txt`
Expected: 2 passed.

- [ ] **Step 6: Registry.** In `config/series.json`, add to `sources`:

```json
"APTLIST": {"route": "CSV", "cadence": "monthly"}
```

and to `series`:

```json
{"code": "aptlist_us", "source": "APTLIST", "source_id": "national_rent",
 "name": "Apartment List national rent estimate $", "max_staleness_days": 75}
```

- [ ] **Step 7: Wire `pipeline/collect.py`.** Extend the import line to include `aptlist`, add

```python
def _aptlist(subset, key, http):
    return aptlist.fetch(http_get=http)
```

and add `"APTLIST": _aptlist` to `FETCHERS`.

- [ ] **Step 8: Extend the end-to-end fake + count pins.** In `tests/test_run_daily.py`, extend
`fake_get` to return the aptlist fixture for the aptlist URL (match how it dispatches Zillow's
two CSV URLs); update every assertion that pins source counts (e.g. `7/7`, `len(results) == 7`,
sources_status totals) from 7 to 8. In `tests/test_registry.py`, update pinned counts
(31 series → 32, 7 sources → 8) if pinned.

- [ ] **Step 9: Full suite + live collect verification**

```bash
pytest -q 2>&1 | tee /tmp/phase2a-t4-green-full.txt
FRED_API_KEY=... EIA_API_KEY=... BLS_API_KEY=... FMP_API_KEY=... \
  python -m pipeline.run_daily --store store --out /tmp/phase2a-t4-out 2>&1 | tee /tmp/phase2a-t4-live.txt
```

Expected: suite green (count = prior + 2, adjusted for pin edits); live run prints
`source APTLIST: ok` with >100 fetched, and `/tmp/phase2a-t4-out/sources_status.json` shows 8
sources. `git diff store/` shows only 2026-07 partition appends. The gauge's shelter components
now blend two sources — sanity-print from the run output that pulse gauge YoY moved plausibly
(±small) rather than wildly.

- [ ] **Step 10: Commit**

```bash
git add pipeline/connectors/aptlist.py pipeline/collect.py config/series.json \
  tests/test_aptlist.py tests/fixtures/aptlist.csv tests/test_run_daily.py tests/test_registry.py \
  store/obs/2026-07.jsonl
git commit -m "feat: Apartment List connector — shelter blend leg 2 of 3 live"
```

---

### Task 5: Redfin connector

Third shelter-blend leg (`redfin_us: 0.2`). Same shape as Task 4: CSV/TSV route, monthly
national rent series, blend phases in via renormalization.

**Files:**
- Create: `pipeline/connectors/redfin.py`
- Create: `tests/fixtures/redfin.tsv`, `tests/test_redfin.py`
- Modify: `config/series.json` (source `REDFIN` + series `redfin_us`)
- Modify: `pipeline/collect.py`
- Modify: `tests/test_run_daily.py` (fake + pins 8→9), `tests/test_registry.py`

**Interfaces:**
- Consumes: Redfin Data Center rental report — national median asking rent, TSV (typically a
  public S3 object, possibly gzipped). **Spike first**: pin URL, compression, column names
  (`period_begin`/`region`/median-rent-style columns), national-row predicate.
- Produces: `redfin.fetch(vintage_date=None, http_get=None) -> list[Observation]` emitting
  `redfin_us`, monthly first-of-month, `source="REDFIN"`, `route="CSV"`.

- [ ] **Step 1: Access spike.** Pin the rental-data TSV URL from the Data Center; record header
+ one national row in the report. Fixture `tests/fixtures/redfin.tsv`: header + national rows
for ≥14 consecutive months + one metro row. If the live object is gzipped, store the fixture
DECOMPRESSED and note that `fetch` must decompress (`gzip.decompress(resp.content)`) — in that
case the connector reads `resp.content`, not `resp.text`, and the test's FakeResponse carries
`content` bytes.

- [ ] **Step 2: Write the failing test** — `tests/test_redfin.py`:

```python
import pathlib

from pipeline.connectors import redfin

FIXTURES = pathlib.Path(__file__).parent / "fixtures"


class FakeResponse:
    def __init__(self, text):
        self.text = text

    def raise_for_status(self):
        pass


def test_fetch_parses_national_monthly_rent():
    tsv = (FIXTURES / "redfin.tsv").read_text()

    def fake_get(url, timeout=None):
        return FakeResponse(tsv)

    obs = redfin.fetch(vintage_date="2026-07-10", http_get=fake_get)
    assert all(o.series_code == "redfin_us" for o in obs)
    assert all(o.source == "REDFIN" and o.route == "CSV" for o in obs)
    assert all(o.obs_date.endswith("-01") for o in obs)
    dates = [o.obs_date for o in obs]
    assert dates == sorted(dates) and len(dates) >= 12


def test_fetch_raises_when_national_rows_missing():
    def fake_get(url, timeout=None):
        return FakeResponse("period_begin\tregion\trent\n2024-01-01\tDenver, CO\t1900\n")

    try:
        redfin.fetch(vintage_date="2026-07-10", http_get=fake_get)
        assert False, "expected ValueError"
    except ValueError as e:
        assert "national" in str(e).lower()
```

- [ ] **Step 3: RED**

Run: `pytest tests/test_redfin.py -v 2>&1 | tee /tmp/phase2a-t5-red.txt`
Expected: ModuleNotFoundError.

- [ ] **Step 4: Implement `pipeline/connectors/redfin.py`**

```python
"""Redfin Data Center rentals — national median asking rent (monthly TSV).

Third shelter-blend leg (basket.json redfin_us: 0.2). Long format: one row per
region per period; we keep national rows only."""
import csv
import io

import requests

from pipeline.connectors.fred import today_et
from pipeline.connectors.util import get_text, month_first
from pipeline.models import Observation

# Pinned by the Task-5 access spike.
TSV_URL = "<URL from Step 1>"
REGION_COL, PERIOD_COL, VALUE_COL = "region", "period_begin", "<value col from spike>"
NATIONAL = "National"
START = "2017-01-01"


def fetch(vintage_date: str | None = None, http_get=None) -> list[Observation]:
    http_get = http_get or requests.get
    vintage = vintage_date or today_et()
    reader = csv.DictReader(io.StringIO(get_text(TSV_URL, http_get)), delimiter="\t")
    out = []
    for row in reader:
        if row.get(REGION_COL) != NATIONAL or not row.get(VALUE_COL):
            continue
        obs_date = month_first(row[PERIOD_COL])
        if obs_date >= START:
            out.append(Observation(series_code="redfin_us", obs_date=obs_date,
                                   value=float(row[VALUE_COL]), vintage_date=vintage,
                                   source="REDFIN", route="CSV"))
    if not out:
        raise ValueError("no national rows found in Redfin TSV")
    return sorted(out, key=lambda o: o.obs_date)
```

(If Redfin's national label differs — e.g. "United States" — the spike pins it; fixture and
`NATIONAL` constant follow. If Redfin's history starts after 2017, that's fine: splice grafts
at its first observation.)

- [ ] **Step 5: GREEN**

Run: `pytest tests/test_redfin.py -v 2>&1 | tee /tmp/phase2a-t5-green.txt`

- [ ] **Step 6: Registry + collect wiring** (exact same pattern as Task 4 Steps 6–7):
sources gains `"REDFIN": {"route": "CSV", "cadence": "monthly"}`; series gains
`{"code": "redfin_us", "source": "REDFIN", "source_id": "national_median_asking_rent",
"name": "Redfin national median asking rent $", "max_staleness_days": 75}`; `collect.py`
imports `redfin`, adds `_redfin` fetcher returning `redfin.fetch(http_get=http)`, registers
`"REDFIN": _redfin`.

- [ ] **Step 7: Extend fakes + pins 8→9** in `tests/test_run_daily.py` (and registry count
pins 32→33).

- [ ] **Step 8: Full suite + live verify + commit**

```bash
pytest -q 2>&1 | tee /tmp/phase2a-t5-green-full.txt
FRED_API_KEY=... EIA_API_KEY=... BLS_API_KEY=... FMP_API_KEY=... \
  python -m pipeline.run_daily --store store --out /tmp/phase2a-t5-out 2>&1 | tee /tmp/phase2a-t5-live.txt
git add pipeline/connectors/redfin.py pipeline/collect.py config/series.json \
  tests/test_redfin.py tests/fixtures/redfin.tsv tests/test_run_daily.py tests/test_registry.py \
  store/obs/2026-07.jsonl
git commit -m "feat: Redfin connector — shelter blend fully 3-source"
```

Expected: `source REDFIN: ok`; shelter blend now rides all three declared legs. Record the
gauge YoY before/after in the task report (shelter is 34% of the basket — the movement is the
phase's first visible payoff and belongs in the ledger).

---

### Task 6: USDA connector + food_home composite (spike-gated)

The riskiest data question in 2a (spec §3): is there an honest USDA food-at-home composite?
**Viability rule (from the spec, binding):** the connector ships and food_home flips to live
ONLY if the spike finds ≥5 staple categories, weekly-or-better cadence, and ≥2 years of history
to splice. Otherwise food_home stays BLS-CF, the deviation is recorded in the task report and
ledger, and Steps 6–8 are skipped (registry/config unchanged; the connector code still lands if
partially viable — controller decides with the user at review).

The compositing itself needs NO new engine code: `food_home.live_blend` lists each USDA series
with its within-component weight; `blend.py` renormalizes over whichever are present.

**Files:**
- Create: `pipeline/connectors/usda.py`
- Create: `tests/fixtures/usda_report.json`, `tests/test_usda.py`
- Modify: `config/series.json` (source `USDA` w/ secret `USDA_API_KEY` + one series per staple)
- Modify: `config/basket.json` (food_home live_blend + live_variants, Step 7)
- Modify: `pipeline/collect.py`, `tests/test_run_daily.py`, `tests/test_registry.py`
- Modify: `.github/workflows/daily.yml` (pass `USDA_API_KEY` secret to the pipeline step)

**Interfaces:**
- Consumes: USDA AMS Market News API (`https://marsapi.ams.usda.gov/services/v1.2/reports/...`,
  free key, HTTP basic auth or key param — spike pins auth + report slugs). Candidate national
  series to evaluate: eggs (national shell egg), milk/dairy (national dairy retail/wholesale),
  boxed beef cutout, pork cutout, broiler composite, plus produce if a stable national series
  exists. NASS QuickStats is the fallback provider if AMS shapes are unusable.
- Produces: `usda.fetch(series_ids: list[str], api_key: str, vintage_date=None, http_get=None)
  -> list[Observation]` where `series_ids` are the registry `source_id`s (report slug + field,
  e.g. `"2848:egg_large_white"` — exact scheme pinned by spike), one store series per staple
  (`usda_eggs_w`, `usda_milk_w`, `usda_beef_w`, `usda_pork_w`, `usda_broiler_w`, …),
  `source="USDA"`, `route="API"`.
- Config produced (Step 7): `food_home.live_blend` with CPI-relative-importance-derived weights
  over the staples that passed the spike, e.g. (5-staple case)
  `{"usda_beef_w": 0.30, "usda_pork_w": 0.15, "usda_broiler_w": 0.15, "usda_milk_w": 0.20,
  "usda_eggs_w": 0.20}` — weights are within-component mix judgments, documented in the task
  report; blend renormalization tolerates any subset being stale.

- [ ] **Step 1: Access spike (decision step).** Register a free MARS API key. For each
candidate staple: identify the national report + field, pull 2017→now history once, record
(slug, field, cadence, first obs date, last obs date) in a table in the task report. Apply the
viability rule. **Output: GO (list of ≥5 series) or NO-GO (deviation record, stop after
Step 2's negative-path test is skipped — jump to Task 7).** Save one real report response
(trimmed to ~10 rows) as `tests/fixtures/usda_report.json`.

- [ ] **Step 2 (GO path): Write the failing test** — `tests/test_usda.py`:

```python
import json
import pathlib

from pipeline.connectors import usda

FIXTURES = pathlib.Path(__file__).parent / "fixtures"


class FakeResponse:
    def __init__(self, payload):
        self._payload = payload

    def json(self):
        return self._payload

    def raise_for_status(self):
        pass


def test_fetch_parses_weekly_national_prices():
    fixture = json.loads((FIXTURES / "usda_report.json").read_text())

    def fake_get(url, params=None, timeout=None, **kw):
        return FakeResponse(fixture)

    obs = usda.fetch(["<spiked source_id>"], "k",
                     vintage_date="2026-07-10", http_get=fake_get)
    assert obs, "no observations parsed"
    assert all(o.source == "USDA" and o.route == "API" for o in obs)
    assert all(o.value > 0 for o in obs)
    dates = [o.obs_date for o in obs]
    assert dates == sorted(dates)


def test_fetch_skips_rows_without_price():
    def fake_get(url, params=None, timeout=None, **kw):
        return FakeResponse({"results": [{"report_date": "07/04/2026"}]})

    obs = usda.fetch(["<spiked source_id>"], "k",
                     vintage_date="2026-07-10", http_get=fake_get)
    assert obs == []
```

Adjust field names to the recorded fixture. The two tests pin: happy-path parse and
missing-value tolerance (USDA reports have gaps — a missing price is skipped, never 0).

- [ ] **Step 3: RED** — `pytest tests/test_usda.py -v 2>&1 | tee /tmp/phase2a-t6-red.txt`

- [ ] **Step 4: Implement `pipeline/connectors/usda.py`.** Shape (adjust endpoint/fields to the
spike; keep signature and skip-don't-zero semantics exactly):

```python
"""USDA AMS Market News — national staple food prices (weekly).

Feeds the food_home composite: each staple is its own store series; the
within-component mix lives in config/basket.json live_blend and renormalizes
over whatever subset is fresh (spec 2a §3). Missing prices are skipped, never
zero-filled."""
from datetime import datetime

import requests

from pipeline.connectors.fred import today_et
from pipeline.models import Observation

REPORT_URL = "https://marsapi.ams.usda.gov/services/v1.2/reports/{slug}"
START = "2017-01-01"


def fetch(series_ids: list[str], api_key: str, vintage_date: str | None = None,
          http_get=None) -> list[Observation]:
    http_get = http_get or requests.get
    vintage = vintage_date or today_et()
    out: list[Observation] = []
    for sid in series_ids:
        slug, field = sid.split(":", 1)
        resp = http_get(REPORT_URL.format(slug=slug),
                        params={"q": "report_begin_date=01/01/2017:"},
                        auth=(api_key, ""), timeout=120)
        resp.raise_for_status()
        for row in resp.json()["results"]:
            price = row.get(field)
            if price in (None, "", "N/A"):
                continue
            obs_date = datetime.strptime(
                row["report_date"], "%m/%d/%Y").strftime("%Y-%m-%d")
            if obs_date < START:
                continue
            out.append(Observation(series_code=sid, obs_date=obs_date,
                                   value=float(price), vintage_date=vintage,
                                   source="USDA", route="API"))
    return sorted(out, key=lambda o: (o.series_code, o.obs_date))
```

(`collect_all`'s id_map renames `source_id` → registry `code`, same as every other source.)

- [ ] **Step 5: GREEN + wiring.** `pytest tests/test_usda.py -v 2>&1 | tee /tmp/phase2a-t6-green.txt`.
Then registry: sources gains `"USDA": {"route": "API", "cadence": "weekly", "secret":
"USDA_API_KEY"}`; one series row per GO staple (`max_staleness_days: 30`); `collect.py` gains
`_usda(subset, key, http)` returning `usda.fetch([s.source_id for s in subset], key,
http_get=http)` and the `"USDA": _usda` entry. Extend `tests/test_run_daily.py` fake (+pins
9→10) and registry pins.

- [ ] **Step 6: daily.yml secret.** Add `USDA_API_KEY: ${{ secrets.USDA_API_KEY }}` to the
"Run pipeline" step's `env:` block. **Tell the controller: the user must add the repo secret
before the next scheduled run** — until then the source reports `missing secret USDA_API_KEY`
(isolated failure, food_home carries forward; that is the designed degradation, not a bug).

- [ ] **Step 7: Flip food_home config.** In `config/basket.json`, food_home becomes:

```json
{"code": "food_home", "label": "Food at home", "weight": 0.082,
 "official_series": "CUUR0000SAF11",
 "live_blend": {"usda_beef_w": 0.30, "usda_pork_w": 0.15, "usda_broiler_w": 0.15,
                "usda_milk_w": 0.20, "usda_eggs_w": 0.20},
 "live_variants": ["gauge"]}
```

(weights per the spike's actual GO list, documented; `live_variants` grows in Task 12).

- [ ] **Step 8: Full suite + live verify + commit**

```bash
pytest -q 2>&1 | tee /tmp/phase2a-t6-green-full.txt
FRED_API_KEY=... EIA_API_KEY=... BLS_API_KEY=... FMP_API_KEY=... USDA_API_KEY=... \
  python -m pipeline.run_daily --store store --out /tmp/phase2a-t6-out 2>&1 | tee /tmp/phase2a-t6-live.txt
git add pipeline/connectors/usda.py pipeline/collect.py config/series.json config/basket.json \
  .github/workflows/daily.yml tests/test_usda.py tests/fixtures/usda_report.json \
  tests/test_run_daily.py tests/test_registry.py store/obs/2026-07.jsonl
git commit -m "feat: USDA connector — food_home composite live (spike-verified)"
```

Expected: `source USDA: ok`; food_home mode flips to `live` in the run output/gaptable; gauge
coverage rises by 8.2pp. Record before/after coverage + gauge YoY in the report. Check
food_home's first live YoY against its BLS YoY (gaptable row) — a gap >5pp on day one is a
composite-construction red flag: stop and surface to controller rather than commit.

---

### Task 7: AAA daily gas scrape + fuel blend rewire

First scrape. Daily national average pump price from gasprices.aaa.com. Fuel's blend becomes
AAA-primary. **Continuity decision (plan-level, flag at review):** the blend is
`{"aaa_gas_d": 0.7, "eia_gasreg_w": 0.3}`, NOT `{"aaa_gas_d": 1.0}` — blend renormalization
means the fuel index history stays 100% EIA-driven before AAA's first observation (AAA has no
history; it accrues from today). A 1.0 flip would splice AAA at today and revert eight years of
live fuel history to official-CPI shape. Both sources measure the same pump price; 70/30 makes
AAA dominant going forward while preserving the published past. The AAA-vs-EIA divergence QA
check lands in Task 15.

**Files:**
- Create: `pipeline/connectors/aaa.py`
- Create: `tests/fixtures/aaa.html`, `tests/test_aaa.py`
- Modify: `config/series.json` (source `AAA` + series `aaa_gas_d`)
- Modify: `config/basket.json` (fuel live_blend)
- Modify: `pipeline/collect.py`, `tests/test_run_daily.py` (pins → 11), `tests/test_registry.py`

**Interfaces:**
- Consumes: `https://gasprices.aaa.com/` HTML. **Spike first:** save the live page as
  `tests/fixtures/aaa.html` (trim to the fragment containing the national average, keep real
  markup); pin the regex against it.
- Produces: `aaa.fetch(vintage_date=None, http_get=None) -> list[Observation]` — exactly ONE
  observation per run: series `aaa_gas_d`, obs_date = today ET, `source="AAA"`,
  `route="SCRAPE"`. History accrues one row per day in the store.

- [ ] **Step 1: Access spike.** Fetch the live page once; save the trimmed fragment as the
fixture; record in the report which element carries the national average and today's value.

- [ ] **Step 2: Write the failing test** — `tests/test_aaa.py`:

```python
import pathlib

from pipeline.connectors import aaa

FIXTURES = pathlib.Path(__file__).parent / "fixtures"


class FakeResponse:
    def __init__(self, text):
        self.text = text

    def raise_for_status(self):
        pass


def _fake_get_for(text):
    def fake_get(url, timeout=None):
        return FakeResponse(text)
    return fake_get


def test_fetch_extracts_national_average():
    html = (FIXTURES / "aaa.html").read_text()
    obs = aaa.fetch(vintage_date="2026-07-10", http_get=_fake_get_for(html))
    assert len(obs) == 1
    o = obs[0]
    assert o.series_code == "aaa_gas_d"
    assert o.source == "AAA" and o.route == "SCRAPE"
    assert o.obs_date == o.vintage_date == "2026-07-10"
    assert 1.5 <= o.value <= 7.0  # matches the fixture's real value exactly:
    # tighten to == <fixture value> once the fixture is recorded


def test_fetch_raises_on_structure_drift():
    try:
        aaa.fetch(vintage_date="2026-07-10",
                  http_get=_fake_get_for("<html><body>redesigned</body></html>"))
        assert False, "expected ValueError"
    except ValueError as e:
        assert "national average" in str(e)


def test_fetch_raises_on_implausible_value():
    html = (FIXTURES / "aaa.html").read_text()
    drifted = html.replace(_first_price(html), "$45.999")
    try:
        aaa.fetch(vintage_date="2026-07-10", http_get=_fake_get_for(drifted))
        assert False, "expected ValueError"
    except ValueError as e:
        assert "implausible" in str(e)


def _first_price(html):
    import re
    return re.search(r"\$\d\.\d{3}", html).group(0)
```

- [ ] **Step 3: RED** — `pytest tests/test_aaa.py -v 2>&1 | tee /tmp/phase2a-t7-red.txt`
(ModuleNotFoundError).

- [ ] **Step 4: Implement `pipeline/connectors/aaa.py`**

```python
"""AAA national average gas price — scraped from https://gasprices.aaa.com/

One observation per run (today's national regular average); daily history
accrues in the store. Scrape protections (spec 2a §3): tight regex pinned to
a recorded fixture, plausible-range check, and the collect-layer isolation —
a redesigned page degrades fuel to its blend partners, never crashes the run.
"""
import re

import requests

from pipeline.connectors.fred import today_et
from pipeline.connectors.util import get_text
from pipeline.models import Observation

URL = "https://gasprices.aaa.com/"
# Pinned by the Task-7 spike against tests/fixtures/aaa.html — the national
# average appears as $D.DDD in the "<fragment recorded in the spike>" block.
PRICE_RE = re.compile(r"<regex from spike>")
PLAUSIBLE = (1.5, 7.0)  # $/gal — outside this the page structure has drifted


def fetch(vintage_date: str | None = None, http_get=None) -> list[Observation]:
    http_get = http_get or requests.get
    vintage = vintage_date or today_et()
    html = get_text(URL, http_get)
    m = PRICE_RE.search(html)
    if not m:
        raise ValueError("AAA page: national average not found (structure drift?)")
    value = float(m.group(1))
    if not (PLAUSIBLE[0] <= value <= PLAUSIBLE[1]):
        raise ValueError(f"AAA national average {value} implausible "
                         f"(range {PLAUSIBLE}) — structure drift?")
    return [Observation(series_code="aaa_gas_d", obs_date=vintage, value=value,
                        vintage_date=vintage, source="AAA", route="SCRAPE")]
```

- [ ] **Step 5: GREEN** — `pytest tests/test_aaa.py -v 2>&1 | tee /tmp/phase2a-t7-green.txt`

- [ ] **Step 6: Registry + collect + config.** sources gains
`"AAA": {"route": "SCRAPE", "cadence": "daily"}`; series gains
`{"code": "aaa_gas_d", "source": "AAA", "source_id": "national_regular",
"name": "AAA national average regular gasoline $/gal", "max_staleness_days": 4}`.
`collect.py`: import `aaa`, `_aaa` fetcher (`aaa.fetch(http_get=http)`), `"AAA": _aaa`.
`config/basket.json` fuel becomes:

```json
{"code": "fuel", "label": "Fuel (gasoline)", "weight": 0.030,
 "official_series": "CUUR0000SETB01",
 "live_blend": {"aaa_gas_d": 0.7, "eia_gasreg_w": 0.3},
 "live_variants": ["gauge", "tracker"]}
```

(Copy the existing fuel entry's exact `label` — do not retype it from this plan.)

- [ ] **Step 7: Fakes + pins.** `tests/test_run_daily.py` fake_get returns the aaa fixture for
`gasprices.aaa.com`; pins 10→11 sources. `tests/test_registry.py` counts.

- [ ] **Step 8: Full suite + live verify + commit**

```bash
pytest -q 2>&1 | tee /tmp/phase2a-t7-green-full.txt
FRED_API_KEY=... EIA_API_KEY=... BLS_API_KEY=... FMP_API_KEY=... USDA_API_KEY=... \
  python -m pipeline.run_daily --store store --out /tmp/phase2a-t7-out 2>&1 | tee /tmp/phase2a-t7-live.txt
git add pipeline/connectors/aaa.py pipeline/collect.py config/series.json config/basket.json \
  tests/test_aaa.py tests/fixtures/aaa.html tests/test_run_daily.py tests/test_registry.py \
  store/obs/2026-07.jsonl
git commit -m "feat: AAA daily gas scrape — fuel rides daily pump prices (70/30 w/ EIA)"
```

Expected: `source AAA: ok, 1 fetched`; fuel still `live`; gauge YoY moves ≤0.1pp (one day of
one 3% component — anything larger means the blend weights or splice misbehaved: stop).

---

### Task 8: Mortgage News Daily scrape

Daily 30yr fixed rate — the Cost-of-Living variant's rate input (Task 11), with PMMS weekly as
the standing fallback. No basket change here: the rate is consumed directly by the payment
function, not by any component's blend.

**Files:**
- Create: `pipeline/connectors/mnd.py`
- Create: `tests/fixtures/mnd.html`, `tests/test_mnd.py`
- Modify: `config/series.json` (source `MND` + series `mnd_30y_d`)
- Modify: `pipeline/collect.py`, `tests/test_run_daily.py` (pins → 12), `tests/test_registry.py`

**Interfaces:**
- Consumes: `https://www.mortgagenewsdaily.com/mortgage-rates/30-year-fixed` HTML. Spike pins
  the fragment + regex, fixture records it.
- Produces: `mnd.fetch(vintage_date=None, http_get=None) -> list[Observation]` — one obs/run:
  `mnd_30y_d`, obs_date = today ET, value = rate in percent (e.g. `6.38`), `source="MND"`,
  `route="SCRAPE"`. Task 11 reads this series (with `pmms_30yr`) via `vintage.latest`.

- [ ] **Step 1: Access spike.** Same protocol as Task 7 — trimmed real fragment saved as
`tests/fixtures/mnd.html`, regex + today's rate recorded in the report.

- [ ] **Step 2: Write the failing test** — `tests/test_mnd.py`:

```python
import pathlib
import re

from pipeline.connectors import mnd

FIXTURES = pathlib.Path(__file__).parent / "fixtures"


class FakeResponse:
    def __init__(self, text):
        self.text = text

    def raise_for_status(self):
        pass


def _fake_get_for(text):
    def fake_get(url, timeout=None):
        return FakeResponse(text)
    return fake_get


def test_fetch_extracts_30yr_rate():
    html = (FIXTURES / "mnd.html").read_text()
    obs = mnd.fetch(vintage_date="2026-07-10", http_get=_fake_get_for(html))
    assert len(obs) == 1
    o = obs[0]
    assert o.series_code == "mnd_30y_d"
    assert o.source == "MND" and o.route == "SCRAPE"
    assert o.obs_date == o.vintage_date == "2026-07-10"
    assert 2.0 <= o.value <= 12.0  # tighten to == <fixture value> once recorded


def test_fetch_raises_on_structure_drift():
    try:
        mnd.fetch(vintage_date="2026-07-10",
                  http_get=_fake_get_for("<html><body>redesigned</body></html>"))
        assert False, "expected ValueError"
    except ValueError as e:
        assert "30yr rate" in str(e)


def test_fetch_raises_on_implausible_value():
    html = (FIXTURES / "mnd.html").read_text()
    drifted = html.replace(_first_rate(html), "29.99")
    try:
        mnd.fetch(vintage_date="2026-07-10", http_get=_fake_get_for(drifted))
        assert False, "expected ValueError"
    except ValueError as e:
        assert "implausible" in str(e)


def _first_rate(html):
    return re.search(r"\d\.\d{2}(?=%)", html).group(0)
```

(`_first_rate` must target the exact substring the fixture carries — adjust the lookahead to
the recorded markup if the rate isn't immediately followed by `%`.)

- [ ] **Step 3: RED** — `pytest tests/test_mnd.py -v 2>&1 | tee /tmp/phase2a-t8-red.txt`

- [ ] **Step 4: Implement `pipeline/connectors/mnd.py`** — mirror `aaa.py` exactly:

```python
"""Mortgage News Daily 30yr fixed — daily rate scrape.

Primary rate input for the Cost-of-Living variant's marginal-buyer payment
(spec §5 variant table); PMMS weekly is the durable fallback. One observation
per run; daily history accrues."""
import re

import requests

from pipeline.connectors.fred import today_et
from pipeline.connectors.util import get_text
from pipeline.models import Observation

URL = "https://www.mortgagenewsdaily.com/mortgage-rates/30-year-fixed"
RATE_RE = re.compile(r"<regex from spike>")
PLAUSIBLE = (2.0, 12.0)  # percent


def fetch(vintage_date: str | None = None, http_get=None) -> list[Observation]:
    http_get = http_get or requests.get
    vintage = vintage_date or today_et()
    html = get_text(URL, http_get)
    m = RATE_RE.search(html)
    if not m:
        raise ValueError("MND page: 30yr rate not found (structure drift?)")
    value = float(m.group(1))
    if not (PLAUSIBLE[0] <= value <= PLAUSIBLE[1]):
        raise ValueError(f"MND 30yr rate {value} implausible (range {PLAUSIBLE})")
    return [Observation(series_code="mnd_30y_d", obs_date=vintage, value=value,
                        vintage_date=vintage, source="MND", route="SCRAPE")]
```

- [ ] **Step 5: GREEN + wiring.** Registry: `"MND": {"route": "SCRAPE", "cadence": "daily"}`;
series `{"code": "mnd_30y_d", "source": "MND", "source_id": "rate_30yr_fixed",
"name": "Mortgage News Daily 30yr fixed %", "max_staleness_days": 5}`. collect.py `_mnd` +
entry. Fakes + pins 11→12.

- [ ] **Step 6: Full suite + live verify + commit**

```bash
pytest -q 2>&1 | tee /tmp/phase2a-t8-green-full.txt
FRED_API_KEY=... EIA_API_KEY=... BLS_API_KEY=... FMP_API_KEY=... USDA_API_KEY=... \
  python -m pipeline.run_daily --store store --out /tmp/phase2a-t8-out 2>&1 | tee /tmp/phase2a-t8-live.txt
git add pipeline/connectors/mnd.py pipeline/collect.py config/series.json \
  tests/test_mnd.py tests/fixtures/mnd.html tests/test_run_daily.py tests/test_registry.py \
  store/obs/2026-07.jsonl
git commit -m "feat: MND 30yr daily rate scrape — CoL rate input ready"
```

Sanity: the MND rate and the latest `pmms_30yr` value should differ by <0.5pp — a bigger gap
means the regex grabbed the wrong number (points/APR instead of rate): stop and re-pin.

---

### Task 9: Manheim scrape + lead-days engine support

Used vehicles: Manheim's Used Vehicle Value Index (monthly publish, mid-month + full-month),
consumed with a +30 day lead shift — wholesale leads retail (spec §5). The shift is a pure
engine-side view driven by a new optional `lead_days` map on the basket component. **Store rows
keep true observation dates** (global constraint).

Known, accepted behavior: for a shifted source, the quality gate's `_arrived_today` check keys
on the SHIFTED obs date, which has no store row, so the gate never holds a Manheim point. The
gate protects daily scrape noise; a monthly index publish doesn't need it. Document this in the
task report — do not "fix" it.

**Files:**
- Create: `pipeline/connectors/manheim.py`, `pipeline/tests` fixtures `manheim.html`,
  `tests/test_manheim.py`
- Modify: `pipeline/engine/blend.py` (`shift_days`), `tests/test_blend.py`
- Modify: `pipeline/basket.py` (+`lead_days`), `tests/test_basket.py`
- Modify: `pipeline/engine/gauge.py` (apply shift when assembling live sources)
- Modify: `config/basket.json` (used_vehicles), `config/series.json` (MANHEIM + series)
- Modify: `pipeline/collect.py`, `tests/test_run_daily.py` (pins → 13), `tests/test_registry.py`

**Interfaces:**
- Consumes: the public Manheim UVVI publish page (Cox Automotive). Spike pins URL + fragment;
  the page shows the latest index value and its month.
- Produces: `manheim.fetch(vintage_date=None, http_get=None) -> list[Observation]` — one obs:
  `manheim_uvvi_m`, obs_date = first of the index's reference month, `source="MANHEIM"`,
  `route="SCRAPE"`. New pure fn `blend.shift_days(series: dict[str, float], days: int) ->
  dict[str, float]`. `basket.Component` gains `lead_days: dict[str, int] | None`; loader
  validates every `lead_days` key appears in `live_blend`.

- [ ] **Step 1: Access spike.** Pin the UVVI page URL, fragment, latest index value + month.
Fixture `tests/fixtures/manheim.html` (trimmed real markup).

- [ ] **Step 2: Failing tests — three files.**

`tests/test_blend.py` append:

```python
def test_shift_days_moves_dates_forward():
    s = {"2026-05-01": 200.0, "2026-06-01": 204.0}
    assert blend.shift_days(s, 30) == {"2026-05-31": 200.0, "2026-07-01": 204.0}


def test_shift_days_zero_is_identity():
    s = {"2026-05-01": 200.0}
    assert blend.shift_days(s, 0) == s
```

`tests/test_basket.py` append:

```python
def test_lead_days_parsed_and_validated(tmp_path):
    cfg = _minimal_basket_config()  # this file's existing helper for valid config dicts;
    # if none exists, copy the smallest valid config used by existing tests.
    cfg["components"][0]["live_blend"] = {"src_a": 1.0}
    cfg["components"][0]["live_variants"] = ["gauge"]
    cfg["components"][0]["lead_days"] = {"src_a": 30}
    p = tmp_path / "basket.json"
    p.write_text(json.dumps(cfg))
    _, comps = basket.load_basket(p)
    assert comps[0].lead_days == {"src_a": 30}


def test_lead_days_key_must_be_in_live_blend(tmp_path):
    cfg = _minimal_basket_config()
    cfg["components"][0]["live_blend"] = {"src_a": 1.0}
    cfg["components"][0]["live_variants"] = ["gauge"]
    cfg["components"][0]["lead_days"] = {"other_src": 30}
    p = tmp_path / "basket.json"
    p.write_text(json.dumps(cfg))
    try:
        basket.load_basket(p)
        assert False, "expected ValueError"
    except ValueError as e:
        assert "lead_days" in str(e)
```

`tests/test_manheim.py` (hard-code `EXPECTED_MONTH` to the fixture's real reference month):

```python
import pathlib
import re

from pipeline.connectors import manheim

FIXTURES = pathlib.Path(__file__).parent / "fixtures"
EXPECTED_MONTH = "<fixture's reference month>-01"  # e.g. "2026-06-01"


class FakeResponse:
    def __init__(self, text):
        self.text = text

    def raise_for_status(self):
        pass


def _fake_get_for(text):
    def fake_get(url, timeout=None):
        return FakeResponse(text)
    return fake_get


def test_fetch_extracts_latest_index_and_month():
    html = (FIXTURES / "manheim.html").read_text()
    obs = manheim.fetch(vintage_date="2026-07-10", http_get=_fake_get_for(html))
    assert len(obs) == 1
    o = obs[0]
    assert o.series_code == "manheim_uvvi_m"
    assert o.source == "MANHEIM" and o.route == "SCRAPE"
    assert o.obs_date == EXPECTED_MONTH
    assert o.vintage_date == "2026-07-10"
    assert 100.0 <= o.value <= 350.0  # tighten to == <fixture value> once recorded


def test_fetch_raises_on_structure_drift():
    try:
        manheim.fetch(vintage_date="2026-07-10",
                      http_get=_fake_get_for("<html><body>redesigned</body></html>"))
        assert False, "expected ValueError"
    except ValueError as e:
        assert "UVVI" in str(e)


def test_fetch_raises_on_implausible_value():
    html = (FIXTURES / "manheim.html").read_text()
    drifted = html.replace(_index_value(html), "999.9")
    try:
        manheim.fetch(vintage_date="2026-07-10", http_get=_fake_get_for(drifted))
        assert False, "expected ValueError"
    except ValueError as e:
        assert "implausible" in str(e)


def _index_value(html):
    return re.search(r"\d{3}\.\d", html).group(0)
```

(`_index_value`'s pattern must be tightened against the recorded fixture so it grabs the index
figure, not an unrelated number.)

- [ ] **Step 3: RED** — run all three:
`pytest tests/test_blend.py tests/test_basket.py tests/test_manheim.py -v 2>&1 | tee /tmp/phase2a-t9-red.txt`

- [ ] **Step 4: Implement.**

(a) `pipeline/engine/blend.py` append:

```python
def shift_days(series: dict[str, float], days: int) -> dict[str, float]:
    """Date-shift view of a series (config lead_days): wholesale sources that
    lead retail are read `days` later. A view over the store — stored
    observation dates are never rewritten."""
    if not days:
        return dict(series)
    from datetime import date, timedelta
    return {(date.fromisoformat(d) + timedelta(days=days)).isoformat(): v
            for d, v in series.items()}
```

(b) `pipeline/basket.py` — `Component` gains `lead_days: dict[str, int] | None`; the loader
gains `lead_days=c.get("lead_days")` and, in the validation loop:

```python
        if c.lead_days:
            unknown = set(c.lead_days) - set(c.live_blend or {})
            if unknown:
                raise ValueError(f"{c.code}: lead_days keys not in live_blend: "
                                 f"{sorted(unknown)}")
```

(c) `pipeline/engine/gauge.py` — import `blend as blend_mod` from `pipeline.engine`; where
live sources are assembled (currently
`live_sources = ({name: _series(conn, name) for name in comp.live_blend} ...)`), apply the
shift:

```python
            live_sources = ({name: blend_mod.shift_days(
                                 _series(conn, name),
                                 (comp.lead_days or {}).get(name, 0))
                             for name in comp.live_blend}
                            if comp.live_blend else {})
```

(d) `pipeline/connectors/manheim.py` — the Task-7 scrape pattern; the regex captures BOTH the
index value and the month name/year; obs_date derives from the month:

```python
"""Manheim Used Vehicle Value Index — monthly publish page scrape.

Wholesale leads retail: the engine reads this series shifted +30 days
(config/basket.json used_vehicles.lead_days), per spec §5. One observation
per run (the latest published month); monthly cadence accepted."""
import re
from datetime import datetime

import requests

from pipeline.connectors.fred import today_et
from pipeline.connectors.util import get_text
from pipeline.models import Observation

URL = "<UVVI publish page URL from spike>"
INDEX_RE = re.compile(r"<regex from spike capturing (value, month, year)>")
PLAUSIBLE = (100.0, 350.0)


def fetch(vintage_date: str | None = None, http_get=None) -> list[Observation]:
    http_get = http_get or requests.get
    vintage = vintage_date or today_et()
    html = get_text(URL, http_get)
    m = INDEX_RE.search(html)
    if not m:
        raise ValueError("Manheim page: UVVI value not found (structure drift?)")
    value = float(m.group(1))
    if not (PLAUSIBLE[0] <= value <= PLAUSIBLE[1]):
        raise ValueError(f"Manheim UVVI {value} implausible (range {PLAUSIBLE})")
    month = datetime.strptime(f"{m.group(2)} {m.group(3)}", "%B %Y")
    return [Observation(series_code="manheim_uvvi_m",
                        obs_date=month.strftime("%Y-%m-01"), value=value,
                        vintage_date=vintage, source="MANHEIM", route="SCRAPE")]
```

- [ ] **Step 5: GREEN** — same three files + `pytest tests/test_gauge.py -q` (shift wiring
must not break existing gauge tests; every existing component has no `lead_days`, so behavior
is identical — `shift_days(s, 0)` is an identity copy).

- [ ] **Step 6: Registry + config + wiring.** sources `"MANHEIM": {"route": "SCRAPE",
"cadence": "monthly"}`; series `{"code": "manheim_uvvi_m", "source": "MANHEIM", "source_id":
"uvvi", "name": "Manheim Used Vehicle Value Index", "max_staleness_days": 45}`. collect.py
`_manheim` + entry. `config/basket.json` used_vehicles becomes:

```json
{"code": "used_vehicles", "label": "Used vehicles", "weight": 0.021,
 "official_series": "CUUR0000SETA02",
 "live_blend": {"manheim_uvvi_m": 1.0},
 "lead_days": {"manheim_uvvi_m": 30},
 "live_variants": ["gauge"]}
```

(again: copy the existing entry's exact label). Fakes + pins 12→13.

- [ ] **Step 7: Full suite + live verify + commit**

```bash
pytest -q 2>&1 | tee /tmp/phase2a-t9-green-full.txt
FRED_API_KEY=... EIA_API_KEY=... BLS_API_KEY=... FMP_API_KEY=... USDA_API_KEY=... \
  python -m pipeline.run_daily --store store --out /tmp/phase2a-t9-out 2>&1 | tee /tmp/phase2a-t9-live.txt
git add pipeline/connectors/manheim.py pipeline/engine/blend.py pipeline/engine/gauge.py \
  pipeline/basket.py pipeline/collect.py config/basket.json config/series.json \
  tests/test_manheim.py tests/test_blend.py tests/test_basket.py tests/fixtures/manheim.html \
  tests/test_run_daily.py tests/test_registry.py store/obs/2026-07.jsonl
git commit -m "feat: Manheim UVVI scrape + config-driven lead-days shift — used_vehicles live"
```

Expected: 13/13 sources ok; used_vehicles row in gaptable flips to LIVE with a plausible YoY
(UVVI YoY typically within ±15%); gauge coverage +2.1pp. Record before/after in the report.

---

### Task 10: Grocery AP expansion — 6 → ~25 BLS average-price items

Decision locked in brainstorming: expand now so revision vintages accrue for the phase-5 cart
page. Item ids are NEVER invented: they are derived mechanically from BLS's published item
mapping, then pinned in the registry.

**Files:**
- Modify: `config/series.json` (+~19 BLS series)
- Modify: `pipeline/connectors/bls.py` (chunked requests — see Step 4)
- Modify: `tests/test_bls.py`, `tests/test_registry.py`, `tests/test_run_daily.py` (if it pins
  BLS series counts)
- Test evidence: derivation table in the task report

**Interfaces:**
- Consumes: BLS flat files `https://download.bls.gov/pub/time.series/ap/ap.item` (item code →
  name) and `ap.series` (which series exist). US city average AP series follow
  `APU0000<item_code>`.
- Produces: registry rows for the target items below (dropping any without a current
  US-city-average series; floor: ≥20 total AP items or stop and surface). Downstream: Task 14's
  grocery writer reads whatever AP series the registry carries — no hardcoded item list there.

**Target item list** (existing 6 marked ✓; resolve the rest via ap.item):
✓ eggs grade A dozen · ✓ milk whole gal · ✓ bread white lb · ✓ ground chuck lb ·
✓ chicken whole lb · ✓ bananas lb · flour white lb · rice white long-grain lb ·
spaghetti/macaroni lb · bread whole-wheat lb · chocolate-chip cookies lb ·
ground beef 100% lb · round steak lb · bacon sliced lb · pork chops center-cut lb ·
ham (boneless/whole per ap.item availability) · frankfurters lb · boneless chicken breast lb ·
tuna canned lb · butter lb · cheddar cheese lb · ice cream half-gal · apples red-delicious lb ·
oranges navel lb · potatoes white lb · lettuce iceberg lb · tomatoes field-grown lb ·
orange juice 12oz · sugar white lb · ground-roast coffee lb

- [ ] **Step 1: Derive ids.** Download `ap.item` + `ap.series` once (curl, not in tests);
for each target item grep its item code, confirm `APU0000<code>` exists in ap.series with
current data (`end_year` = current or last year), and build the derivation table
(name → item code → series id → last year) into the task report. Drop misses; floor ≥20.

- [ ] **Step 2: Failing chunking test** — `tests/test_bls.py` append (mirror the file's
existing fake_post pattern):

```python
def test_fetch_chunks_large_series_lists():
    """Keyless BLS v2 caps at 25 series/request — fetch must chunk."""
    calls = []

    def fake_post(url, json=None, timeout=None):
        calls.append(list(json["seriesid"]))
        return FakeResponse({"Results": {"series": [
            {"seriesID": sid, "data": []} for sid in json["seriesid"]]}})

    ids = [f"APU0000{i:06d}" for i in range(30)]
    bls.fetch(ids, api_key=None, http_post=fake_post)
    assert len(calls) == 2
    assert all(len(c) <= 25 for c in calls)
    assert [s for c in calls for s in c] == ids
```

- [ ] **Step 3: RED** — `pytest tests/test_bls.py -v 2>&1 | tee /tmp/phase2a-t10-red.txt`

- [ ] **Step 4: Implement chunking in `bls.py`** — wrap the existing request in a loop over
25-id chunks, concatenating results (the existing parse loop moves inside):

```python
CHUNK = 25  # keyless v2 request cap; registered cap is 50 — 25 is safe for both


def fetch(series_ids: list[str], api_key: str | None, start_year: str | None = None,
          vintage_date: str | None = None, http_post=None) -> list[Observation]:
    http_post = http_post or requests.post
    vintage = vintage_date or today_et()
    start_year = start_year or str(max(2017, int(today_et()[:4]) - 9))
    out: list[Observation] = []
    for i in range(0, len(series_ids), CHUNK):
        payload = {"seriesid": series_ids[i:i + CHUNK], "startyear": start_year,
                   "endyear": today_et()[:4]}
        if api_key:
            payload["registrationkey"] = api_key
        resp = http_post(BLS_URL, json=payload, timeout=60)
        resp.raise_for_status()
        for s in resp.json()["Results"]["series"]:
            for row in s["data"]:
                if not row["period"].startswith("M") or row["period"] == "M13":
                    continue
                if row["value"] == "-":  # BLS's missing-value marker (e.g. shutdown gaps)
                    continue
                out.append(Observation(
                    series_code=s["seriesID"],
                    obs_date=f"{row['year']}-{row['period'][1:]}-01",
                    value=float(row["value"]), vintage_date=vintage,
                    source="BLS", route="API"))
    return out
```

- [ ] **Step 5: GREEN + registry.** Suite green, then add one registry row per derived item:

```json
{"code": "APU0000<code>", "source": "BLS", "source_id": "APU0000<code>",
 "name": "Avg price: <short name>", "max_staleness_days": 80}
```

(same code=source_id convention and staleness as the existing six). Update count pins.

- [ ] **Step 6: Full suite + live collect + commit**

```bash
pytest -q 2>&1 | tee /tmp/phase2a-t10-green-full.txt
FRED_API_KEY=... EIA_API_KEY=... BLS_API_KEY=... FMP_API_KEY=... USDA_API_KEY=... \
  python -m pipeline.run_daily --store store --out /tmp/phase2a-t10-out 2>&1 | tee /tmp/phase2a-t10-live.txt
git add config/series.json pipeline/connectors/bls.py tests/test_bls.py \
  tests/test_registry.py tests/test_run_daily.py store/obs/2026-07.jsonl
git commit -m "feat: grocery AP basket expands to ~25 items (ids derived from ap.item)"
```

Expected: `source BLS: ok` with roughly `<n_items> × ~110 months` fetched; every new series
shows non-None `latest_obs` in sources_status. Any series fetching 0 rows → its id derivation
was wrong: fix or drop before committing.

---

### Task 11: Cost-of-Living payment machinery (engine-pure, no variant flip yet)

The marginal-buyer payment index and the `build_component` plumbing it needs. `VARIANTS` does
NOT change here — Task 12 flips everything atomically so writers/schemas/committed artifacts
never disagree mid-phase.

**Files:**
- Create: `pipeline/engine/payment.py`, `tests/test_payment.py`
- Modify: `pipeline/engine/variants.py` (`build_component` gains explicit `live_blend` param)
- Test: `tests/test_gauge.py` stays green (call sites use the default)

**Interfaces:**
- Consumes: store series `zhvi_us` (monthly $ level), `pmms_30yr` + `mnd_30y_d` (percent).
- Produces: `payment.payment_index(zhvi: dict[str, float], rate_pct: dict[str, float]) ->
  dict[str, float]` — for each rate observation date d (rate_pct is the PMMS∪MND union, MND
  winning date collisions): `L = 0.80 × (latest zhvi at or before d)`; `r = rate/100/12`;
  `P(d) = L·r·(1+r)^360 / ((1+r)^360 − 1)`. Dates before the first ZHVI obs are skipped.
  Also: `variants.build_component(comp, variant, official_series, live_sources,
  live_blend=None)` — `None` means `comp.live_blend` (all existing call sites unchanged).
  Task 12 passes an override for (col, shelter_owned).

- [ ] **Step 1: Hand-compute the fixture case** (show the arithmetic in the test docstring —
the reviewer re-derives it):
ZHVI 400,000 at 2026-01-01; rate 6.00% at 2026-02-01 → L = 320,000; r = 0.005;
(1.005)^360 = 6.022575…; P = 320000 × 0.005 × 6.022575 / 5.022575 = **1918.56** (±0.01).

- [ ] **Step 2: Write failing tests** — `tests/test_payment.py`:

```python
from pytest import approx

from pipeline.engine import payment


def test_payment_matches_hand_computed_case():
    """L=0.8*400000=320000, r=0.06/12=0.005, (1+r)^360=6.022575...,
    P = L*r*(1+r)^360/((1+r)^360-1) = 1918.56 (hand-derived; re-check it)."""
    zhvi = {"2026-01-01": 400000.0}
    rate = {"2026-02-01": 6.00}
    out = payment.payment_index(zhvi, rate)
    assert out == {"2026-02-01": approx(1918.56, abs=0.01)}


def test_payment_uses_latest_zhvi_at_or_before_each_rate_date():
    zhvi = {"2026-01-01": 400000.0, "2026-03-01": 410000.0}
    rate = {"2026-02-15": 6.00, "2026-03-02": 6.00}
    out = payment.payment_index(zhvi, rate)
    assert out["2026-02-15"] == approx(1918.56, abs=0.01)          # 400k home
    assert out["2026-03-02"] == approx(1918.56 * 410 / 400, abs=0.05)  # 410k home


def test_rate_dates_before_first_zhvi_are_skipped():
    zhvi = {"2026-01-01": 400000.0}
    rate = {"2025-12-31": 6.0, "2026-02-01": 6.0}
    out = payment.payment_index(zhvi, rate)
    assert "2025-12-31" not in out and "2026-02-01" in out


def test_zero_rate_falls_back_to_straight_line():
    zhvi = {"2026-01-01": 360000.0}
    rate = {"2026-02-01": 0.0}
    out = payment.payment_index(zhvi, rate)
    assert out["2026-02-01"] == approx(0.8 * 360000.0 / 360, abs=0.01)  # L/360
```

- [ ] **Step 3: RED** — `pytest tests/test_payment.py -v 2>&1 | tee /tmp/phase2a-t11-red.txt`

- [ ] **Step 4: Implement `pipeline/engine/payment.py`**

```python
"""Cost-of-Living owned shelter: the marginal buyer's monthly payment.

P = L*r*(1+r)^360 / ((1+r)^360 - 1), L = 0.80 * ZHVI, r = 30yr rate / 12
(spec §5 variant table). Pure function of two store series; the result is
rebased and spliced downstream exactly like any live source."""
from bisect import bisect_right

N = 360  # 30-year fixed, monthly payments
LTV = 0.80


def payment_index(zhvi: dict[str, float], rate_pct: dict[str, float]
                  ) -> dict[str, float]:
    if not zhvi:
        return {}
    z_dates = sorted(zhvi)
    out: dict[str, float] = {}
    for d in sorted(rate_pct):
        i = bisect_right(z_dates, d)
        if i == 0:
            continue  # no home value known yet
        loan = LTV * zhvi[z_dates[i - 1]]
        r = rate_pct[d] / 100.0 / 12.0
        if r == 0:
            out[d] = loan / N
            continue
        growth = (1 + r) ** N
        out[d] = loan * r * growth / (growth - 1)
    return out
```

- [ ] **Step 5: GREEN** — `pytest tests/test_payment.py -v 2>&1 | tee /tmp/phase2a-t11-green.txt`

- [ ] **Step 6: `build_component` explicit live_blend.** In `pipeline/engine/variants.py`:

```python
def build_component(comp: basket.Component, variant: str,
                    official_series: dict[str, float],
                    live_sources: dict[str, dict[str, float]],
                    live_blend: dict[str, float] | None = None
                    ) -> tuple[dict[str, float], str, dict[str, float]]:
    """Assemble one component's index for one variant.

    live_blend defaults to the component's configured blend; the CoL variant
    passes an override for shelter_owned (payment index, weight 1.0)."""
    official_idx = rebase_mod.rebase(official_series)
    blend_weights = comp.live_blend if live_blend is None else live_blend
    if variant in comp.live_variants and any(live_sources.values()):
        live = blend_mod.blend(
            {k: rebase_mod.rebase(v) for k, v in live_sources.items() if v},
            blend_weights)
        assembled = blend_mod.splice(official_idx, live)
        return rebase_mod.rebase(assembled), "live", official_idx
    return official_idx, "bls_cf", official_idx
```

- [ ] **Step 7: Full suite (no behavior change) + commit**

```bash
pytest -q 2>&1 | tee /tmp/phase2a-t11-green-full.txt
git add pipeline/engine/payment.py pipeline/engine/variants.py tests/test_payment.py
git commit -m "feat: CoL payment index + explicit-blend build_component (engine-pure)"
```

Expected: prior count + 4, zero regressions (default arg preserves every existing call).

---

### Task 12: Variants 2 → 5, end-to-end (engine + config + writers + schemas + regen)

One atomic task: the moment `VARIANTS` grows, every writer, schema, committed artifact, and the
methodology page must agree. Validation references per variant (decision from spec §9.7,
grading in compare stats only — `official.py` untouched):

| variant | graded against | store series |
|---|---|---|
| gauge, col, tracker | official CPI | `CPIAUCNS` (collected) |
| supercore | official core CPI | `CPILFENS` (collected) |
| pce | official PCE price index | `PCEPI` (NEW FRED registry row) |

**Files:**
- Modify: `pipeline/engine/variants.py` (VARIANTS), `pipeline/engine/gauge.py` (per-variant
  weights/subset/col override), `pipeline/basket.py` (+`pce_weight`,
  `load_supercore_components`), `config/basket.json`, `config/series.json` (+PCEPI),
  `pipeline/publish/compare.py` (per-variant grading refs), `pipeline/publish/gaptable.py`
  (variant summary block), `pipeline/publish/methodology.py` (VARIANTS prose ×5),
  `schemas/{compare,gauge_daily,gaptable,methodology}.schema.json`,
  `site/src/app/methodology/page.tsx` (validation chips ×5)
- Regenerate: `site/public/data/{compare,gauge_daily,gaptable,methodology}.json`
- Test: `tests/test_basket.py`, `tests/test_gauge.py`, `tests/test_compare.py`,
  `tests/test_gaptable.py`, `tests/test_run_daily.py`, `tests/test_registry.py`

**Interfaces:**
- Consumes: Task 11's `payment.payment_index` + `build_component(..., live_blend=)`; Task 1's
  `own_yoy_daily` (must exist on all five variants' components — it does, the loop is shared).
- Produces: `variants.VARIANTS = ("gauge", "col", "tracker", "supercore", "pce")`.
  `basket.Component.pce_weight: float`; `basket.load_supercore_components(path=None) ->
  tuple[str, ...]`. `gauge.run()` output unchanged in shape, now five variant keys, and each
  components entry's `"weight"` is the variant-effective weight. compare.json gains
  `col_yoy_pct`, `supercore_yoy_pct`, `pce_yoy_pct` columns + validation entries.

- [ ] **Step 1: Config seeds.** In `config/basket.json` add to EVERY component a `pce_weight`
(hand-seeded BEA-share approximations, **verified against the latest BEA underlying-detail
shares during this step — adjust if off by >0.02, keeping Σ=1.0**; document the check in the
report):

```
shelter_owned .105 · shelter_rent .050 · medical .170 · food_home .075 · food_away .065 ·
other .285 · education_comm .050 · recreation .085 · new_vehicles .025 · used_vehicles .012 ·
fuel .022 · electricity .020 · apparel .028 · nat_gas .008     (sums to 1.000 exactly)
```

Add top-level `"supercore_components": ["medical", "education_comm", "recreation", "other"]`
(services-ex-shelter approximation over our 14 coarse components — the honest caveat ships in
methodology prose, Step 7). Extend `live_variants`: shelter_owned/shelter_rent/used_vehicles/
food_home → `["gauge", "col", "pce"]` (food_home/used_vehicles only if their tasks went GO);
fuel/electricity/nat_gas → `["gauge", "tracker", "col", "pce"]`. Registry gains
`{"code": "PCEPI", "source": "FRED", "source_id": "PCEPI",
"name": "PCE price index (monthly, NSA)", "max_staleness_days": 80}`.

- [ ] **Step 2: Failing basket tests** — `tests/test_basket.py` append:

```python
def test_pce_weights_parsed_and_sum_to_one():
    _, comps = basket.load_basket()
    assert abs(sum(c.pce_weight for c in comps) - 1.0) <= 1e-9


def test_supercore_components_exist_in_basket():
    _, comps = basket.load_basket()
    codes = {c.code for c in comps}
    supercore = basket.load_supercore_components()
    assert supercore and set(supercore) <= codes


def test_pce_weights_must_sum_to_one(tmp_path):
    # corrupt one pce_weight in a copy of the real config; expect ValueError
    import json
    from pipeline.basket import DEFAULT_PATH
    cfg = json.loads(DEFAULT_PATH.read_text())
    cfg["components"][0]["pce_weight"] += 0.1
    p = tmp_path / "basket.json"
    p.write_text(json.dumps(cfg))
    try:
        basket.load_basket(p)
        assert False, "expected ValueError"
    except ValueError as e:
        assert "pce" in str(e).lower()
```

- [ ] **Step 3: RED** — `pytest tests/test_basket.py -v 2>&1 | tee /tmp/phase2a-t12-red-basket.txt`
(TypeError/KeyError on missing pce_weight, AttributeError on load_supercore_components).

- [ ] **Step 4: basket.py.** `Component` gains `pce_weight: float`; loader passes
`pce_weight=c["pce_weight"]` and validates:

```python
    pce_total = sum(c.pce_weight for c in comps)
    if abs(pce_total - 1.0) > 1e-9:
        raise ValueError(f"basket pce_weights sum to {pce_total}, expected 1.0")
```

and add:

```python
def load_supercore_components(path: Path | None = None) -> tuple[str, ...]:
    raw = json.loads((path or DEFAULT_PATH).read_text())
    supercore = tuple(raw["supercore_components"])
    codes = {c["code"] for c in raw["components"]}
    unknown = set(supercore) - codes
    if unknown:
        raise ValueError(f"supercore_components not in basket: {sorted(unknown)}")
    return supercore
```

- [ ] **Step 5: Failing engine tests** — `tests/test_gauge.py` append (adapt store-builder
names as in Task 1):

```python
def test_five_variants_published():
    conn = _store_with_two_years()
    result = gauge.run(conn, today="2026-07-01")
    assert set(result["variants"]) == {"gauge", "col", "tracker", "supercore", "pce"}


def test_supercore_is_renormalized_subset():
    conn = _store_with_two_years()
    result = gauge.run(conn, today="2026-07-01")
    sc = result["variants"]["supercore"]
    from pipeline import basket as basket_mod
    assert set(sc["components"]) == set(basket_mod.load_supercore_components())
    # headline() renormalizes by total weight; hand-check one date:
    # supercore index at as_of == sum(w_i * idx_i)/sum(w_i) over subset
    d = sc["as_of"]
    comps = sc["components"]
    manual = (sum(e["weight"] * e["daily_index"][d] for e in comps.values())
              / sum(e["weight"] for e in comps.values()))
    assert abs(sc["index"][d] - manual) < 1e-9


def test_pce_uses_pce_weights():
    conn = _store_with_two_years()
    result = gauge.run(conn, today="2026-07-01")
    from pipeline import basket as basket_mod
    _, comps = basket_mod.load_basket()
    pce_w = {c.code: c.pce_weight for c in comps}
    for code, entry in result["variants"]["pce"]["components"].items():
        assert entry["weight"] == pce_w[code]
```

(If the two-year fixture store lacks zhvi/rate series, `payment_series` comes back empty and
col's shelter_owned falls through to its configured market-rent blend — or to bls_cf when the
rent sources are absent too. Both are designed degradations; the tests above stay valid either
way. Note the exact fallback observed in the task report.)

- [ ] **Step 6: Engine.** `variants.py`: `VARIANTS = ("gauge", "col", "tracker", "supercore",
"pce")`. `gauge.py` `run()` restructure — replace the fixed `weights` and the variant loop
header with:

```python
    supercore = basket_mod.load_supercore_components(basket_path)
    payment_series: dict[str, float] | None = None
    out = {}
    for variant in variants.VARIANTS:
        comps_v = [c for c in comps
                   if variant != "supercore" or c.code in supercore]
        weights = {c.code: (c.pce_weight if variant == "pce" else c.weight)
                   for c in comps_v}
```

inside the component loop (which now iterates `comps_v`), add the col override before the
`build_component` call:

```python
            live_blend = None
            if variant == "col" and comp.code == "shelter_owned":
                if payment_series is None:
                    from pipeline.engine import payment as payment_mod
                    zhvi = _series(conn, "zhvi_us")
                    rate = {**_series(conn, "pmms_30yr"),
                            **_series(conn, "mnd_30y_d")}
                    payment_series = payment_mod.payment_index(zhvi, rate)
                if payment_series:
                    live_sources = {"col_payment": payment_series}
                    live_blend = {"col_payment": 1.0}
            idx, mode, official_idx = variants.build_component(
                comp, variant, official_series, live_sources, live_blend)
```

(move the `payment_mod` import to the module header with the other engine imports), coverage
renormalizes over the variant's own weights:

```python
        total_w = sum(weights.values())
        coverage = sum(weights[c.code] for c in comps_v
                       if modes[c.code] == "live"
                       and _fresh(conn, c.live_blend, staleness, today)) / total_w
```

and the per-component entry's `"weight"` becomes `weights[c.code]`. Everything else in the
loop body (built/daily/own_yoy/components) iterates `comps_v` unchanged. The `_fresh` guard
for col's shelter_owned override rides `c.live_blend` (zori/aptlist/redfin) — acceptable
proxy; note it in the report.

- [ ] **Step 7: Writers.** `compare.py` `build()`: grading reference per variant —

```python
GRADE_REF = {"gauge": "CPIAUCNS", "col": "CPIAUCNS", "tracker": "CPIAUCNS",
             "supercore": "CPILFENS", "pce": "PCEPI"}
```

the per-variant loop grades against `_official_yoy(conn, GRADE_REF[name])` (columns
`official_yoy_pct`/`official_core_yoy_pct` and lead_lag stay CPI-based as today; only the
`validation[name]` pairs switch reference). `methodology.py` VARIANTS grows to five honest
descriptions (col: marginal-buyer payment formula spelled out; supercore: "services-ex-shelter
approximation over coarse components — includes goods subcomponents"; pce: "same components
under hand-seeded BEA-share weights, graded vs PCEPI").

`gaptable.py` gains a variant summary block (the spec's "gaptable extends to 5 variants" —
the component decomposition stays gauge-only; variant-level cuts are what 2b's page chips
consume). In `build()`, after the rows loop:

```python
    variant_summary = {
        name: {"yoy_pct": _round(v["yoy"][v["as_of"]]),
               "as_of": v["as_of"],
               "coverage_pct": round(v["coverage_pct"], 2)}
        for name, v in gauge_result["variants"].items()}
```

and add `"variants": variant_summary` to the returned dict. Failing test first in
`tests/test_gaptable.py`: assert the payload's `variants` has all five keys and each carries
`yoy_pct`/`as_of`/`coverage_pct`.

- [ ] **Step 8: Schemas.** `compare.schema.json`: add `col_yoy_pct`, `supercore_yoy_pct`,
`pce_yoy_pct` (same nullable-number-array def as `tracker_yoy_pct`) and their validation
entries (mirror the existing per-variant validation def; add to `required` only if
gauge/tracker are required today — match existing strictness). `gauge_daily.schema.json`: if
variant keys are enumerated/required, extend to five. `methodology.schema.json`: variants
object → five required keys. `gaptable.schema.json`: add the required `variants` object (five
keys, each requiring `yoy_pct` nullable-number, `as_of` string, `coverage_pct` number).

- [ ] **Step 9: GREEN + regen + page.** Full suite; regenerate committed
`compare.json`/`gauge_daily.json`/`gaptable.json`/`methodology.json` from the committed store
(Task 1 Step 10 pattern, mirroring run_daily's exact build calls);
`site/src/app/methodology/page.tsx` validation section's list becomes
`(["gauge", "col", "tracker", "supercore", "pce"] as const)`; `npm run build` green.

- [ ] **Step 10: Evidence + commit.** Record in the report: all five variants' as-of YoY, and
tracker corr (must hold ≥ 0.95 — it shares no new machinery, but pin the evidence).

```bash
pytest -q 2>&1 | tee /tmp/phase2a-t12-green-full.txt
git add pipeline/engine/variants.py pipeline/engine/gauge.py pipeline/basket.py \
  config/basket.json config/series.json pipeline/publish/compare.py \
  pipeline/publish/gaptable.py pipeline/publish/methodology.py \
  schemas/compare.schema.json schemas/gauge_daily.schema.json \
  schemas/gaptable.schema.json schemas/methodology.schema.json \
  site/src/app/methodology/page.tsx site/public/data/compare.json \
  site/public/data/gauge_daily.json site/public/data/gaptable.json \
  site/public/data/methodology.json tests/test_basket.py tests/test_gauge.py \
  tests/test_compare.py tests/test_gaptable.py tests/test_run_daily.py tests/test_registry.py
git commit -m "feat: five variants — col/supercore/pce join gauge/tracker end-to-end"
```

---

### Task 13: Quilt writer — `quilt_months_{24,48,all}.json`

Month × component YoY heat grid (ours + official per cell) feeding 2b's `QuiltHeatmap`. Pure
re-cut of Task 1's own-YoY series sampled at month ends — no conn, no new math.

**Files:**
- Create: `pipeline/publish/quilt.py`, `schemas/quilt.schema.json`, `tests/test_quilt.py`
- Modify: `pipeline/run_daily.py` (wire after the replay block)
- Modify: `tests/test_run_daily.py` (published-file assertions)

**Interfaces:**
- Consumes: `gauge_result["variants"]["gauge"]` components' `own_yoy_daily` /
  `official_own_yoy_daily` (Task 1) + `index` dates.
- Produces: `quilt.build(gauge_result, comps) -> dict` with `months: [YYYY-MM…]` (from
  PUBLISH_START) and `components: [{code, label, weight, ours_yoy_pct: [...],
  official_yoy_pct: [...]}]` (nullable, 2dp, aligned to months);
  `quilt.write(payload, out_dir, published_at) -> list[Path]` emitting the three window files
  (24 / 48 / all trailing months — same schema, `window_months: 24|48|null`).

- [ ] **Step 1: Failing tests** — `tests/test_quilt.py` (reuse test_replay.py's fake
gauge-result builder pattern; the fake needs ≥ 26 months of daily dates so the 24-window
slices differently from `all`):

```python
def test_build_samples_month_ends():
    payload = quilt.build(_fake_gauge_result(), _fake_comps())
    assert payload["months"] == sorted(payload["months"])
    assert payload["months"][0] >= "2018-01"
    for comp in payload["components"]:
        assert len(comp["ours_yoy_pct"]) == len(payload["months"])
        assert len(comp["official_yoy_pct"]) == len(payload["months"])


def test_write_emits_three_windows(tmp_path):
    payload = quilt.build(_fake_gauge_result(), _fake_comps())
    paths = quilt.write(payload, tmp_path, published_at="2026-07-10T00:00:00Z")
    names = sorted(p.name for p in paths)
    assert names == ["quilt_months_24.json", "quilt_months_48.json",
                     "quilt_months_all.json"]
    import json
    p24 = json.loads((tmp_path / "quilt_months_24.json").read_text())
    pall = json.loads((tmp_path / "quilt_months_all.json").read_text())
    assert p24["window_months"] == 24 and pall["window_months"] is None
    assert len(p24["months"]) == min(24, len(pall["months"]))
    assert p24["months"] == pall["months"][-len(p24["months"]):]
    assert all(len(c["ours_yoy_pct"]) == len(p24["months"])
               for c in p24["components"])
```

- [ ] **Step 2: RED** — `pytest tests/test_quilt.py -v 2>&1 | tee /tmp/phase2a-t13-red.txt`

- [ ] **Step 3: Implement `pipeline/publish/quilt.py`**

```python
"""Writer for quilt_months_{24,48,all}.json — month x component YoY heat grid.

Ours = each component's own-observation YoY (like-month honest, Task 1's
series) sampled at month end; official = the component's BLS YoY sampled the
same way. Three window files share one schema; the 2b QuiltHeatmap renders
them directly."""
import json
from pathlib import Path

from pipeline.engine.gauge import PUBLISH_START

WINDOWS = {"quilt_months_24.json": 24, "quilt_months_48.json": 48,
           "quilt_months_all.json": None}


def _month_ends(dates: list[str]) -> list[tuple[str, str]]:
    """(month, last grid date in month) pairs, ascending."""
    out: list[tuple[str, str]] = []
    for d in dates:
        m = d[:7]
        if out and out[-1][0] == m:
            out[-1] = (m, d)
        else:
            out.append((m, d))
    return out


def _sample(series: dict, ends: list[tuple[str, str]]) -> list:
    return [None if series.get(d) is None else round(series[d], 2)
            for _, d in ends]


def build(gauge_result: dict, comps) -> dict:
    g = gauge_result["variants"]["gauge"]
    dates = [d for d in sorted(g["index"]) if d >= PUBLISH_START]
    ends = _month_ends(dates)
    components = []
    for comp in comps:
        e = g["components"][comp.code]
        components.append({
            "code": comp.code, "label": comp.label, "weight": comp.weight,
            "ours_yoy_pct": _sample(e["own_yoy_daily"], ends),
            "official_yoy_pct": _sample(e["official_own_yoy_daily"], ends)})
    return {"rebase": f"{gauge_result['base_month']}=100",
            "months": [m for m, _ in ends], "components": components}


def write(payload: dict, out_dir: Path, published_at: str) -> list[Path]:
    out_dir.mkdir(parents=True, exist_ok=True)
    paths = []
    for name, window in WINDOWS.items():
        n = len(payload["months"]) if window is None else min(window,
                                                              len(payload["months"]))
        sliced = {"published_at": published_at, "window_months": window,
                  "rebase": payload["rebase"],
                  "months": payload["months"][-n:],
                  "components": [{**c,
                                  "ours_yoy_pct": c["ours_yoy_pct"][-n:],
                                  "official_yoy_pct": c["official_yoy_pct"][-n:]}
                                 for c in payload["components"]]}
        path = out_dir / name
        path.write_text(json.dumps(sliced, separators=(",", ":")) + "\n")
        paths.append(path)
    return paths
```

- [ ] **Step 4: Schema `schemas/quilt.schema.json`** — require `published_at`,
`window_months` (`["integer","null"]`), `rebase`, `months` (array of `^\d{4}-\d{2}$` strings),
`components` (items requiring code/label/weight/ours_yoy_pct/official_yoy_pct, the two arrays
nullable-number items). Mirror the strictness conventions of `replay.schema.json`
(additionalProperties etc. — copy whatever stance that file takes).

- [ ] **Step 5: Wire `run_daily.py`** — inside the try block, directly after the replay
publish/validate/print trio:

```python
        quilt_paths = quilt.write(quilt.build(gauge_result, comps), args.out,
                                  published_at=published_at)
        for qp in quilt_paths:
            validate.validate_file(qp, SCHEMAS / "quilt.schema.json")
            print(f"published: {qp}")
```

(add `quilt` to the `pipeline.publish` import list). Extend `tests/test_run_daily.py`'s
published-file assertions to include the three quilt files.

- [ ] **Step 6: GREEN + commit**

```bash
pytest -q 2>&1 | tee /tmp/phase2a-t13-green.txt
git add pipeline/publish/quilt.py schemas/quilt.schema.json pipeline/run_daily.py \
  tests/test_quilt.py tests/test_run_daily.py
git commit -m "feat: quilt writer — month x component YoY grids (24/48/all)"
```

(Committed-data regen for the quilt files happens once, in Task 16's republish.)

---

### Task 14: Grocery writer — `grocery_basket.json`

**Files:**
- Create: `pipeline/publish/grocery.py`, `schemas/grocery_basket.schema.json`,
  `tests/test_grocery.py`
- Modify: `pipeline/run_daily.py` (wire after the quilt block), `tests/test_run_daily.py`

**Interfaces:**
- Consumes: registry `series` list (AP items are `source == "BLS"` with code prefix `APU`);
  `official.component_summary(conn, code) -> {"code", "month", "yoy_pct", "mom_pct"}`
  (raises ValueError when a series lacks YoY+MoM-computable months); `vintage.latest`.
- Produces: `grocery.build(conn, series) -> dict` —
  `{"as_of": max item month, "items": [{code, name, month, price, mom_pct, yoy_pct}...],
  "skipped": [codes]}` sorted by name; `grocery.write(payload, out_dir, published_at) -> Path`.
  run_daily passes `len(items)`/`len(skipped)` to QA (Task 15).

- [ ] **Step 1: Failing tests** — `tests/test_grocery.py` (build a tiny store via
`vintage.append` + `vintage.load` into tmp_path, the pattern test_official.py uses):

```python
def test_build_prices_changes_and_sorting(tmp_path):
    conn = _store_with(tmp_path, {
        "APU0000708111": {"2025-06-01": 2.50, "2026-05-01": 3.90, "2026-06-01": 4.00},
        "APU0000709112": {"2025-06-01": 4.00, "2026-05-01": 4.10, "2026-06-01": 4.20},
    })
    series = [_series_row("APU0000708111", "Avg price: eggs, grade A, dozen"),
              _series_row("APU0000709112", "Avg price: milk, whole, gallon")]
    payload = grocery.build(conn, series)
    assert [i["code"] for i in payload["items"]] == ["APU0000708111", "APU0000709112"]
    eggs = payload["items"][0]
    assert eggs["price"] == 4.00 and eggs["month"] == "2026-06-01"
    assert eggs["yoy_pct"] == round((4.00 / 2.50 - 1) * 100, 2)
    assert eggs["mom_pct"] == round((4.00 / 4.00 - 1) * 100, 2) or eggs["mom_pct"] == 2.5
    # ^ derive the exact expected mom from the fixture values you choose — hand-compute
    assert payload["skipped"] == []
    assert payload["as_of"] == "2026-06-01"


def test_series_without_yoy_base_is_skipped_not_fatal(tmp_path):
    conn = _store_with(tmp_path, {"APU0000711211": {"2026-06-01": 0.62}})
    payload = grocery.build(conn, [_series_row("APU0000711211", "Avg price: bananas, lb")])
    assert payload["items"] == [] and payload["skipped"] == ["APU0000711211"]


def test_non_ap_series_ignored(tmp_path):
    conn = _store_with(tmp_path, {"CPIAUCNS": {"2026-06-01": 320.0}})
    payload = grocery.build(conn, [_series_row("CPIAUCNS", "CPI-U all items (NSA)")])
    assert payload["items"] == [] and payload["skipped"] == []
```

Write the `_store_with` / `_series_row` helpers in this file (Observation rows with
vintage_date "2026-07-01", `registry.Series(code, "BLS", code, name, 80)`), fixing the eggs
fixture so mom/yoy are clean hand-computed numbers.

- [ ] **Step 2: RED** — `pytest tests/test_grocery.py -v 2>&1 | tee /tmp/phase2a-t14-red.txt`

- [ ] **Step 3: Implement `pipeline/publish/grocery.py`**

```python
"""Writer for grocery_basket.json — BLS average-price staples (~25 items).

Price + m/m + y/y per item off the latest computable month. Items whose YoY
base is missing (new series, shutdown holes) are skipped and listed — the
grocery card never shows a fake change."""
import json
from pathlib import Path

from pipeline.engine import official
from pipeline.store import vintage


def build(conn, series) -> dict:
    items, skipped = [], []
    for s in series:
        if s.source != "BLS" or not s.code.startswith("APU"):
            continue
        try:
            summary = official.component_summary(conn, s.code)
        except ValueError:
            skipped.append(s.code)
            continue
        month = summary["month"]
        price = dict(vintage.latest(conn, s.code))[month]
        items.append({"code": s.code, "name": s.name, "month": month,
                      "price": round(price, 3),
                      "mom_pct": round(summary["mom_pct"], 2),
                      "yoy_pct": round(summary["yoy_pct"], 2)})
    items.sort(key=lambda i: i["name"])
    return {"as_of": max((i["month"] for i in items), default=None),
            "items": items, "skipped": sorted(skipped)}


def write(payload: dict, out_dir: Path, published_at: str) -> Path:
    out_dir.mkdir(parents=True, exist_ok=True)
    path = out_dir / "grocery_basket.json"
    path.write_text(json.dumps({"published_at": published_at, **payload},
                               indent=2) + "\n")
    return path
```

- [ ] **Step 4: Schema** — `schemas/grocery_basket.schema.json`: require published_at, as_of
(`["string","null"]`), items (item objects requiring code/name/month/price/mom_pct/yoy_pct),
skipped (string array). Same strictness conventions as the other schemas.

- [ ] **Step 5: Wire run_daily** after the quilt block:

```python
        grocery_payload = grocery.build(conn, series)
        gr_path = grocery.write(grocery_payload, args.out,
                                published_at=published_at)
        validate.validate_file(gr_path, SCHEMAS / "grocery_basket.schema.json")
        print(f"published: {gr_path} ({len(grocery_payload['items'])} items, "
              f"{len(grocery_payload['skipped'])} skipped)")
```

Extend test_run_daily published-file assertions (now 13 files total).

- [ ] **Step 6: GREEN + commit**

```bash
pytest -q 2>&1 | tee /tmp/phase2a-t14-green.txt
git add pipeline/publish/grocery.py schemas/grocery_basket.schema.json pipeline/run_daily.py \
  tests/test_grocery.py tests/test_run_daily.py
git commit -m "feat: grocery_basket writer — AP staples with honest m/m + y/y"
```

---

### Task 15: QA growth — fuel divergence, artifact checks, coverage floor

**Files:**
- Modify: `pipeline/publish/qa.py`, `pipeline/run_daily.py`, `tests/test_qa.py`,
  `tests/test_run_daily.py`, `schemas/qa.schema.json` (only if it pins check counts)

**Interfaces:**
- Consumes: store series `aaa_gas_d` (daily $) and `eia_gasreg_w` (weekly $) via
  `vintage.latest`; Task 14's `grocery_payload`; Task 13's quilt payload months length.
- Produces: `qa.run_checks(..., fuel_divergence: dict | None = None,
  artifacts: dict | None = None)` adding checks `fuel_sources_agree` (non-critical; pass when
  relative divergence ≤ 7.5% or when either source lacks data — detail says which),
  `quilt_complete` (non-critical; months ≥ 24 and all component arrays aligned),
  `grocery_items` (non-critical; ≥ 20 items). `gauge_coverage` floor moves 35 → **45 if
  food_home went live in Task 6, else 40** (state which in the detail string).

- [ ] **Step 1: Failing tests** — `tests/test_qa.py` append (mirror this file's existing
run_checks-call pattern for the cpi/gauge args):

```python
def test_fuel_divergence_check_passes_within_band():
    result = qa.run_checks(_cpi(), today="2026-07-10",
                           fuel_divergence={"aaa_wk_avg": 3.10, "eia": 3.05,
                                            "rel": abs(3.10 / 3.05 - 1)})
    check = _by_name(result, "fuel_sources_agree")
    assert check["pass"] is True


def test_fuel_divergence_check_fails_beyond_band():
    result = qa.run_checks(_cpi(), today="2026-07-10",
                           fuel_divergence={"aaa_wk_avg": 3.60, "eia": 3.00,
                                            "rel": 0.20})
    assert _by_name(result, "fuel_sources_agree")["pass"] is False


def test_fuel_divergence_absent_sources_pass_with_detail():
    result = qa.run_checks(_cpi(), today="2026-07-10", fuel_divergence=None)
    assert _by_name(result, "fuel_sources_agree") is None  # check only added when computed


def test_artifact_checks():
    result = qa.run_checks(_cpi(), today="2026-07-10",
                           artifacts={"quilt_months": 30, "grocery_items": 24,
                                      "grocery_skipped": 1})
    assert _by_name(result, "quilt_complete")["pass"] is True
    assert _by_name(result, "grocery_items")["pass"] is True
```

(`_by_name` helper: `next((c for c in result["checks"] if c["name"] == name), None)` — add it
and `_cpi()` if the file lacks equivalents; reuse existing ones if present.)

- [ ] **Step 2: RED**, **Step 3: implement** in `qa.run_checks` (new params, checks appended
after `sources_fresh`; divergence band constant `FUEL_DIVERGENCE_MAX = 0.075`); coverage floor
per the interface note. **Step 4: run_daily** computes and passes both:

```python
    fuel_div = None
    aaa_rows = vintage.latest(conn, "aaa_gas_d")
    eia_rows = vintage.latest(conn, "eia_gasreg_w")
    if aaa_rows and eia_rows:
        week = [v for d, v in aaa_rows[-7:]]
        aaa_avg, eia_last = sum(week) / len(week), eia_rows[-1][1]
        fuel_div = {"aaa_wk_avg": round(aaa_avg, 3), "eia": round(eia_last, 3),
                    "rel": abs(aaa_avg / eia_last - 1)}
```

(placed with the freshness block, outside the engine try — reads only the store) and
`artifacts={"quilt_months": ..., "grocery_items": ..., "grocery_skipped": ...}` built inside
the try next to `gauge_qa` (None when the engine failed — run_checks must tolerate that, same
as `gauge=None`).

- [ ] **Step 5: GREEN + commit**

```bash
pytest -q 2>&1 | tee /tmp/phase2a-t15-green.txt
git add pipeline/publish/qa.py pipeline/run_daily.py tests/test_qa.py tests/test_run_daily.py
git commit -m "feat: QA growth — fuel cross-check, quilt/grocery checks, coverage floor re-pin"
```

---

### Task 16: Integration republish + docs

The 1c-Task-8 pattern: one real local run publishes all 13 files into `site/public/data/`,
contract tests pin them, docs match reality.

**Files:**
- Modify: `site/public/data/*` (all 14, republished), `tests/test_published_data.py`
  (parametrize grows to all 13 files; add quilt/grocery cross-checks), `CLAUDE.md`,
  `store/obs/2026-07.jsonl`

- [ ] **Step 1: Extend contract tests.** `tests/test_published_data.py`: the parametrized
existence+schema check covers all 14 published names (quilt ×3, grocery_basket added). Add two
invariants: every quilt file's per-component array lengths equal its months length; grocery
items ≥ 20 with no nulls in price. RED first (files absent) is expected — that's Step 2.

- [ ] **Step 2: Real run**

```bash
FRED_API_KEY=... EIA_API_KEY=... BLS_API_KEY=... FMP_API_KEY=... USDA_API_KEY=... \
  python -m pipeline.run_daily --store store --out site/public/data 2>&1 | tee /tmp/phase2a-t16-run.txt
pytest -q 2>&1 | tee /tmp/phase2a-t16-green.txt
cd site && npm run build && cd ..
```

Expected: 13 `published:` lines, qa n/n with the new checks green, suite green, site build
green. `git status` on `site/public/data/` shows the four new files plus refreshed existing
ones; `git diff store/` appends-only.

- [ ] **Step 3: Secrets sweep + docs.**
`grep -rE "(api_key|apikey|registrationkey)=[A-Za-z0-9]" site/public/data/` must be empty.
Update `CLAUDE.md`: published files 9 → 13 (add quilt ×3 + grocery), sources 7 → 13, test
count, and add one line to Architecture §1 noting scrape connectors' regex+range drift
protection. Update the daily-run bullet only if wording drifted.

- [ ] **Step 4: Commit**

```bash
git add site/public/data tests/test_published_data.py CLAUDE.md store/obs/2026-07.jsonl
git commit -m "data: 2a republish — 13 files live (quilt x3, grocery, 5 variants)"
```

---

### Task 17: Live degradation drill (exit criterion)

Prove a dead scrape degrades, never crashes. Run against a COPY of the store with the scrape
series' history stripped (so fallback is visible, not masked by carry-forward) and an
http_get that refuses scrape domains.

**Files:**
- Create: `scripts/drill_scrapes.py` (kept — the drill is repeatable ops tooling)
- Evidence: `/tmp/phase2a-t17-drill.txt` teed output in the task report

- [ ] **Step 1: Write `scripts/drill_scrapes.py`**

```python
"""Scrape-failure drill (spec 2a §7): run the daily pipeline with every scrape
domain refusing connections AND scrape history stripped from a store COPY.
Asserts graceful degradation; never touches the real store or site data.

    FRED_API_KEY=... EIA_API_KEY=... BLS_API_KEY=... FMP_API_KEY=... USDA_API_KEY=... \
        python scripts/drill_scrapes.py
"""
import json
import shutil
import sys
import tempfile
from pathlib import Path

import requests

from pipeline import run_daily

SCRAPE_DOMAINS = ("gasprices.aaa.com", "mortgagenewsdaily.com", "manheim.com")
SCRAPE_SERIES = {"aaa_gas_d", "mnd_30y_d", "manheim_uvvi_m"}


def blocking_get(url, **kw):
    if any(d in url for d in SCRAPE_DOMAINS):
        raise requests.ConnectionError(f"drill: blocked {url}")
    return requests.get(url, **kw)


def main() -> int:
    tmp = Path(tempfile.mkdtemp(prefix="drill-"))
    store, out = tmp / "store", tmp / "out"
    shutil.copytree("store", store)
    for part in (store / "obs").glob("*.jsonl"):
        rows = [ln for ln in part.read_text().splitlines()
                if json.loads(ln)["series_code"] not in SCRAPE_SERIES]
        part.write_text("\n".join(rows) + ("\n" if rows else ""))
    rc = run_daily.main(["--store", str(store), "--out", str(out)],
                        http_get=blocking_get)
    status = json.loads((out / "sources_status.json").read_text())
    qa = json.loads((out / "qa.json").read_text())
    failed = {s["source"] for s in status["sources"] if not s["ok"]}
    assert rc == 0, f"run failed rc={rc}"
    assert {"AAA", "MND", "MANHEIM"} <= failed, f"expected scrape failures, got {failed}"
    published = sorted(p.name for p in out.glob("*.json"))
    assert len(published) == 13, f"expected 13 files, got {len(published)}: {published}"
    engine_ok = next(c for c in qa["checks"] if c["name"] == "engine_ok")
    assert engine_ok["pass"], engine_ok
    print(f"DRILL PASS — failures surfaced: {sorted(failed)}; "
          f"13 files published; qa {qa['passed']}/{qa['total']}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
```

(Adjust the `status["sources"]` field names to sources_status.json's real shape — check the
committed file — and the MANHEIM domain string to the URL pinned in Task 9's spike.)

- [ ] **Step 2: Run it**

```bash
FRED_API_KEY=... EIA_API_KEY=... BLS_API_KEY=... FMP_API_KEY=... USDA_API_KEY=... \
  python scripts/drill_scrapes.py 2>&1 | tee /tmp/phase2a-t17-drill.txt
```

Expected: `DRILL PASS`. In the teed output also verify by eye and quote in the report: fuel
mode stays `live` (EIA leg), used_vehicles mode falls to `bls_cf`, coverage ≈ 2.1pp below
Task 16's, gate never fired, qa's `connectors_ok` detail names the three.

- [ ] **Step 3: Commit**

```bash
git add scripts/drill_scrapes.py
git commit -m "test: scrape-failure drill — degradation proven live (2a exit criterion)"
```

---

### Task 18: Ship (controller-only)

- [ ] Full suite + site build one final time; record counts.
- [ ] `git fetch origin && git rebase origin/main` — expect `data: daily publish` bot commits;
  store JSONL conflicts resolve by union (bot rows first), published artifacts take our side,
  re-run the full suite after.
- [ ] Confirm with the user: USDA_API_KEY repo secret added; then push (explicit user approval
  required — push = production deploy).
- [ ] Watch CI (both jobs) green; verify the Vercel production deploy goes READY; eyeball
  /methodology (5 variants, phase-in gone for landed sources) and the homepage treemap final
  frame in a real browser.
- [ ] Next-morning check: the scheduled run publishes 13 files unattended with the new
  connectors (the widened gate from fdeb164 should hold — verify).
- [ ] Controller updates `.superpowers/sdd/progress.md` + project memory (phase status, new
  coverage %, any deviations e.g. USDA NO-GO).

---

## Execution notes

- **Order is load-bearing** (Approach A): 1-2-3 (entry) → 4-5 (CSVs) → 6 (USDA, spike-gated) →
  7-8-9 (scrapes) → 10 (grocery data) → 11-12 (variants) → 13-14-15 (writers/QA) → 16-17-18.
  Task 6 NO-GO skips its config flip and adjusts Task 12's live_variants and Task 15's floor —
  the deviation must be threaded through those tasks' briefs by the controller.
- **Live-run steps in connector tasks touch the real store** — that is by design (the store is
  append-only and its growth is the phase's deliverable); the drill (Task 17) is the only step
  that must NOT.
- Daily bot commits will land mid-phase: rebase early and often, union-merge store JSONL.
