# P4 — Long-Lead Equipment Board Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Publish `longlead.json` (36th artifact) — five long-lead packages joining the PPI YoY we already publish with each vendor's own stated order-book figures — rendered as a new `/longlead` page plus a teaser strip on `/datacenter`.

**Architecture:** Hand-curated `config/dc_longlead.json` (stated-only figures, verbatim quotes, primary-source URLs) → fail-loud loader `pipeline/dc_longlead.py` → pure publisher `pipeline/publish/longlead.py` → a twelfth isolated `run_daily` phase (`longlead_ok`). No connector, no registry change, no store series, no network. Site renders the artifact statically.

**Tech Stack:** Python 3.12 pipeline (stdlib only), pytest, JSON Schema draft 2020-12, Next.js static export (TypeScript), vitest, Playwright.

**Spec:** `docs/superpowers/specs/2026-07-26-dc-longlead-board-design.md` (approved 2026-07-26). The spec's §2 recon tables are the evidence base; §3 decisions are locked.

## Global Constraints

- Branch: `feat/dc-longlead` (already exists; the spec is its first commit). Do NOT `git push` — production deploy is user-gated.
- Run tests from the repo root with `.venv/bin/pytest -q` (system python3 is 3.9 and cannot import the pipeline). Baseline: **813 collected**. Every task ends with the full suite green at ≥ its predecessor's count.
- **Stated-only is the load-bearing rule.** No derived book-to-bill, no derived YoY, no summed backlogs, no cross-basis arithmetic — the only arithmetic touching this feature is the price-leg contribution (`weight × yoy_pct`, the exact rule `pipeline/publish/datacenter.py` uses) and the staleness age.
- **No hand-curated value enters `config/dc_longlead.json` except from Task 1's SPIKE-FINAL notes.** `<SPIKE>` markers in this plan mean "transcribe from the spike notes verbatim" — never invent, never copy from this plan's prose or the spec's recon tables (those are the *checklist*, not the source).
- Every schema field that can degrade is REQUIRED but nullable (`["number", "null"]` etc.) — a `longlead_ok:false`-adjacent degraded payload must validate without inventing values (the `dc_grades.schema.json` pattern).
- HTTP is injected, never real, in tests. This feature adds NO network anywhere: pipeline tests are pure functions + tmp configs.
- TDD with verbatim `tee` evidence to `/private/tmp/claude-501/-Users-ericwyluda-Development-macrogauge/1ee235e4-b91d-40b9-adbc-c2e9ee552844/scratchpad/task<N>-<red|green>.log`. Reviewers run forensic checks (pytest header/rootdir/percent consistency); report only observed numbers.
- Site: `npm run build` MUST run before `npm run e2e` — Playwright serves the static export in `site/out/` (`npx serve -l 4173 out`), not the dev server.
- Do NOT edit `.superpowers/sdd/progress.md`. Commits end with:
  `Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>`

## File Structure

```
config/dc_longlead.json                 create  hand-curated packages/vendors/figures/teaser (Task 2)
pipeline/dc_longlead.py                 create  fail-loud loader, frozen dataclasses (Task 2)
pipeline/publish/longlead.py            create  pure build()/write(), staleness, price join (Task 3)
schemas/longlead.schema.json            create  draft 2020-12, degradable-nullable (Task 3)
pipeline/run_daily.py                   modify  imports + _longlead_phase + docstring roster (Task 4)
pipeline/publish/qa.py                  modify  PHASES + _PHASE_DONE gain "longlead" (Task 4)
tests/test_dc_longlead.py               create  loader tests (Task 2)
tests/test_longlead_publish.py          create  publisher tests (Task 3)
tests/test_run_daily.py                 modify  e2e artifact + qa pins + 2 new tests (Task 4)
site/public/data/longlead.json          create  generated from committed store (Task 4, final step)
site/src/lib/types.ts                   modify  LongLead* types (Task 5)
site/src/lib/longLead.ts                create  fmtFigure + label maps (Task 5)
site/src/lib/longLead.test.ts           create  vitest for the helper (Task 5)
site/src/app/longlead/page.tsx          create  the board page, server component (Task 5)
site/src/lib/nav.ts                     modify  AI Infra gains /longlead (Task 5)
site/e2e/smoke.spec.ts                  modify  +1 route, +1 feature test (Tasks 5, 6)
site/src/components/LongLeadStrip.tsx   create  /datacenter teaser (Task 6)
site/src/app/datacenter/page.tsx        modify  import + render strip (Task 6)
site/src/app/globals.css                modify  one .strip-row rule (Task 6)
CLAUDE.md                               modify  counts: 36 files, twelve phases, routes/tests (Task 7)
docs/plans/2026-07-24-project-controls-gaps.md  modify  P4 status + premise correction (Task 7)
docs/superpowers/specs/2026-07-26-dc-longlead-spike-notes.md  create  SPIKE-FINAL (Task 1)
```

---

### Task 1 (SPIKE — live network, evidence-first): re-verify every vendor figure + pin citation URLs

**Files:**
- Create: `docs/superpowers/specs/2026-07-26-dc-longlead-spike-notes.md`

**Interfaces:**
- Produces: a SPIKE-FINAL section with config-ready values (value, unit, period, asof, verbatim quote, src label + URL, basis, scope) per vendor figure, plus null verdicts for Cummins and pumps. Task 2 transcribes SPIKE-FINAL verbatim; every downstream task treats it as authoritative.

Recon (2026-07-26, spec §2.3) produced candidate figures + URLs. The spike's job is to RE-FETCH each primary source and record what the document actually says, teeing raw output. If a fetch disagrees with the recon table, the fetch wins — note the discrepancy.

