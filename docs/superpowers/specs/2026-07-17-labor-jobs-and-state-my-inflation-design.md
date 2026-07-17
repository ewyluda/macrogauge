# Labor jobs dashboard + state-level My Inflation — Design Spec

**Date:** 2026-07-17
**Branch:** `labor-state-inflation` (stacked on `p2-geography-wave`, which publishes `geo.json`)
**Roadmap:** todo.md #6 — "Land on-site promises: labor.json (real-wages footer) and state-level
My Inflation (QCEW wage + EIA state power multipliers already ingested)."

Two independent pieces on one branch. Each follows the repo's established conventions (one writer
per file, inline schema validation, isolated publish phase, degraded-safe payloads, site renders
only). TDD throughout; commit per task; **never push** (push = production deploy).

---

## Piece 1 — `labor.json` + `/labor` jobs dashboard

### Goal
Land the `labor.json` promised in the `/real-wages` footer ("AHE stands in until Phase 4's
labor.json") as a genuine jobs-market artifact, and render it as the Economy-group jobs page the
nowflation review flagged as missing. All source series are already collected; none are rendered as
a jobs view today.

### Data (all already in the store)
| Block | Series | Notes |
|---|---|---|
| payrolls | `PAYEMS` (thousands) | level, MoM change (latest − prior month, k), YoY % |
| unemployment | `UNRATE` | rate + `delta_1y_pp` (percentage-point change, NOT percent — matches geo.json) |
| claims | `ICSA`, `CCSA` | initial + 4-week avg of initial, continued |
| wages | `CES0500000003` (AHE $/hr), `FRBATLWGT3MMAUMHWGO` (Atlanta Fed WGT) | AHE YoY computed; WGT already a 12-mo growth % |

### `labor.json` shape (`pipeline/publish/labor.py` + `schemas/labor.schema.json`)
Pure `build(conn) -> dict`; `write(payload, out_dir, published_at)` per the real_wages/metros writer
contract. All fields nullable; empty store → all-null blocks that still validate (degraded-safe).

```
{
  "published_at": "...",
  "payrolls":     { "level_k": <num|null>, "mom_change_k": <num|null>, "yoy_pct": <num|null>, "as_of": <date|null> },
  "unemployment": { "rate": <num|null>, "delta_1y_pp": <num|null>, "as_of": <date|null> },
  "claims":       { "initial": <num|null>, "initial_4wk_avg": <num|null>, "continued": <num|null>, "as_of": <date|null> },
  "wages":        { "ahe_yoy_pct": <num|null>, "atlanta_wgt_pct": <num|null>, "as_of": <date|null> },
  "history": {
    "monthly": { "months": [...], "payrolls_yoy_pct": [<num|null>...], "unemployment_rate": [<num|null>...] },
    "weekly":  { "dates": [...], "initial_claims": [<num|null>...] }
  }
}
```

- **YoY / rounding conventions** (match geo.json / metros.json): payrolls YoY = like-month
  `months_back(as_of, 12)`, null if base absent/zero; MoM change = latest − prior calendar month
  (via `dates.prior_month`), null if prior month absent. AHE YoY computed the same way real_wages.py
  already does it. `delta_1y_pp` = rate − rate 12 months earlier (subtraction, base-is-None guard).
  Rounding: payrolls level/change 0dp, YoY/rate 1–2dp, claims 0dp, wages 2dp.
- **History tails** power the page's charts: monthly (payrolls YoY + unemployment rate) as the last
  36 monthly observations; weekly initial-claims as the last 52 weekly observations. These are the
  only source for those charts (no other published artifact carries them), so they live here.
- **No duplication of nowcast/accountability.** The NFP nowcast (`nowcast_latest.json`) and graded
  history (`accountability_nfp.json`) are already published; the page imports them directly. Keeping
  them out of `labor.json` preserves one-source-per-number.

### Publish wiring
- **New isolated `_labor_phase`** in `run_daily.py`, mirroring the `_geography_phase` exactly:
  build → write → `validate.validate_file(labor_path, SCHEMAS / "labor.schema.json")`. Wrapped in
  `_run_phase` so a labor failure surfaces as `labor_ok` and never blocks other phases, while a
  `jsonschema.ValidationError` still re-raises and fails the run.
- **New `labor_ok` QA check** in `qa.py` (mirrors `geography_ok`), fed a `labor_error` kwarg from
  `run_daily`. qa total 21 → 22. `test_qa.py` count pins bumped (+1 to the three always-on
  assertions), plus a `test_labor_ok_check`. The published_at stamp sweep auto-covers the new file.

### `/labor` page (`site/src/app/labor/page.tsx`)
- Static-imports `labor.json` (cast to a hand-written `Labor` type in `types.ts` — nullable fields),
  plus `nowcast_latest.json` and `accountability_nfp.json` for the jobs-day section.
- Layout (repo idiom, utility classes): KPI row (payrolls MoM change, unemployment rate + Δ1y,
  initial claims, wage growth) → 2–3 `EChart` trend charts (payrolls YoY, unemployment rate, initial
  claims) → **jobs-day preview** (NFP nowcast value + graded MAE/bias receipts from
  accountability_nfp) → method footnote.
- Nav: add to the **Economy** group in `nav.ts`; add `/labor` to the e2e smoke `ROUTES` with a
  unique body marker.
- **Honesty fix:** `/real-wages` footer sentence updated from "AHE stands in until Phase 4's
  labor.json" to point at the now-live `/labor`. Real-wages is otherwise unchanged (it keeps reading
  WGT + AHE directly; no behavior change).