- [ ] **Step 1: GE Vernova.** Fetch `https://www.sec.gov/Archives/edgar/data/1996810/000199681026000147/gevpressrelease2q26.htm` (Q2 2026 8-K press release). Record: group backlog $ (footnote defines backlog ≡ RPO → `basis: "rpo"`, `scope: "group"`), the backlog footnote text, Electrification book-to-bill (~1.7, `scope: "segment"`), period (2026-06-30), release date (asof), verbatim quotes. Expected magnitudes to confirm: backlog ~$176B.
- [ ] **Step 2: Vertiv.** Fetch `https://www.sec.gov/Archives/edgar/data/1674101/000167410126000006/exhibit991vrt02112026.htm` (Q4 2025 8-K exhibit). Record: backlog $ (~$15.0B, `basis: "order-backlog"`, `scope: "group"`), book-to-bill (~2.9x), period 2025-12-31, release date 2026-02-11, verbatim sentence. Also check whether a Q1/Q2-2026 release has superseded it (search SEC EDGAR full-text or vertiv.com IR) — if yes, use the NEWEST and record both URLs.
- [ ] **Step 3: ABB.** Stable entry point `https://new.abb.com/news/detail/135137/q1-2026-results` and the newest quarterly results page (Q2 2026 was published before 2026-07-26 — find its news-center page). Record: Electrification order backlog $ (`basis: "order-backlog"`, `scope: "segment"`; Q2: $13,676M vs $8,685M +57%), group book-to-bill if stated (Q1 CEO: 1.29), the note defining order backlog as unsatisfied performance obligations, periods + release dates, verbatim quotes. HAZARD: `library.e.abb.com` download URLs carry expiring signed tokens — cite the news-center release page, not the tokenized PDF URL.
- [ ] **Step 4: Hitachi Energy.** Fetch `https://www.hitachi.com/content/dam/hitachi/global/en/press/files/2026/04/260427/2025_Anpre.pdf` (FY2025 annual earnings presentation, 2026-04-27). Record: Hitachi Energy order backlog in USD as Hitachi itself states it (deck: "9.2 tn yen (+42%) / 57.9 bn USD (+33%)" — record BOTH, config uses the company-stated USD figure, `unit: "usd_b"`, `basis: "order-backlog"`, `scope: "segment"`), period (FY2025-end = 2026-03-31, Japanese fiscal year), verbatim slide text. If a Q1 FY2026 deck (July 2026) exists on hitachi.com IR, prefer it and record both.
- [ ] **Step 5: Eaton.** Fetch `https://www.sec.gov/Archives/edgar/data/1551182/000155118226000010/etn03312026exhibit99.htm` (Q1 2026 8-K exhibit). Record: backlog growth % (`kind: "backlog_growth"`, `unit: "pct_yoy"`, expected +44%, scope per the sentence — Electrical), rolling 12-mo book-to-bill (`kind: "book_to_bill"`, expected 1.2), orders growth color, period 2026-03-31, release date, verbatim sentences. Also check for a Q2 2026 release (Eaton reports late July/early Aug) — use the newest available.
- [ ] **Step 6: Caterpillar.** Fetch `https://www.sec.gov/Archives/edgar/data/18230/000001823026000021/cat-20260331.htm` (Q1 2026 10-Q). Record from the MD&A "Order Backlog" section: total backlog $ (~$62.7B, `basis: "mdna-backlog"`, `scope: "group"`), the beyond-12-months split ($24.8B), the exact boilerplate sentence, period 2026-03-31, filing date. Also grep the filing for "Power & Energy" to confirm the current segment name for `dc_segment`. Check for a Q2 10-Q (CAT files early August) — use the newest.
- [ ] **Step 7: Cummins — null verdict.** Fetch `https://www.sec.gov/Archives/edgar/data/26172/000002617226000016/cmi-20260331.htm` (Q1 2026 10-Q) and the matching earnings release. Confirm: zero backlog/orders/book-to-bill mentions; the RPO note's aggregate figure and its maintenance-dominated composition (quote the note). VERDICT: `null_note` text for the config, citing both documents checked and the date. This is a published finding, not an absence.
- [ ] **Step 8: Schneider — annual figure.** The canonical PDF `https://www.se.com/ww/en/assets/564/document/528237/release-fy-results-2025.pdf` 403-blocks non-browser fetchers (Akamai). Try it once; on 403, verify the FY2025 figure (€25,362M, Energy Management €21,340M) via an official republication or a browser-grade fetch, and record BOTH the canonical URL (for the config's `src`) and the URL actually verified against. Period 2025-12-31, release date 2026-02-26. ALSO: H1-2026 results were due 2026-07-30 — if published by spike time, check for a numeric backlog and prefer it; if absent (recon expects qualitative-only at half-year), keep FY2025 and note the check.
- [ ] **Step 9: pumps — null verdict.** One search pass for any roster-adjacent industrial-pump maker (Flowserve, Grundfos, Xylem) disclosing a pump-relevant order backlog at primary-source standard with DC relevance. Expected outcome per spec: none makes the roster; record the verdict sentence for the package `null_note`.
- [ ] **Step 10: Write the spike notes** with a SPIKE-FINAL section: for each vendor, the config-ready figure objects (all ten fields per figure: metric, kind, basis, scope, value, unit, period, asof, quote, src[label,url]) and the two null_note strings, every number and quote verbatim from a teed fetch. Tee all raw fetches to `<scratchpad>/task1-spike-*.log` and cite the tee filename beside each figure.
- [ ] **Step 11: Commit**

```bash
git add docs/superpowers/specs/2026-07-26-dc-longlead-spike-notes.md
git commit -m "docs(p4): long-lead spike — vendor figures re-verified, citations pinned"
```

---

### Task 2: `dc_longlead` config + fail-loud loader

**Files:**
- Create: `config/dc_longlead.json` (values VERBATIM from Task 1 SPIKE-FINAL)
- Create: `pipeline/dc_longlead.py`
- Test: `tests/test_dc_longlead.py`

**Interfaces:**
- Consumes: SPIKE-FINAL values (Task 1); `pipeline/dc_basket.py`'s `load_baskets(path=None, registry_codes=None) -> tuple[str, dict[str, list[DCComponent]]]` (existing; `DCComponent` has `.code`, `.label`, `.weight`).
- Produces: `dc_longlead.load(path: Path | None = None, build_codes: set[str] | None = None) -> LongLeadConfig`; frozen dataclasses `Figure` (fields `metric, kind, basis, scope, value, unit, period, asof, quote, src_label, src_url`), `Vendor` (`key, name, ticker, listed, dc_segment, cadence, figures: tuple[Figure, ...], null_note: str | None`), `Package` (`code, vendor_keys: tuple[str, ...], null_note: str | None`), `LongLeadConfig` (`as_of_curated: str, packages: tuple[Package, ...], vendors: dict[str, Vendor], teaser: tuple[tuple[str, str], ...]`). Tasks 3/4 consume.

- [ ] **Step 1: Write the failing tests** — create `tests/test_dc_longlead.py`:

```python
import json

import pytest

from pipeline import dc_basket, dc_longlead, registry


def _figure(**overrides):
    raw = {"metric": "Backlog", "kind": "backlog", "basis": "rpo",
           "scope": "group", "value": 176.0, "unit": "usd_b",
           "period": "2026-06-30", "asof": "2026-07-23",
           "quote": "With a backlog of $176 billion...",
           "src": ["Q2 2026 8-K", "https://example.test/8k"]}
    raw.update(overrides)
    return raw


def _write(tmp_path, packages=None, vendors=None, teaser=None, top=None):
    raw = {
        "schema_version": 1,
        "as_of_curated": "2026-07-27",
        "packages": packages if packages is not None else [
            {"code": "switchgear", "vendors": ["gev"], "null_note": None},
            {"code": "pumps", "vendors": [], "null_note": "No roster vendor."},
        ],
        "vendors": vendors if vendors is not None else {
            "gev": {"name": "GE Vernova", "ticker": "GEV", "listed": "NYSE",
                    "dc_segment": "Electrification", "cadence": "quarterly",
                    "figures": [_figure()], "null_note": None},
        },
        "teaser": teaser if teaser is not None else ["gev:backlog"],
    }
    raw.update(top or {})
    p = tmp_path / "dc_longlead.json"
    p.write_text(json.dumps(raw))
    return p


def test_load_happy_path(tmp_path):
    cfg = dc_longlead.load(_write(tmp_path),
                           build_codes={"switchgear", "pumps"})
    assert cfg.as_of_curated == "2026-07-27"
    assert [p.code for p in cfg.packages] == ["switchgear", "pumps"]
    assert cfg.packages[0].vendor_keys == ("gev",)
    assert cfg.packages[1].null_note == "No roster vendor."
    fig = cfg.vendors["gev"].figures[0]
    assert (fig.kind, fig.basis, fig.scope) == ("backlog", "rpo", "group")
    assert fig.value == 176.0 and fig.src_url == "https://example.test/8k"
    assert cfg.teaser == (("gev", "backlog"),)


def test_load_without_build_codes_skips_membership_check(tmp_path):
    # publisher tests and ad-hoc loads may not have a registry at hand
    cfg = dc_longlead.load(_write(tmp_path))
    assert [p.code for p in cfg.packages] == ["switchgear", "pumps"]


def test_load_real_config():
    _, series = registry.load_registry()
    _, baskets = dc_basket.load_baskets(registry_codes={s.code for s in series})
    cfg = dc_longlead.load(build_codes={c.code for c in baskets["build"]})
    # the five long-lead packages, weight-descending (spec §4)
    assert [p.code for p in cfg.packages] == [
        "switchgear", "transformers", "hvac_equip", "generators", "pumps"]
    assert cfg.teaser  # the /datacenter strip has curated picks
    # every figure carries its receipt
    for vendor in cfg.vendors.values():
        for f in vendor.figures:
            assert f.quote and f.src_url.startswith("https://")
    # the two spec-mandated nulls exist
    assert cfg.vendors["cmi"].null_note and not cfg.vendors["cmi"].figures
    pumps = next(p for p in cfg.packages if p.code == "pumps")
    assert pumps.null_note and not pumps.vendor_keys


@pytest.mark.parametrize("mutate,match", [
    (lambda t: _write(t, top={"schema_version": 2}), "schema_version"),
    (lambda t: _write(t, top={"as_of_curated": "27-07-2026"}), "ISO date"),
    (lambda t: _write(t, vendors={"gev": {
        "name": "GE Vernova", "ticker": "GEV", "listed": "NYSE",
        "dc_segment": "Electrification", "cadence": "monthly",
        "figures": [_figure()], "null_note": None}}), "cadence"),
    (lambda t: _write(t, vendors={"gev": {
        "name": "", "ticker": "GEV", "listed": "NYSE",
        "dc_segment": "Electrification", "cadence": "quarterly",
        "figures": [_figure()], "null_note": None}}), "non-empty"),
    (lambda t: _write(t, vendors={"gev": {
        "name": "GE Vernova", "ticker": "GEV", "listed": "NYSE",
        "dc_segment": "Electrification", "cadence": "quarterly",
        "figures": [_figure(kind="bookings")], "null_note": None}}), "kind"),
    (lambda t: _write(t, vendors={"gev": {
        "name": "GE Vernova", "ticker": "GEV", "listed": "NYSE",
        "dc_segment": "Electrification", "cadence": "quarterly",
        "figures": [_figure(basis="press")], "null_note": None}}), "basis"),
    (lambda t: _write(t, vendors={"gev": {
        "name": "GE Vernova", "ticker": "GEV", "listed": "NYSE",
        "dc_segment": "Electrification", "cadence": "quarterly",
        "figures": [_figure(scope="global")], "null_note": None}}), "scope"),
    (lambda t: _write(t, vendors={"gev": {
        "name": "GE Vernova", "ticker": "GEV", "listed": "NYSE",
        "dc_segment": "Electrification", "cadence": "quarterly",
        "figures": [_figure(unit="usd_m")], "null_note": None}}), "unit"),
    (lambda t: _write(t, vendors={"gev": {
        "name": "GE Vernova", "ticker": "GEV", "listed": "NYSE",
        "dc_segment": "Electrification", "cadence": "quarterly",
        "figures": [_figure(value="big")], "null_note": None}}), "numeric"),
    (lambda t: _write(t, vendors={"gev": {
        "name": "GE Vernova", "ticker": "GEV", "listed": "NYSE",
        "dc_segment": "Electrification", "cadence": "quarterly",
        "figures": [_figure(value=True)], "null_note": None}}), "numeric"),
    (lambda t: _write(t, vendors={"gev": {
        "name": "GE Vernova", "ticker": "GEV", "listed": "NYSE",
        "dc_segment": "Electrification", "cadence": "quarterly",
        "figures": [_figure(period="Q2 2026")], "null_note": None}}), "ISO date"),
    (lambda t: _write(t, vendors={"gev": {
        "name": "GE Vernova", "ticker": "GEV", "listed": "NYSE",
        "dc_segment": "Electrification", "cadence": "quarterly",
        "figures": [_figure(quote="")], "null_note": None}}), "non-empty"),
    (lambda t: _write(t, vendors={"gev": {
        "name": "GE Vernova", "ticker": "GEV", "listed": "NYSE",
        "dc_segment": "Electrification", "cadence": "quarterly",
        "figures": [_figure(src=["8-K", "http://insecure.test"])],
        "null_note": None}}), "https"),
    (lambda t: _write(t, vendors={"gev": {
        "name": "GE Vernova", "ticker": "GEV", "listed": "NYSE",
        "dc_segment": "Electrification", "cadence": "quarterly",
        "figures": [_figure(src=["justalabel"])], "null_note": None}}),
     r"\[label, url\]"),
    (lambda t: _write(t, vendors={"gev": {
        "name": "GE Vernova", "ticker": "GEV", "listed": "NYSE",
        "dc_segment": "Electrification", "cadence": "quarterly",
        "figures": [_figure()], "null_note": "also a note"}}), "exactly one"),
    (lambda t: _write(t, vendors={"gev": {
        "name": "GE Vernova", "ticker": "GEV", "listed": "NYSE",
        "dc_segment": "Electrification", "cadence": "quarterly",
        "figures": [], "null_note": None}}), "exactly one"),
    (lambda t: _write(t, packages=[
        {"code": "switchgear", "vendors": ["ghost"], "null_note": None}]),
     "unknown vendor"),
    (lambda t: _write(t, packages=[
        {"code": "switchgear", "vendors": ["gev"], "null_note": None},
        {"code": "switchgear", "vendors": ["gev"], "null_note": None}]),
     "duplicate"),
    (lambda t: _write(t, packages=[
        {"code": "switchgear", "vendors": [], "null_note": None}]),
     "exactly one"),
    (lambda t: _write(t, packages=[
        {"code": "pumps", "vendors": [], "null_note": "No roster vendor."}]),
     "unreferenced"),
    (lambda t: _write(t, teaser=["gev-backlog"]), "vendor_key:kind"),
    (lambda t: _write(t, teaser=["gev:orders"]), "no 'orders' figure"),
    (lambda t: _write(t, teaser=["ghost:backlog"]), "unknown vendor"),
])
def test_garbled_config_rejected(tmp_path, mutate, match):
    with pytest.raises(ValueError, match=match):
        dc_longlead.load(mutate(tmp_path), build_codes={"switchgear", "pumps"})


def test_membership_check_rejects_non_build_code(tmp_path):
    with pytest.raises(ValueError, match="not a Build component code"):
        dc_longlead.load(_write(tmp_path), build_codes={"transformers"})
```

- [ ] **Step 2: Run to verify failure**

Run: `.venv/bin/pytest tests/test_dc_longlead.py -q 2>&1 | tee /private/tmp/claude-501/-Users-ericwyluda-Development-macrogauge/1ee235e4-b91d-40b9-adbc-c2e9ee552844/scratchpad/task2-red.log`
Expected: collection error (`ImportError`: no module `pipeline.dc_longlead`).

- [ ] **Step 3: Implement the loader.** Create `pipeline/dc_longlead.py`:

```python
"""Long-lead board config — hand-curated vendor order-book figures (P4 spec §5).

Loader precedent: pipeline/dc_context.py. STATED-ONLY is the load-bearing
rule: every figure is something the vendor itself published — verbatim metric
name, verbatim quote, primary-source URL — never a derived book-to-bill or a
summed backlog. "Backlog" is at least three different accounting objects
(ASC-606 RPO, an orders-based order book, an MD&A believed-firm figure), so
each figure carries basis/scope classifiers the site renders as badges;
figures with different bases never share an axis or a sum. A vendor with
nothing at primary-source standard is a published null_note, not an absence
(the context.transformer precedent) — the null IS the finding. A typo'd or
emptied config must fail loudly at load time: in the daily run that is
confined to the longlead phase (longlead_ok=false, exit 0), and the gate that
keeps a bad config off main is CI, where test_load_real_config loads this
very file."""
import json
from dataclasses import dataclass
from datetime import date
from pathlib import Path

DEFAULT_PATH = Path(__file__).parent.parent / "config" / "dc_longlead.json"

KINDS = frozenset({"backlog", "orders", "book_to_bill", "backlog_growth"})
BASES = frozenset({"rpo", "order-backlog", "mdna-backlog"})
SCOPES = frozenset({"group", "segment", "product-line"})
UNITS = frozenset({"usd_b", "eur_b", "jpy_tn", "pct_yoy", "ratio"})
CADENCES = frozenset({"quarterly", "annual"})


@dataclass(frozen=True)
class Figure:
    metric: str
    kind: str
    basis: str
    scope: str
    value: float
    unit: str
    period: str      # the date the figure measures (e.g. the quarter end)
    asof: str        # the source document's date; staleness ages on this
    quote: str       # verbatim from the document — the receipt beside the number
    src_label: str
    src_url: str


@dataclass(frozen=True)
class Vendor:
    key: str
    name: str
    ticker: str
    listed: str
    dc_segment: str
    cadence: str
    figures: tuple[Figure, ...]
    null_note: str | None


@dataclass(frozen=True)
class Package:
    code: str
    vendor_keys: tuple[str, ...]
    null_note: str | None


@dataclass(frozen=True)
class LongLeadConfig:
    as_of_curated: str
    packages: tuple[Package, ...]
    vendors: dict[str, Vendor]
    teaser: tuple[tuple[str, str], ...]  # (vendor_key, kind) /datacenter strip picks


def _iso(raw, where: str) -> str:
    if not isinstance(raw, str):
        raise ValueError(f"dc_longlead {where}: must be an ISO date string")
    try:
        date.fromisoformat(raw)
    except ValueError:
        raise ValueError(f"dc_longlead {where}: not an ISO date: {raw!r}") from None
    return raw


def _figure(raw: dict, where: str) -> Figure:
    for key, allowed in (("kind", KINDS), ("basis", BASES),
                         ("scope", SCOPES), ("unit", UNITS)):
        if raw.get(key) not in allowed:
            raise ValueError(
                f"dc_longlead {where}: {key} must be one of {sorted(allowed)}")
    value = raw.get("value")
    if not isinstance(value, (int, float)) or isinstance(value, bool):
        raise ValueError(f"dc_longlead {where}: value must be numeric")
    for key in ("metric", "quote"):
        if not raw.get(key) or not isinstance(raw[key], str):
            raise ValueError(f"dc_longlead {where}: {key} must be non-empty")
    src = raw.get("src")
    if (not isinstance(src, list) or len(src) != 2
            or not all(isinstance(s, str) and s for s in src)):
        raise ValueError(f"dc_longlead {where}: src must be [label, url]")
    if not src[1].startswith("https://"):
        raise ValueError(f"dc_longlead {where}: src url must be https")
    return Figure(metric=raw["metric"], kind=raw["kind"], basis=raw["basis"],
                  scope=raw["scope"], value=float(value), unit=raw["unit"],
                  period=_iso(raw.get("period"), f"{where}.period"),
                  asof=_iso(raw.get("asof"), f"{where}.asof"),
                  quote=raw["quote"], src_label=src[0], src_url=src[1])


def _vendor(key: str, raw: dict) -> Vendor:
    for field in ("name", "ticker", "listed", "dc_segment"):
        if not raw.get(field) or not isinstance(raw[field], str):
            raise ValueError(
                f"dc_longlead vendor {key}: {field} must be non-empty")
    if raw.get("cadence") not in CADENCES:
        raise ValueError(
            f"dc_longlead vendor {key}: cadence must be one of {sorted(CADENCES)}")
    figures = raw.get("figures") or []
    null_note = raw.get("null_note")
    # a vendor either shows receipts or states why there are none — never both,
    # never neither (the null IS a finding and must be written down)
    if bool(figures) == bool(null_note):
        raise ValueError(
            f"dc_longlead vendor {key}: exactly one of figures or null_note")
    if null_note is not None and not isinstance(null_note, str):
        raise ValueError(f"dc_longlead vendor {key}: null_note must be a string")
    return Vendor(key=key, name=raw["name"], ticker=raw["ticker"],
                  listed=raw["listed"], dc_segment=raw["dc_segment"],
                  cadence=raw["cadence"],
                  figures=tuple(_figure(f, f"vendor {key} figure {i}")
                                for i, f in enumerate(figures)),
                  null_note=null_note)


def load(path: Path | None = None,
         build_codes: set[str] | None = None) -> LongLeadConfig:
    raw = json.loads((path or DEFAULT_PATH).read_text())
    if raw.get("schema_version") != 1:
        raise ValueError("dc_longlead: schema_version must be 1")
    as_of = _iso(raw.get("as_of_curated"), "as_of_curated")
    vendors_raw = raw.get("vendors")
    if not isinstance(vendors_raw, dict) or not vendors_raw:
        raise ValueError("dc_longlead: vendors must be a non-empty object")
    vendors = {k: _vendor(k, v) for k, v in vendors_raw.items()}
    packages_raw = raw.get("packages")
    if not isinstance(packages_raw, list) or not packages_raw:
        raise ValueError("dc_longlead: packages must be a non-empty list")
    packages: list[Package] = []
    seen: set[str] = set()
    referenced: set[str] = set()
    for p in packages_raw:
        code = p.get("code")
        if not code or not isinstance(code, str):
            raise ValueError("dc_longlead package: code must be non-empty")
        if code in seen:
            raise ValueError(f"dc_longlead package {code}: duplicate code")
        seen.add(code)
        if build_codes is not None and code not in build_codes:
            raise ValueError(
                f"dc_longlead package {code}: not a Build component code")
        keys = p.get("vendors") or []
        null_note = p.get("null_note")
        if bool(keys) == bool(null_note):
            raise ValueError(
                f"dc_longlead package {code}: exactly one of vendors or null_note")
        for k in keys:
            if k not in vendors:
                raise ValueError(
                    f"dc_longlead package {code}: unknown vendor {k!r}")
            referenced.add(k)
        packages.append(Package(code=code, vendor_keys=tuple(keys),
                                null_note=null_note))
    unreferenced = set(vendors) - referenced
    if unreferenced:
        raise ValueError(
            f"dc_longlead: unreferenced vendors {sorted(unreferenced)}")
    teaser: list[tuple[str, str]] = []
    for entry in raw.get("teaser") or []:
        if not isinstance(entry, str) or entry.count(":") != 1:
            raise ValueError(
                f"dc_longlead teaser: entries are 'vendor_key:kind', got {entry!r}")
        vkey, kind = entry.split(":")
        vendor = vendors.get(vkey)
        if vendor is None:
            raise ValueError(f"dc_longlead teaser: unknown vendor {vkey!r}")
        if not any(f.kind == kind for f in vendor.figures):
            raise ValueError(f"dc_longlead teaser: {vkey} has no {kind!r} figure")
        teaser.append((vkey, kind))
    return LongLeadConfig(as_of_curated=as_of, packages=tuple(packages),
                          vendors=vendors, teaser=tuple(teaser))
```

- [ ] **Step 4: Create `config/dc_longlead.json`** — structure below is FIXED (keys, kinds, bases, scopes, cadences, package order, teaser picks); every `<SPIKE>` transcribes from Task 1 SPIKE-FINAL. Each vendor's intended figures (add/drop only if the spike found the document says otherwise, and say so in your report):

```json
{
  "schema_version": 1,
  "as_of_curated": "<SPIKE date>",
  "packages": [
    {"code": "switchgear", "vendors": ["etn", "abb", "schneider", "gev"], "null_note": null},
    {"code": "transformers", "vendors": ["hitachi_energy", "gev"], "null_note": null},
    {"code": "hvac_equip", "vendors": ["vrt"], "null_note": null},
    {"code": "generators", "vendors": ["cat", "cmi"], "null_note": null},
    {"code": "pumps", "vendors": [], "null_note": "<SPIKE pumps verdict sentence>"}
  ],
  "vendors": {
    "gev": {"name": "GE Vernova", "ticker": "GEV", "listed": "NYSE",
            "dc_segment": "<SPIKE>", "cadence": "quarterly",
            "figures": [
              {"metric": "Backlog", "kind": "backlog", "basis": "rpo", "scope": "group",
               "value": "<SPIKE>", "unit": "usd_b", "period": "<SPIKE>", "asof": "<SPIKE>",
               "quote": "<SPIKE>", "src": ["<SPIKE>", "<SPIKE https url>"]},
              {"metric": "<SPIKE (Electrification book-to-bill)>", "kind": "book_to_bill",
               "basis": "order-backlog", "scope": "segment",
               "value": "<SPIKE>", "unit": "ratio", "period": "<SPIKE>", "asof": "<SPIKE>",
               "quote": "<SPIKE>", "src": ["<SPIKE>", "<SPIKE>"]}],
            "null_note": null},
    "vrt": {"name": "Vertiv", "ticker": "VRT", "listed": "NYSE",
            "dc_segment": "<SPIKE>", "cadence": "quarterly",
            "figures": [
              {"metric": "<SPIKE>", "kind": "backlog", "basis": "order-backlog", "scope": "group",
               "value": "<SPIKE>", "unit": "usd_b", "...": "<SPIKE all remaining fields>"},
              {"metric": "<SPIKE>", "kind": "book_to_bill", "basis": "order-backlog", "scope": "group",
               "value": "<SPIKE>", "unit": "ratio", "...": "<SPIKE all remaining fields>"}],
            "null_note": null},
    "abb": {"name": "ABB", "ticker": "ABBN.SW", "listed": "SIX / NYSE",
            "dc_segment": "<SPIKE>", "cadence": "quarterly",
            "figures": [
              {"metric": "<SPIKE (Electrification order backlog)>", "kind": "backlog",
               "basis": "order-backlog", "scope": "segment",
               "value": "<SPIKE>", "unit": "usd_b", "...": "<SPIKE>"}],
            "null_note": null},
    "hitachi_energy": {"name": "Hitachi Energy", "ticker": "6501.T (Hitachi Ltd)",
            "listed": "TSE", "dc_segment": "<SPIKE>", "cadence": "quarterly",
            "figures": [
              {"metric": "<SPIKE (order backlog, company-stated USD)>", "kind": "backlog",
               "basis": "order-backlog", "scope": "segment",
               "value": "<SPIKE>", "unit": "usd_b", "...": "<SPIKE>"}],
            "null_note": null},
    "etn": {"name": "Eaton", "ticker": "ETN", "listed": "NYSE",
            "dc_segment": "<SPIKE>", "cadence": "quarterly",
            "figures": [
              {"metric": "<SPIKE (backlog growth, Electrical)>", "kind": "backlog_growth",
               "basis": "order-backlog", "scope": "segment",
               "value": "<SPIKE>", "unit": "pct_yoy", "...": "<SPIKE>"},
              {"metric": "<SPIKE (rolling 12-mo book-to-bill)>", "kind": "book_to_bill",
               "basis": "order-backlog", "scope": "segment",
               "value": "<SPIKE>", "unit": "ratio", "...": "<SPIKE>"}],
            "null_note": null},
    "schneider": {"name": "Schneider Electric", "ticker": "SU.PA", "listed": "Euronext Paris",
            "dc_segment": "<SPIKE>", "cadence": "annual",
            "figures": [
              {"metric": "<SPIKE (Group backlog)>", "kind": "backlog",
               "basis": "order-backlog", "scope": "group",
               "value": "<SPIKE>", "unit": "eur_b", "...": "<SPIKE>"}],
            "null_note": null},
    "cat": {"name": "Caterpillar", "ticker": "CAT", "listed": "NYSE",
            "dc_segment": "<SPIKE (current segment name)>", "cadence": "quarterly",
            "figures": [
              {"metric": "<SPIKE (Order Backlog, 10-Q MD&A)>", "kind": "backlog",
               "basis": "mdna-backlog", "scope": "group",
               "value": "<SPIKE>", "unit": "usd_b", "...": "<SPIKE>"}],
            "null_note": null},
    "cmi": {"name": "Cummins", "ticker": "CMI", "listed": "NYSE",
            "dc_segment": "<SPIKE (Power Systems)>", "cadence": "quarterly",
            "figures": [], "null_note": "<SPIKE Cummins null verdict>"}
  },
  "teaser": ["gev:backlog", "vrt:book_to_bill"]
}
```

(The `"...": "<SPIKE all remaining fields>"` shorthand above means: write out ALL ten figure fields explicitly in the real config — `metric, kind, basis, scope, value, unit, period, asof, quote, src` — the loader rejects anything less.)

- [ ] **Step 5: Run to verify green**

Run: `.venv/bin/pytest tests/test_dc_longlead.py -q && .venv/bin/pytest -q 2>&1 | tee /private/tmp/claude-501/-Users-ericwyluda-Development-macrogauge/1ee235e4-b91d-40b9-adbc-c2e9ee552844/scratchpad/task2-green.log`
Expected: 27 pass in file (3 named + 23 parametrized + 1 membership); full suite ≥ 840, zero failures.

- [ ] **Step 6: Commit**

```bash
git add pipeline/dc_longlead.py config/dc_longlead.json tests/test_dc_longlead.py
git commit -m "feat(p4): dc_longlead config + fail-loud loader (spike-verified stated-only figures)"
```

---

### Task 3: publisher + schema — `longlead.json`

**Files:**
- Create: `pipeline/publish/longlead.py`
- Create: `schemas/longlead.schema.json`
- Test: `tests/test_longlead_publish.py`

**Interfaces:**
- Consumes: `dc_longlead.LongLeadConfig` (Task 2); `dc_basket.DCComponent` (`.code`, `.label`, `.weight`); the engine's `dc_result["indexes"]["build"]["components"][code]` dict whose keys are exactly `label, group, weight, mode, yoy_pct, last_obs, implied_level, stale` (verbatim from `pipeline/engine/dcindex.py`); `pipeline.publish.util.write_json`.
- Produces: `longlead.build(cfg, build_components, dc_result: dict | None, today: str) -> dict` and `longlead.write(payload: dict, out_dir: Path, published_at: str) -> Path` (filename `longlead.json`). Task 4 wires; Tasks 5/6 read the published shape.

- [ ] **Step 1: Write the failing tests** — create `tests/test_longlead_publish.py`:

```python
import json
from pathlib import Path

import jsonschema
import pytest

from pipeline import dc_basket, dc_longlead, registry
from pipeline.dc_basket import DCComponent
from pipeline.publish import longlead, validate

SCHEMAS = Path(__file__).parent.parent / "schemas"

COMPONENTS = [
    DCComponent(code="switchgear", label="Switchgear & switchboard",
                group="electrical", series="ppi_switchgear", weight=0.14),
    DCComponent(code="pumps", label="Industrial pumps",
                group="mechanical", series="ppi_pumps", weight=0.05),
]

DC_RESULT = {"indexes": {"build": {"components": {
    "switchgear": {"label": "Switchgear & switchboard", "group": "electrical",
                   "weight": 0.14, "mode": "official", "yoy_pct": 5.0,
                   "last_obs": "2026-05-01", "implied_level": 130.0,
                   "stale": False},
    "pumps": {"label": "Industrial pumps", "group": "mechanical",
              "weight": 0.05, "mode": "official", "yoy_pct": None,
              "last_obs": "2026-05-01", "implied_level": 118.0,
              "stale": False},
}}}}


def _fig(kind="backlog", unit="usd_b", value=176.0, asof="2026-07-01"):
    return dc_longlead.Figure(
        metric="Backlog", kind=kind, basis="rpo", scope="group",
        value=value, unit=unit, period="2026-06-30", asof=asof,
        quote="With a backlog of $176 billion...",
        src_label="Q2 2026 8-K", src_url="https://example.test/8k")


def _cfg(figures=None, cadence="quarterly", null_vendor=False, teaser=()):
    vendor = dc_longlead.Vendor(
        key="gev", name="GE Vernova", ticker="GEV", listed="NYSE",
        dc_segment="Electrification", cadence=cadence,
        figures=() if null_vendor else tuple(figures or [_fig()]),
        null_note="No disclosure at standard." if null_vendor else None)
    return dc_longlead.LongLeadConfig(
        as_of_curated="2026-07-27",
        packages=(dc_longlead.Package(code="switchgear", vendor_keys=("gev",),
                                      null_note=None),
                  dc_longlead.Package(code="pumps", vendor_keys=(),
                                      null_note="No roster vendor.")),
        vendors={"gev": vendor},
        teaser=tuple(teaser))


def test_build_joins_price_legs():
    out = longlead.build(_cfg(), COMPONENTS, DC_RESULT, today="2026-07-27")
    sw = out["packages"][0]
    assert (sw["code"], sw["label"], sw["weight"]) == (
        "switchgear", "Switchgear & switchboard", 0.14)
    assert sw["price_yoy_pct"] == 5.0
    assert sw["price_last_obs"] == "2026-05-01"
    assert sw["contribution_pp"] == 0.7          # 0.14 x 5.0, publisher rule
    pumps = out["packages"][1]
    assert pumps["contribution_pp"] is None      # yoy None -> unknowable
    assert pumps["vendors"] == [] and pumps["null_note"] == "No roster vendor."
    assert out["build_weight_covered"] == pytest.approx(0.19)  # 0.14 + 0.05
    fig = sw["vendors"][0]["figures"][0]
    assert fig["src"] == {"label": "Q2 2026 8-K", "url": "https://example.test/8k"}
    assert fig["quote"] == "With a backlog of $176 billion..."


def test_build_degrades_without_dc_result():
    out = longlead.build(_cfg(), COMPONENTS, None, today="2026-07-27")
    sw = out["packages"][0]
    assert sw["weight"] == 0.14                  # basket weight survives
    assert sw["price_yoy_pct"] is None
    assert sw["price_last_obs"] is None
    assert sw["contribution_pp"] is None
    assert sw["vendors"][0]["figures"]           # vendor rows never blank


def test_stale_flag_boundary_quarterly():
    # asof 2026-07-01, allowance 120d: 2026-10-29 is day 120 (fresh),
    # 2026-10-30 is day 121 (stale)
    fresh = longlead.build(_cfg(), COMPONENTS, None, today="2026-10-29")
    stale = longlead.build(_cfg(), COMPONENTS, None, today="2026-10-30")
    assert fresh["packages"][0]["vendors"][0]["stale"] is False
    assert stale["packages"][0]["vendors"][0]["stale"] is True


def test_stale_flag_boundary_annual():
    # allowance 430d from 2026-07-01: 2027-09-04 fresh, 2027-09-05 stale
    fresh = longlead.build(_cfg(cadence="annual"), COMPONENTS, None,
                           today="2027-09-04")
    stale = longlead.build(_cfg(cadence="annual"), COMPONENTS, None,
                           today="2027-09-05")
    assert fresh["packages"][0]["vendors"][0]["stale"] is False
    assert stale["packages"][0]["vendors"][0]["stale"] is True


def test_null_note_vendor_is_never_stale():
    out = longlead.build(_cfg(null_vendor=True), COMPONENTS, None,
                         today="2030-01-01")
    vendor = out["packages"][0]["vendors"][0]
    assert vendor["stale"] is False and vendor["null_note"]


def test_teaser_passthrough():
    out = longlead.build(_cfg(teaser=(("gev", "backlog"),)), COMPONENTS,
                         DC_RESULT, today="2026-07-27")
    assert out["teaser"] == [{"vendor": "gev", "name": "GE Vernova",
                              "figure": out["packages"][0]["vendors"][0]["figures"][0]}]


def test_written_file_validates_against_schema(tmp_path):
    payload = longlead.build(_cfg(teaser=(("gev", "backlog"),)), COMPONENTS,
                             DC_RESULT, today="2026-07-27")
    path = longlead.write(payload, tmp_path, published_at="2026-07-27T12:00:00Z")
    assert path.name == "longlead.json"
    validate.validate_file(path, SCHEMAS / "longlead.schema.json")
    assert json.loads(path.read_text())["published_at"] == "2026-07-27T12:00:00Z"


def test_degraded_payload_validates(tmp_path):
    # dc_result=None + empty teaser must validate without inventing values
    payload = longlead.build(_cfg(), COMPONENTS, None, today="2026-07-27")
    path = longlead.write(payload, tmp_path, published_at="2026-07-27T12:00:00Z")
    validate.validate_file(path, SCHEMAS / "longlead.schema.json")


def test_real_config_publishes_and_validates(tmp_path):
    # CI gate: the committed config must publish a valid artifact even with
    # the engine down
    _, series = registry.load_registry()
    _, baskets = dc_basket.load_baskets(registry_codes={s.code for s in series})
    cfg = dc_longlead.load(build_codes={c.code for c in baskets["build"]})
    payload = longlead.build(cfg, baskets["build"], None, today="2026-07-27")
    path = longlead.write(payload, tmp_path, published_at="2026-07-27T12:00:00Z")
    validate.validate_file(path, SCHEMAS / "longlead.schema.json")
    assert payload["build_weight_covered"] == pytest.approx(0.50)
    assert [p["code"] for p in payload["packages"]] == [
        "switchgear", "transformers", "hvac_equip", "generators", "pumps"]
```

- [ ] **Step 2: Run to verify failure**

Run: `.venv/bin/pytest tests/test_longlead_publish.py -q 2>&1 | tee /private/tmp/claude-501/-Users-ericwyluda-Development-macrogauge/1ee235e4-b91d-40b9-adbc-c2e9ee552844/scratchpad/task3-red.log`
Expected: collection error (`ImportError`: cannot import `longlead` from `pipeline.publish`).

- [ ] **Step 3: Implement the publisher.** Create `pipeline/publish/longlead.py`:

```python
"""Long-lead board artifact (P4 spec §6) — /longlead + the /datacenter strip.

Stated-only passthrough: vendor figures publish exactly as curated. The only
arithmetic in this module is the price leg (the same weight x yoy contribution
rule publish/datacenter.py uses) and the staleness age — never on a vendor's
figure values (spec acceptance §10.2)."""
from datetime import date
from pathlib import Path

from pipeline.publish.util import write_json

# a missed earnings season must surface on-page, not silently age (spec §6)
ALLOWANCE_DAYS = {"quarterly": 120, "annual": 430}


def _stale(vendor, today: str) -> bool:
    if not vendor.figures:
        return False  # a null_note has nothing to age
    newest = max(f.asof for f in vendor.figures)
    age = (date.fromisoformat(today) - date.fromisoformat(newest)).days
    return age > ALLOWANCE_DAYS[vendor.cadence]


def _figure_dict(f) -> dict:
    return {"metric": f.metric, "kind": f.kind, "basis": f.basis,
            "scope": f.scope, "value": f.value, "unit": f.unit,
            "period": f.period, "asof": f.asof, "quote": f.quote,
            "src": {"label": f.src_label, "url": f.src_url}}


def _vendor_dict(key: str, vendor, today: str) -> dict:
    return {"key": key, "name": vendor.name, "ticker": vendor.ticker,
            "listed": vendor.listed, "dc_segment": vendor.dc_segment,
            "cadence": vendor.cadence, "stale": _stale(vendor, today),
            "figures": [_figure_dict(f) for f in vendor.figures],
            "null_note": vendor.null_note}


def build(cfg, build_components, dc_result: dict | None, today: str) -> dict:
    by_code = {c.code: c for c in build_components}
    engine = (dc_result or {}).get("indexes", {}).get("build", {}) \
        .get("components", {})
    packages = []
    for p in cfg.packages:
        comp = by_code[p.code]  # loader validated membership against this basket
        e = engine.get(p.code)
        yoy = None if e is None else e["yoy_pct"]
        packages.append({
            "code": p.code, "label": comp.label, "weight": comp.weight,
            "price_yoy_pct": yoy,
            "price_last_obs": None if e is None else e["last_obs"],
            # same rule as publish/datacenter.py: contribution is weight x yoy,
            # unknowable when yoy is
            "contribution_pp": None if yoy is None else round(comp.weight * yoy, 2),
            "null_note": p.null_note,
            "vendors": [_vendor_dict(k, cfg.vendors[k], today)
                        for k in p.vendor_keys]})
    teaser = []
    for vkey, kind in cfg.teaser:
        vendor = cfg.vendors[vkey]
        fig = next(f for f in vendor.figures if f.kind == kind)  # loader-validated
        teaser.append({"vendor": vkey, "name": vendor.name,
                       "figure": _figure_dict(fig)})
    return {"as_of_curated": cfg.as_of_curated,
            "build_weight_covered": round(
                sum(by_code[p.code].weight for p in cfg.packages), 4),
            "teaser": teaser,
            "packages": packages}


def write(payload: dict, out_dir: Path, published_at: str) -> Path:
    return write_json({"published_at": published_at, **payload}, out_dir,
                      "longlead.json")
```

- [ ] **Step 4: Create `schemas/longlead.schema.json`** (multi-line like `dc_grades.schema.json`):

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "title": "longlead.json — /longlead vendor order-book board (P4)",
  "type": "object",
  "required": ["published_at", "as_of_curated", "build_weight_covered",
               "teaser", "packages"],
  "properties": {
    "published_at": {"type": "string"},
    "as_of_curated": {"type": "string", "minLength": 1},
    "build_weight_covered": {"type": "number"},
    "teaser": {
      "type": "array",
      "items": {
        "type": "object",
        "required": ["vendor", "name", "figure"],
        "properties": {
          "vendor": {"type": "string", "minLength": 1},
          "name": {"type": "string", "minLength": 1},
          "figure": {"$ref": "#/$defs/figure"}
        }
      }
    },
    "packages": {
      "type": "array",
      "minItems": 1,
      "items": {
        "type": "object",
        "required": ["code", "label", "weight", "price_yoy_pct",
                     "price_last_obs", "contribution_pp", "null_note",
                     "vendors"],
        "properties": {
          "code": {"type": "string", "minLength": 1},
          "label": {"type": "string", "minLength": 1},
          "weight": {"type": "number"},
          "price_yoy_pct": {"type": ["number", "null"]},
          "price_last_obs": {"type": ["string", "null"]},
          "contribution_pp": {"type": ["number", "null"]},
          "null_note": {"type": ["string", "null"]},
          "vendors": {
            "type": "array",
            "items": {
              "type": "object",
              "required": ["key", "name", "ticker", "listed", "dc_segment",
                           "cadence", "stale", "figures", "null_note"],
              "properties": {
                "key": {"type": "string", "minLength": 1},
                "name": {"type": "string", "minLength": 1},
                "ticker": {"type": "string", "minLength": 1},
                "listed": {"type": "string", "minLength": 1},
                "dc_segment": {"type": "string", "minLength": 1},
                "cadence": {"type": "string", "enum": ["quarterly", "annual"]},
                "stale": {"type": "boolean"},
                "figures": {"type": "array",
                            "items": {"$ref": "#/$defs/figure"}},
                "null_note": {"type": ["string", "null"]}
              }
            }
          }
        }
      }
    }
  },
  "$defs": {
    "figure": {
      "type": "object",
      "required": ["metric", "kind", "basis", "scope", "value", "unit",
                   "period", "asof", "quote", "src"],
      "properties": {
        "metric": {"type": "string", "minLength": 1},
        "kind": {"type": "string",
                 "enum": ["backlog", "orders", "book_to_bill",
                          "backlog_growth"]},
        "basis": {"type": "string",
                  "enum": ["rpo", "order-backlog", "mdna-backlog"],
                  "description": "Three different accounting objects — never sum figures across bases, never share an axis (spec §2.4)"},
        "scope": {"type": "string",
                  "enum": ["group", "segment", "product-line"]},
        "value": {"type": "number"},
        "unit": {"type": "string",
                 "enum": ["usd_b", "eur_b", "jpy_tn", "pct_yoy", "ratio"]},
        "period": {"type": "string", "minLength": 1},
        "asof": {"type": "string", "minLength": 1},
        "quote": {"type": "string", "minLength": 1},
        "src": {
          "type": "object",
          "required": ["label", "url"],
          "properties": {
            "label": {"type": "string", "minLength": 1},
            "url": {"type": "string", "pattern": "^https://"}
          }
        }
      }
    }
  }
}
```

- [ ] **Step 5: Run to verify green**

Run: `.venv/bin/pytest tests/test_longlead_publish.py -q && .venv/bin/pytest -q 2>&1 | tee /private/tmp/claude-501/-Users-ericwyluda-Development-macrogauge/1ee235e4-b91d-40b9-adbc-c2e9ee552844/scratchpad/task3-green.log`
Expected: 9 pass in file; full suite ≥ Task 2's count + 9.

- [ ] **Step 6: Commit**

```bash
git add pipeline/publish/longlead.py schemas/longlead.schema.json tests/test_longlead_publish.py
git commit -m "feat(p4): longlead publisher + schema — price-leg join, staleness, degradable-nullable"
```

---

### Task 4: run_daily wiring (twelfth isolated phase) + artifact generation

**Files:**
- Modify: `pipeline/run_daily.py` (imports, module docstring roster, new phase after the GRADES `_run_phase` call ~line 389)
- Modify: `pipeline/publish/qa.py` (PHASES tuple + `_PHASE_DONE` dict, lines 22-33)
- Modify: `tests/test_run_daily.py`
- Create (generated, then committed): `site/public/data/longlead.json`

**Interfaces:**
- Consumes: `dc_longlead.load` (Task 2), `longlead.build`/`write` (Task 3), existing `_run_phase(label, fn, phase_errors, phase)` (the shared runner owns the try/except and the `ValidationError` re-raise — do NOT add a try/except around `validate_file`), `dc_basket.load_baskets`, `dcindex.run`, ambient `conn`/`series`/`today`/`published_at`/`args.out`/`SCHEMAS`/`phase_errors`.
- Produces: the daily run writes `longlead.json` with a `longlead_ok` flag in `qa.json`; the committed `site/public/data/longlead.json` Tasks 5/6 import at build time.

- [ ] **Step 1: Write the failing tests.** In `tests/test_run_daily.py`:

(a) In `test_end_to_end_all_sources`: append `"longlead.json"` to the artifact-existence tuple (the for-loop ending `..., "dc_markets.json", "dc_grades.json")`), and after the dc_grades assertions (~line 401) add:

```python
    ll_out = json.loads((out / "longlead.json").read_text())
    assert ll_out["published_at"] == run_stamp
    assert ll_out["build_weight_covered"] == pytest.approx(0.50)
    codes = [p["code"] for p in ll_out["packages"]]
    assert codes == ["switchgear", "transformers", "hvac_equip",
                     "generators", "pumps"]
    pumps = ll_out["packages"][codes.index("pumps")]
    assert pumps["vendors"] == [] and pumps["null_note"]
    for pkg in ll_out["packages"]:
        for vendor in pkg["vendors"]:
            assert bool(vendor["figures"]) != bool(vendor["null_note"])
```

(follow the surrounding test's actual local variable names for `out` / `run_stamp`.)

(b) Beside `assert checks["grades_ok"]["pass"] is True` (~line 361) add:

```python
    assert checks["longlead_ok"]["pass"] is True
```

(c) Bump the qa pin at ~line 293: `assert qa["total"] == 26` → `27`, and append `+ longlead_ok` to the roll-call comment above it (lines 290-292).

(d) Append the isolation test — copy the setup of `test_grades_failure_does_not_block_publish` (lines 885-907: same `set_keys(monkeypatch)`, same store/out tmp dirs, same `run_daily.main([...], http_get=fake_get, http_post=fake_post)` invocation — reuse the file's existing helpers verbatim), with these deltas:

```python
def test_longlead_failure_does_not_block_publish(tmp_path, monkeypatch):
    # (setup identical to test_grades_failure_does_not_block_publish)
    def boom(*a, **kw):
        raise RuntimeError("longlead boom")
    monkeypatch.setattr(run_daily.longlead_json, "build", boom)
    rc = run_daily.main(["--store", str(store), "--out", str(out)],
                        http_get=fake_get, http_post=fake_post)
    assert rc == 0
    qa = json.loads((out / "qa.json").read_text())
    checks = {c["name"]: c for c in qa["checks"]}
    assert checks["longlead_ok"]["pass"] is False
    assert "longlead boom" in checks["longlead_ok"]["detail"]
    assert not (out / "longlead.json").exists()
    for name in ("dc_grades.json", "datacenter.json", "qa.json"):
        assert (out / name).exists(), name