---

## Piece 2 — state-level My Inflation (thin, honest, auto-growing)

### Goal
A state selector on `/my-inflation` that localizes the personal inflation rate for the components we
have real state YoY for today, with national fallback elsewhere and an explicit note on coverage —
so it delivers value now and grows automatically as state history accrues.

### Data source & mapping (site-only — no pipeline change)
`geo.json` (published by the P2 wave) already carries each state's latest YoY. Component → state
series mapping, confirmed against `config/basket.json`:

| Basket component | State series (geo.json field) | Status today |
|---|---|---|
| `electricity` | `states[st].elec_res_cents.yoy_pct` | **LIVE** (e.g. TX +9.47%) |
| `fuel` (gasoline) | `states[st].gas_regular.yoy_pct` | null until ~2027 (AAA state history accruing) → national fallback |

That is 1 live localizable component now (electricity), 1 pending (gasoline), auto-activating when
its YoY becomes non-null. All other 12 components stay national.

### Mechanism (`site/src/lib/reweight.ts` + `MyInflationClient.tsx` + `/my-inflation/page.tsx`)
- `/my-inflation/page.tsx` static-imports `geo.json` and passes `states` to `MyInflationClient`.
- `MyInflationClient` gains a state `<select>` (51 states from geo.json, "National" default). On
  selection it builds an `overrides: Record<componentCode, number>` map from the chosen state's
  non-null geo YoY: `{ electricity: <state elec_res yoy>, fuel: <state gas yoy if non-null> }`.
- `reweight.ts` `weightedYoY` and `contributions` gain an optional `overrides` param. Where an
  override exists for a component **at the latest index**, it replaces that component's own-obs YoY
  in the weighted sum and the drivers card. Signatures stay backward-compatible (param defaults to
  none → identical to today; existing vitest unchanged).

### KNOWN LIMITATION (pinned — do not "fix" by scope creep)
`geo.json` carries only each state's **latest** YoY, not a history tail. Therefore state localization
applies to the **headline "your inflation rate" number and the drivers card (latest snapshot) only**;
the historical personal-vs-gauge **chart stays national**. This is honest and, since electricity is
~2–3% of the basket, the localized headline delta is small-but-real (the point is "we can localize,
and it grows"). The page states this plainly. Localizing the chart would require publishing state YoY
history tails in geo.json — deliberately out of scope for this thin version.

### UI
- Under the selector: "*N of 14 components localized to [State]*" + the localized list (electricity
  now; gasoline shown as "pending — state history accrues ~2027").
- Retire the footer line "State-level localization arrives with Phase 4."

---

## Testing (TDD, no network in tests)
- `pipeline/publish/labor.py`: writer unit tests over a hand-built store — hand-computed payrolls
  YoY + MoM change, unemployment `delta_1y_pp`, claims 4wk avg, AHE YoY; degraded/empty-store
  validates against the schema; history-tail truncation.
- `run_daily` e2e (`test_run_daily.py`): `labor.json` lands, validates, carries the run stamp,
  `labor_ok` present; a labor-phase failure isolation test mirroring the geography one; a
  schema-violation-fails-run test. qa total assertion 21 → 22.
- `test_qa.py`: three count pins +1; `test_labor_ok_check`.
- `reweight.ts` vitest: an override changes the weighted YoY and a driver contribution by exactly the
  expected amount; no override = identical to today.
- e2e smoke: `/labor` route added; `/my-inflation` state-selector renders and changes the headline.
- Gate before "done": full `pytest -q`, `npm test`, `npm run e2e`, `npm run build`.

## Scope explicitly excluded
- Metro rent localization in My Inflation (separate metro-picker feature).
- Duplicating nowcast/accountability numbers into `labor.json`.
- Publishing state YoY history tails (would let the My Inflation chart localize) — future work.
- ECI / JOLTS / participation series in labor.json — the four blocks above are the MVP; more series
  are an additive follow-on.