```

(e) Append the schema-violation ordering test — copy the setup of `test_grades_schema_violation_fails_run` (lines 910-921), with these deltas:

```python
def test_longlead_schema_violation_fails_run(tmp_path, monkeypatch):
    # the LONGLEAD block's ValidationError re-raise must stay ahead of its
    # generic Exception handler -- a schema-invalid longlead.json must crash
    # the run, never deploy
    # (setup identical to test_grades_schema_violation_fails_run)
    monkeypatch.setattr(run_daily.longlead_json, "build",
                        lambda *a, **kw: {"as_of_curated": 123})
    with pytest.raises(jsonschema.ValidationError):
        run_daily.main(["--store", str(store), "--out", str(out)],
                       http_get=fake_get, http_post=fake_post)
    assert not (out / "qa.json").exists()  # run died before qa
```

- [ ] **Step 2: Run to verify failure**

Run: `.venv/bin/pytest tests/test_run_daily.py -q 2>&1 | tee /private/tmp/claude-501/-Users-ericwyluda-Development-macrogauge/1ee235e4-b91d-40b9-adbc-c2e9ee552844/scratchpad/task4-red.log`
Expected: FAIL — `AttributeError: module 'pipeline.run_daily' has no attribute 'longlead_json'`, missing `longlead.json`, `qa["total"]` still 26.

- [ ] **Step 3: Implement.**

(a) `pipeline/run_daily.py` imports: add `dc_longlead` to the `from pipeline import collect, dc_basket, dc_context, dc_power, registry, release_calendar` line (alphabetical: `dc_basket, dc_context, dc_longlead, dc_power`); add `longlead as longlead_json,` inside the `from pipeline.publish import (...)` block (alphabetical position).

(b) Module docstring (line ~22): the ok-flag roster ending `... / grades_ok)` becomes `... / grades_ok / longlead_ok)`.

(c) Insert after the GRADES `_run_phase` call (line ~389):

```python
    # Long-lead equipment board (/longlead): isolated like the phases above.
    # Config-only and stated-only -- a curation typo must degrade this
    # artifact alone. It re-runs the DC engine off the same conn rather than
    # sharing another phase's local result (the _grades_phase precedent): a
    # broken engine nulls the board's price legs without blanking the
    # hand-curated vendor rows.
    def _longlead_phase():
        registry_codes = {s.code for s in series}
        _, baskets = dc_basket.load_baskets(registry_codes=registry_codes)
        build_components = baskets["build"]
        cfg = dc_longlead.load(
            build_codes={c.code for c in build_components})
        try:
            dc_result = dcindex.run(
                conn, today=today,
                staleness={s.code: s.max_staleness_days for s in series})
        except Exception:
            dc_result = None  # price legs go null; vendor rows still publish
        ll_path = longlead_json.write(
            longlead_json.build(cfg, build_components, dc_result, today=today),
            args.out, published_at=published_at)
        validate.validate_file(ll_path, SCHEMAS / "longlead.schema.json")
        print(f"published: {ll_path}")

    _run_phase("LONGLEAD", _longlead_phase, phase_errors, "longlead")
```

(d) `pipeline/publish/qa.py`: append `"longlead"` to the `PHASES` tuple and `"longlead": "long-lead board completed"` to `_PHASE_DONE`.

- [ ] **Step 4: Run to verify green**

Run: `.venv/bin/pytest tests/test_run_daily.py -q && .venv/bin/pytest -q 2>&1 | tee /private/tmp/claude-501/-Users-ericwyluda-Development-macrogauge/1ee235e4-b91d-40b9-adbc-c2e9ee552844/scratchpad/task4-green.log`
Expected: all pass; full suite ≥ Task 3's count + 2.

- [ ] **Step 5: Generate the site artifact from the committed store** (no network, no store mutation — the site build imports this file, so it must exist before Task 5):

```bash
.venv/bin/python - <<'EOF' 2>&1 | tee /private/tmp/claude-501/-Users-ericwyluda-Development-macrogauge/1ee235e4-b91d-40b9-adbc-c2e9ee552844/scratchpad/task4-generate.log
from datetime import datetime, timezone
from pathlib import Path

from pipeline import dc_basket, dc_longlead, registry
from pipeline.connectors.fred import today_et
from pipeline.engine import dcindex
from pipeline.publish import longlead as longlead_json, validate
from pipeline.store import vintage

conn = vintage.load(Path("store"))
_, series = registry.load_registry()
_, baskets = dc_basket.load_baskets(registry_codes={s.code for s in series})
cfg = dc_longlead.load(build_codes={c.code for c in baskets["build"]})
dc_result = dcindex.run(conn, today=today_et(),
                        staleness={s.code: s.max_staleness_days for s in series})
path = longlead_json.write(
    longlead_json.build(cfg, baskets["build"], dc_result, today=today_et()),
    Path("site/public/data"),
    published_at=datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"))
validate.validate_file(path, Path("schemas/longlead.schema.json"))
print(f"published: {path}")
EOF
git status --short   # expect exactly one new file: site/public/data/longlead.json
```

Sanity-check the output file by eye: five packages, price legs populated (the committed store has the PPI history), vendor figures matching the config.

- [ ] **Step 6: Commit**

```bash
git add pipeline/run_daily.py pipeline/publish/qa.py tests/test_run_daily.py site/public/data/longlead.json
git commit -m "feat(p4): longlead as twelfth isolated phase (longlead_ok) + first published artifact"
```

---

### Task 5: `/longlead` page — types, format helper, page, nav, e2e route

**Files:**
- Modify: `site/src/lib/types.ts` (append LongLead types)
- Create: `site/src/lib/longLead.ts`, `site/src/lib/longLead.test.ts`
- Create: `site/src/app/longlead/page.tsx`
- Modify: `site/src/lib/nav.ts` (AI Infra section), `site/e2e/smoke.spec.ts` (ROUTES)

**Interfaces:**
- Consumes: `site/public/data/longlead.json` (Task 4); `KpiCard` (`{label, value, context, accent?, chip?}` — `value` is a pre-formatted string); CSS classes `kpi-row`, `table-card`, `data-table`, `badge`, `badge badge-muted`, `method`, `subtitle`; `fmtSigned` from `@/lib/format`.
- Produces: `LongLead`/`LongLeadPackage`/`LongLeadVendor`/`LongLeadFigure` types in `@/lib/types`; `fmtFigure(value, unit)`, `BASIS_LABELS`, `KIND_LABELS` in `@/lib/longLead` (Task 6's strip imports these).

- [ ] **Step 1: Append types to `site/src/lib/types.ts`:**

```ts
export type LongLeadFigure = {
  metric: string;
  kind: "backlog" | "orders" | "book_to_bill" | "backlog_growth";
  basis: "rpo" | "order-backlog" | "mdna-backlog";
  scope: "group" | "segment" | "product-line";
  value: number;
  unit: "usd_b" | "eur_b" | "jpy_tn" | "pct_yoy" | "ratio";
  period: string;
  asof: string;
  quote: string;
  src: { label: string; url: string };
};

export type LongLeadVendor = {
  key: string;
  name: string;
  ticker: string;
  listed: string;
  dc_segment: string;
  cadence: "quarterly" | "annual";
  stale: boolean;
  figures: LongLeadFigure[];
  null_note: string | null;
};

export type LongLeadPackage = {
  code: string;
  label: string;
  weight: number;
  price_yoy_pct: number | null;
  price_last_obs: string | null;
  contribution_pp: number | null;
  null_note: string | null;
  vendors: LongLeadVendor[];
};

export type LongLead = {
  published_at: string;
  as_of_curated: string;
  build_weight_covered: number;
  teaser: { vendor: string; name: string; figure: LongLeadFigure }[];
  packages: LongLeadPackage[];
};
```

- [ ] **Step 2: Write the failing vitest** — create `site/src/lib/longLead.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { BASIS_LABELS, KIND_LABELS, fmtFigure } from "./longLead";

describe("fmtFigure", () => {
  it("formats dollar billions", () => {
    expect(fmtFigure(176, "usd_b")).toBe("$176B");
    expect(fmtFigure(15.05, "usd_b")).toBe("$15.1B");
  });
  it("formats euro billions", () => {
    expect(fmtFigure(25.362, "eur_b")).toBe("€25.4B");
  });
  it("formats yen trillions", () => {
    expect(fmtFigure(9.2, "jpy_tn")).toBe("¥9.2tn");
  });
  it("formats signed percent growth", () => {
    expect(fmtFigure(44, "pct_yoy")).toBe("+44% YoY");
    expect(fmtFigure(-5.5, "pct_yoy")).toBe("-5.5% YoY");
  });
  it("formats ratios", () => {
    expect(fmtFigure(2.9, "ratio")).toBe("2.9x");
    expect(fmtFigure(1.2, "ratio")).toBe("1.2x");
  });
});

describe("labels", () => {
  it("covers every basis and kind", () => {
    expect(Object.keys(BASIS_LABELS).sort()).toEqual(
      ["mdna-backlog", "order-backlog", "rpo"]);
    expect(Object.keys(KIND_LABELS).sort()).toEqual(
      ["backlog", "backlog_growth", "book_to_bill", "orders"]);
  });
});
```

- [ ] **Step 3: Run to verify failure**

Run: `cd site && npm test 2>&1 | tee /private/tmp/claude-501/-Users-ericwyluda-Development-macrogauge/1ee235e4-b91d-40b9-adbc-c2e9ee552844/scratchpad/task5-red.log`
Expected: FAIL — cannot resolve `./longLead`.

- [ ] **Step 4: Create `site/src/lib/longLead.ts`:**

```ts
import type { LongLeadFigure } from "./types";

// Number formatting only — the values themselves are company-stated and
// pass through verbatim from the artifact (stated-only, spec §3).
const trim = (v: number) => {
  const rounded = Number(v.toFixed(1));
  return `${rounded}`;
};

export function fmtFigure(value: number, unit: LongLeadFigure["unit"]): string {
  switch (unit) {
    case "usd_b":
      return `$${trim(value)}B`;
    case "eur_b":
      return `€${trim(value)}B`;
    case "jpy_tn":
      return `¥${trim(value)}tn`;
    case "pct_yoy":
      return `${value >= 0 ? "+" : ""}${trim(value)}% YoY`;
    case "ratio":
      return `${value.toFixed(1)}x`;
  }
}

// Three different accounting objects — rendered as badges, never summed,
// never on one axis (spec §2.4).
export const BASIS_LABELS: Record<LongLeadFigure["basis"], string> = {
  rpo: "RPO",
  "order-backlog": "Order backlog",
  "mdna-backlog": "MD&A backlog",
};

export const KIND_LABELS: Record<LongLeadFigure["kind"], string> = {
  backlog: "Backlog",
  orders: "Orders",
  book_to_bill: "Book-to-bill",
  backlog_growth: "Backlog growth",
};
```

- [ ] **Step 5: Run to verify green**

Run: `cd site && npm test 2>&1 | tee /private/tmp/claude-501/-Users-ericwyluda-Development-macrogauge/1ee235e4-b91d-40b9-adbc-c2e9ee552844/scratchpad/task5-green-vitest.log`
Expected: all pass, 137 + 6 = 143 tests.

- [ ] **Step 6: Create `site/src/app/longlead/page.tsx`** (server component — static tables, no `"use client"`):

```tsx
import type { Metadata } from "next";
import llJson from "../../../public/data/longlead.json";
import { KpiCard } from "@/components/KpiCard";
import { fmtSigned } from "@/lib/format";
import { BASIS_LABELS, KIND_LABELS, fmtFigure } from "@/lib/longLead";
import type { LongLead, LongLeadPackage, LongLeadVendor } from "@/lib/types";

const data = llJson as unknown as LongLead;

export const metadata: Metadata = {
  title: "Long-Lead Board: vendor order books vs equipment prices",
  description:
    "Switchgear, transformers, generators, HVAC, pumps — the PPI YoY we already publish beside what each vendor's own filings say about its order book.",
};

function VendorRow({ vendor }: { vendor: LongLeadVendor }) {
  return (
    <tr>
      <td>
        <strong>{vendor.name}</strong>{" "}
        <span className="badge badge-muted">{vendor.ticker}</span>
        {vendor.cadence === "annual" && (
          <span className="badge badge-muted">annual</span>
        )}
        {vendor.stale && <span className="badge">stale</span>}
        <div className="subtitle">{vendor.dc_segment}</div>
      </td>
      <td style={{ textAlign: "left" }}>
        {vendor.null_note ? (
          <span className="method">{vendor.null_note}</span>
        ) : (
          vendor.figures.map((f) => (
            <div key={`${f.kind}:${f.metric}`} style={{ marginBottom: 6 }}>
              <strong>{fmtFigure(f.value, f.unit)}</strong>{" "}
              {KIND_LABELS[f.kind]}{" "}
              <span className="badge badge-muted">{BASIS_LABELS[f.basis]}</span>{" "}
              <span className="badge badge-muted">{f.scope}</span>{" "}
              <span className="subtitle">
                {f.period} · <a href={f.src.url}>{f.src.label}</a>
              </span>
              <div className="method">“{f.quote}”</div>
            </div>
          ))
        )}
      </td>
    </tr>
  );
}

function PackageSection({ pkg }: { pkg: LongLeadPackage }) {
  return (
    <section>
      <h2>
        {pkg.label}{" "}
        <span className="subtitle">
          weight {pkg.weight} ·{" "}
          {pkg.price_yoy_pct === null
            ? "price YoY unavailable"
            : `PPI ${fmtSigned(pkg.price_yoy_pct)} YoY as of ${pkg.price_last_obs}`}
        </span>
      </h2>
      <div className="table-card">
        <table className="data-table">
          <thead>
            <tr>
              <th>Vendor</th>
              <th style={{ textAlign: "left" }}>Stated order-book figures</th>
            </tr>
          </thead>
          <tbody>
            {pkg.vendors.length === 0 ? (
              <tr>
                <td colSpan={2} style={{ textAlign: "left" }}>
                  <span className="method">{pkg.null_note}</span>
                </td>
              </tr>
            ) : (
              pkg.vendors.map((v) => <VendorRow key={v.key} vendor={v} />)
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}

export default function Page() {
  const priced = data.packages.filter((p) => p.price_yoy_pct !== null);
  return (
    <main>
      <h1>Long-Lead Board</h1>
      <p className="lede">
        The binding constraint in DC delivery is availability, not just price.
        This board joins the equipment PPI YoY we already publish with what
        each vendor&apos;s own filings and earnings documents say about its
        order book — a directional proxy for lead-time pressure, not a
        lead-time quote in weeks. Every figure links to the company document
        that states it.
      </p>
      <div className="kpi-row">
        <KpiCard
          label="Packages tracked"
          value={`${data.packages.length}`}
          context={`${data.build_weight_covered} of DC Build weight`}
        />
        <KpiCard
          label="Price legs live"
          value={`${priced.length}/${data.packages.length}`}
          context="PPI YoY at each component's own last observation"
          accent="emerald"
        />
        <KpiCard
          label="Curated"
          value={data.as_of_curated}
          context="refreshed each earnings season"
          accent="amber"
        />
      </div>
      {data.packages.map((pkg) => (
        <PackageSection key={pkg.code} pkg={pkg} />
      ))}
      <h2>Reading the bases</h2>
      <p className="method">
        “Backlog” is not one number. <strong>RPO</strong> is ASC-606 remaining
        performance obligations from the financial statements.{" "}
        <strong>Order backlog</strong> is the company&apos;s own orders-based
        order book. <strong>MD&amp;A backlog</strong> is a
        believed-to-be-firm management figure. Caterpillar&apos;s Q1 2026
        filings carry a $62.7B MD&amp;A backlog and a $37.1B RPO
        simultaneously — same company, same quarter, different accounting
        objects. That is why every figure here carries a basis badge, and why
        figures with different bases are never summed and never share an
        axis.
      </p>
      <p className="method">
        Figures are stated-only: each one is published exactly as the vendor
        stated it, with its verbatim sentence and a link to the primary
        source. Nothing is derived — no computed book-to-bill, no
        cross-vendor aggregate. Vendors that disclose nothing at
        primary-source standard are shown as explicit nulls with the reason;
        that a supplier publishes no order-book figure is itself worth
        knowing. Quarterly figures flag stale after 120 days, annual after
        430. Curated {data.as_of_curated}.
      </p>
    </main>
  );
}
```

- [ ] **Step 7: Nav.** In `site/src/lib/nav.ts`, append to the AI Infra section's `items` array (after the `/markets` entry). First check emoji uniqueness: `grep -c "⏳" site/src/lib/nav.ts` must return 0 — if taken, use the first unused of 📦, 🧰 (check each the same way):

```ts
          { href: "/longlead", label: "Long-Lead Board", emoji: "⏳" },
```

- [ ] **Step 8: e2e route.** In `site/e2e/smoke.spec.ts`, append to `ROUTES` (marker text is from the page's lede and unique to its body):

```ts
  ["/longlead", "not a lead-time quote in weeks"],
```

- [ ] **Step 9: Build + e2e**

Run: `cd site && npm run build && npm run e2e 2>&1 | tee /private/tmp/claude-501/-Users-ericwyluda-Development-macrogauge/1ee235e4-b91d-40b9-adbc-c2e9ee552844/scratchpad/task5-green-e2e.log`
Expected: build succeeds (static export includes `/longlead`); 30 routes / 46 e2e tests pass, zero console errors.

- [ ] **Step 10: Commit**

```bash
git add site/src/lib/types.ts site/src/lib/longLead.ts site/src/lib/longLead.test.ts site/src/app/longlead/page.tsx site/src/lib/nav.ts site/e2e/smoke.spec.ts
git commit -m "feat(p4): /longlead board page — stated-only vendor rows, basis badges, honest nulls"
```

---

### Task 6: `/datacenter` teaser strip

**Files:**
- Create: `site/src/components/LongLeadStrip.tsx`
- Modify: `site/src/app/datacenter/page.tsx` (import + render), `site/src/app/globals.css` (one rule), `site/e2e/smoke.spec.ts` (one feature test)

**Interfaces:**
- Consumes: `LongLead` type and `fmtFigure`/`KIND_LABELS` (Task 5); `site/public/data/longlead.json` (Task 4); the `{power && <PowerPanel .../>}` / `{context && <ContextPanel .../>}` render block in `datacenter/page.tsx` (lines ~204-207).
- Produces: `LongLeadStrip({ longlead }: { longlead: LongLead })`, `data-testid="longlead-strip"`.

- [ ] **Step 1: Create `site/src/components/LongLeadStrip.tsx`:**

```tsx
import Link from "next/link";
import { KIND_LABELS, fmtFigure } from "@/lib/longLead";
import type { LongLead } from "@/lib/types";

// Chips are the config-curated `teaser` picks (spec §5) — the site never
// chooses or computes a highlight itself.
export function LongLeadStrip({ longlead }: { longlead: LongLead }) {
  return (
    <div className="table-card strip-row" data-testid="longlead-strip">
      <span className="badge">Long-lead</span>
      {longlead.teaser.map((t) => (
        <span key={`${t.vendor}:${t.figure.kind}`}>
          {t.name} {KIND_LABELS[t.figure.kind].toLowerCase()}{" "}
          <strong>{fmtFigure(t.figure.value, t.figure.unit)}</strong>
        </span>
      ))}
      <span className="subtitle">
        {longlead.packages.length} packages · {longlead.build_weight_covered}{" "}
        of Build weight
      </span>
      <Link href="/longlead">Long-Lead Board →</Link>
    </div>
  );
}
```

- [ ] **Step 2: Add the CSS rule** to `site/src/app/globals.css`, next to the `.table-card` rule (~line 167):

```css
.strip-row { display: flex; gap: 16px; align-items: center; flex-wrap: wrap; padding: 12px 16px; font-size: 13px; }
```

- [ ] **Step 3: Wire into `site/src/app/datacenter/page.tsx`.** Add to the import block:

```tsx
import llJson from "../../../public/data/longlead.json";
import { LongLeadStrip } from "@/components/LongLeadStrip";
import type { LongLead } from "@/lib/types";
```

Declare beside the module's other consts: `const longlead = llJson as unknown as LongLead;`
Then render after the ContextPanel line (`{context && <ContextPanel context={context} />}`):

```tsx
      {longlead && longlead.teaser.length > 0 && (
        <LongLeadStrip longlead={longlead} />
      )}
```

- [ ] **Step 4: e2e feature test.** Append to `site/e2e/smoke.spec.ts` after the existing named feature tests:

```ts
test("datacenter long-lead strip links to the board", async ({ page }) => {
  await page.goto("/datacenter");
  const strip = page.getByTestId("longlead-strip");
  await expect(strip).toBeVisible();
  await strip.getByRole("link", { name: /long-lead board/i }).click();
  await expect(page).toHaveURL(/\/longlead\/?$/);
});
```

- [ ] **Step 5: Build + full site suite**

Run: `cd site && npm run build && npm test && npm run e2e 2>&1 | tee /private/tmp/claude-501/-Users-ericwyluda-Development-macrogauge/1ee235e4-b91d-40b9-adbc-c2e9ee552844/scratchpad/task6-green.log`
Expected: build green; vitest 143; e2e 30 routes / 47 tests, zero console errors.

- [ ] **Step 6: Commit**

```bash
git add site/src/components/LongLeadStrip.tsx site/src/app/datacenter/page.tsx site/src/app/globals.css site/e2e/smoke.spec.ts
git commit -m "feat(p4): /datacenter long-lead teaser strip (config-curated picks)"
```

---

### Task 7: docs, register, final verification

**Files:**
- Modify: `CLAUDE.md`, `docs/plans/2026-07-24-project-controls-gaps.md`

- [ ] **Step 1: CLAUDE.md count updates** (current text verbatim → new):
  - Line 18: `pytest -q                                     # full suite (813 tests)` → replace `813` with the actual collected count from `.venv/bin/pytest -q --collect-only 2>&1 | tail -1` (expected ≈ 850 — use the observed number, never this estimate).
  - Line 29: append `/longLead` to the parenthesized vitest list: `... (since/reweight/realwage/quiltRows/dcEscalation/dcMarkets/longLead)`.
  - Line 30: `# Playwright smoke — 29 routes / 45 e2e tests` → `30 routes / 47 e2e tests`.
  - Line 97: `35 published files` → `36 published files`.
  - Lines 106-108 (the published-file enumeration's final sentence, ending `...plus the unfilled-orders lead-lag verdict).`): append `, and the long-lead equipment board (`longlead` — hand-curated, stated-only vendor order-book figures joined to the five long-lead packages' price legs)`.
  - Lines 117-122: `eleven ISOLATED` → `twelve ISOLATED`; append `, and long-lead board` to the phase list after `DC escalation grading harness`; append `/ `longlead_ok`` to the ok-flag roster.
- [ ] **Step 2: Register update.** In `docs/plans/2026-07-24-project-controls-gaps.md` P4 section: change `**Status:** not started` to `**Status:** shipped 2026-07-27 on \`feat/dc-longlead\`` and append one correction paragraph after the "New approach" paragraph:

```markdown
**⚠ CORRECTION (P4 recon, verified 2026-07-26 —
`docs/superpowers/specs/2026-07-26-dc-longlead-board-design.md` §2). The "FMP connector, new
endpoint" premise above is overstated — do not re-derive.** FMP has no orders/backlog/book-to-bill
endpoint (docs grep: zero matches; guessed route 404s); its as-reported XBRL feed returns
per-ticker-untrustworthy values (Vertiv: $24.5M RPO against its own $10.23B revenue in the same
response). SEC EDGAR's XBRL API is clean for only GEV/CAT and silently truncates ETN/CMI when
filers move the RPO total onto a typed dimension. What shipped instead: hand-curated stated-only
figures (`config/dc_longlead.json` → `longlead.json` → `/longlead` + a `/datacenter` strip),
basis-badged (RPO / order-backlog / MD&A-backlog are three different accounting objects — CAT
carries $62.7B and $37.1B simultaneously), with published nulls for Cummins (zero order-book
disclosure) and pumps (no roster vendor at standard). Derivation was dropped entirely: FX, M&A,
and tag-scope drift live exactly where the register's "backlog growth against revenue" idea
would compute.
```

- [ ] **Step 3: Full verification** (tee everything):

```bash
.venv/bin/pytest -q 2>&1 | tee /private/tmp/claude-501/-Users-ericwyluda-Development-macrogauge/1ee235e4-b91d-40b9-adbc-c2e9ee552844/scratchpad/task7-pytest.log
cd site && npm run build && npm test && npm run e2e 2>&1 | tee /private/tmp/claude-501/-Users-ericwyluda-Development-macrogauge/1ee235e4-b91d-40b9-adbc-c2e9ee552844/scratchpad/task7-site.log
```

Expected: pytest all green (≈850); build green; vitest 143; e2e 30 routes / 47 tests. Record the exact observed numbers — they go in CLAUDE.md (Step 1) and the final report.

- [ ] **Step 4: Commit**

```bash
git add CLAUDE.md docs/plans/2026-07-24-project-controls-gaps.md
git commit -m "docs(p4): register P4 shipped + premise correction; CLAUDE.md counts (36 files, twelve phases)"
```

---

## Acceptance walk (spec §10)

1. Every `/longlead` number traces to a company document — each figure renders its `src` link; the config's loader rejects any figure without an https source and a verbatim quote.
2. No derived figure — the publisher's only arithmetic is `weight × yoy` (price leg, datacenter-publisher rule) and the staleness age; grep `pipeline/publish/longlead.py` for arithmetic on `f.value`: none.
3. Bases never share an axis/sum — the board renders figures as per-vendor chips with basis badges; no chart, no totals row; the schema documents the rule on the `basis` field.
4. Cummins + pumps render as explicit reasoned nulls — pinned by `test_load_real_config`, the run_daily e2e assertions, and the page's null rendering.
5. Config values entered only from Task 1's SPIKE-FINAL with teed evidence.
6. Full suites green — Task 7 Step 3 logs are the record.
