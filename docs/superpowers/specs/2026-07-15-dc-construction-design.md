# DC Construction Boom Design — Census C30 nominal + real-terms deflate (Wave 2)

**Status:** Approved 2026-07-15 (brainstorming session; series decision: both SAAR level and NSA
YoY). Follows the 2026-07-15 enhancement research and Wave 1 (DC Hardware index, shipped 9d68daf).
**Inputs:** `docs/superpowers/specs/2026-07-15-dc-hardware-index-design.md` (wave 1 patterns);
`pipeline/connectors/zillow.py` (full-history-per-fetch precedent), `pipeline/connectors/aaa.py`
(drift-protection convention); `pipeline/store/vintage.py` (`append` dedupes by value — daily
full-history refetch writes only genuine revisions); live workbook layout verified 2026-07-15.

A "construction boom" section on `/datacenter`: monthly US data-center construction spending from
Census C30 "Value of Construction Put in Place" — the most-cited chart in the space, with **no
FRED mirror** (all 144 series of FRED release 229 enumerated 2026-07-15: zero data-center hits;
Census's EITS API is retired — HTTP 302 — so the published workbook is the only programmatic
route). The twist only this site can publish: **real** DC construction, nominal SAAR deflated by
our own DC Build input-cost index.

## 1. Scope

**In scope (wave 2):**

1. **CENSUS connector** (new source key, keyless) parsing two workbooks; two registry series.
2. **Engine block** — pure function assembling nominal SAAR, real SAAR (2018-01 dollars via the
   DC Build deflator), NSA same-month YoY, and headline scalars.
3. **Publish** — nullable `construction` block in `datacenter.json` (schema-pinned).
4. **Site** — stat cards + two-line chart + methodology sentence on `/datacenter`.

**Out of scope:** other C30 columns (office, manufacturing — future comparison series); state-level
construction spend (C30 is national-only for this column); seasonal-adjustment of our own
(we publish Census's SA and Census's NSA, never our own model).

## 2. Decisions locked in brainstorming

1. **Both series, split roles.** Level chart = SAAR ("annualized rate" — the famous smooth curve);
   YoY stat = NSA same-month-prior-year (immune to SA-model revisions). Real-terms deflate applies
   to the SAAR level.
2. **openpyxl becomes a pipeline dependency** (`openpyxl>=3.1` in `pyproject.toml`) — the repo's
   first beyond requests/jsonschema, justified by the retired EITS API leaving xlsx as the only
   route. No hand-rolled xlsx XML parsing.
3. **Data lives in `datacenter.json`** (~6 KB block), not a new artifact — one page, one file,
   existing `datacenter_ok` isolation.
4. **The block is nullable.** Before the first successful CENSUS collect (and in test contexts
   without Census fixtures wired), the engine returns `None` and the page hides the section.

## 3. Source & series

**Workbooks** (keyless GETs, updated with each monthly C30 release, ~1st business day, 2-month lag):

| File | Sheet | Content |
|---|---|---|
| `https://www.census.gov/construction/c30/xlsx/privsatime.xlsx` | `Private SA` | Seasonally adjusted **annual rate**, $M |
| `https://www.census.gov/construction/c30/xlsx/privtime.xlsx` | `Private NSA` | NSA **monthly**, $M |

**Layout facts (verified live 2026-07-15, both files identical structure):** header row 4
(`Date`, `Total Private`, …, `Data center` at column index 9 — but the column MUST be located by
header text, never position); data rows newest-first from row 5 (`May-26p`); date labels
`%b-%y` with optional trailing revision suffix `p`/`r`; footer disclosure-note rows after the
data block (first cell empty or long text). Header cells contain embedded newline junk
(`Total\n_x000D_Pri…`) — normalize whitespace before matching. Values verified: NSA Data center
2014-01 = 124 → 2026-05p = 5,059 $M; SAAR ≈ 12× monthly scale.

**Registry (2 new series, source `CENSUS`):**

| code | source_id | name | staleness |
|---|---|---|---|
| `census_dc_constr_saar` | `privsatime.xlsx:Data center` | DC construction spend, SAAR ($M, annual rate) | 75 |
| `census_dc_constr_nsa` | `privtime.xlsx:Data center` | DC construction spend, NSA ($M/month) | 75 |

`source_id` format is `<filename>:<column header>`; the connector splits on the first `:` and
builds the URL as `https://www.census.gov/construction/c30/xlsx/<filename>`. New `sources` entry:
`"CENSUS": {"route": "XLSX", "cadence": "monthly"}` (no secret). Sources count 16 → 17.

## 4. Connector (`pipeline/connectors/census.py`)

`fetch(source_ids, http_get=None) -> list[Observation]`, same shape as the other keyless
connectors; registered in `collect.py` `FETCHERS` under `CENSUS` (collect remaps
source_id → registry code via the existing `id_map`). Behavior:

- Group requested ids by filename; **one GET per distinct file** even if multiple columns are
  ever requested from it. Parse `resp.content` bytes via `openpyxl.load_workbook(BytesIO(...),
  read_only=True)`.
- **Drift protection (house convention, xlsx dialect):** (a) first sheet's name must be the
  expected one for the file (`Private SA` / `Private NSA`) — else `ValueError("… structure
  drift?")`; (b) header row = the first row in rows 1–8 whose first cell is `Date` — else drift
  error; (c) target column = header cell whose whitespace-normalized text equals the source_id's
  column name (case-insensitive) — else drift error; (d) date labels must match
  `^[A-Z][a-z]{2}-\d{2}[pr]?$` — rows are parsed until the first non-matching first cell
  (footer); **zero parsed rows = drift error**; (e) plausible-range check: every parsed value in
  [50, 500 000] $M — else drift error (covers NSA 124→5 059 and SAAR ~1 500→61 000 with headroom).
- Date parsing: strip the `p`/`r` suffix, `%b-%y` → ISO first-of-month (`May-26p` → `2026-05-01`).
  Blank/None cells in the target column skip that row (the column starts 2014; earlier rows are
  legitimately empty), they are never an error.
- Full 2014→now history is emitted on every fetch with `vintage_date = today`;
  `vintage.append`'s value-dedupe means only genuine revisions write rows (Zillow precedent) —
  and Census `p`→`r`→final revisions therefore land as an auditable vintage trail.
- Failure isolation: any error inside `fetch` fails only the `CENSUS` `SourceResult`
  (`collect_all`'s existing boundary); carry-forward makes missed days harmless.

## 5. Engine (`pipeline/engine/dcindex.py`)

New pure function, called from `run_daily`'s datacenter phase after `dcindex.run`:

```
construction_block(saar: dict[date→$M], nsa: dict[date→$M],
                   build_index: dict[date→idx]) -> dict | None
```

- Returns `None` when `saar` or `nsa` is empty (source not yet collected) — never raises.
- `months`: sorted obs months of the SAAR series (full 2014→ history; PUBLISH_START does NOT
  truncate — this is a dollars series, not a rebased index).
- `saar`: nominal $M values aligned to `months`.
- `real`: `saar[m] / (build_index[m] / 100)` — constant **2018-01 dollars** (the Build index is
  2018-01=100); deflator sampled at each month's first day from the Build **daily grid**; `null`
  where the deflator doesn't exist (months before the Build grid start, 2017-01, and any month
  past the Build grid's end — both boundaries honest, stated in methodology).
- `yoy_pct`: NSA same-month-prior-year, `(nsa[m] / nsa[m−12mo] − 1) × 100` at the NSA series' own
  last observation; `None` if the base month is missing. Month arithmetic, not the 365-day daily
  grid — this series never enters an index basket.
- Scalars: `as_of` (latest SAAR month), `latest_saar` ($M), `yoy_asof` (latest NSA month),
  `vs_2014_avg` = latest SAAR ÷ mean(SAAR over 2014 months) — the "×40 since 2014" stat, pinned
  to the 2014 *average* so a single January-2014 low can't inflate it.
- A store-reading wrapper (`construction_from_store(conn, dc_result)`) pulls the two series via
  `vintage.latest` and the Build daily index out of `dc_result["indexes"]["build"]["index"]`,
  then delegates to the pure function — same split as `parity_from_store`/`parity_rows`.

## 6. Publish + schema

`datacenter.json` gains top-level `construction` (required key, `object | null`):

```json
{"as_of": "2026-05-01", "unit": "$M",
 "latest_saar": 61000.0, "yoy_pct": 30.2, "yoy_asof": "2026-05-01", "vs_2014_avg": 39.8,
 "months": ["2014-01-01", …], "saar": [1512.0, …], "real": [null, …, 41200.0]}
```

- Writer rounds values to 1 dp ($M scale), `real` entries `null` where undefined; arrays share
  `months`' length (schema can't express that — a writer test pins it).
- Schema: top-level `required` gains `construction`; `type: ["object", "null"]` with the field
  schema above. Validation stays inline in the phase; `ValidationError` still fails the run.
- Payload: ~150 months × 3 arrays ≈ 6 KB. No trim needed.

## 7. Site page

`/datacenter`, new section "The construction boom" between the hedonic-gap panel and state parity,
rendered only when `dc.construction` is non-null:

1. **Stat cards** (existing `KpiCard`): latest SAAR as `$XX.XB/yr` (values arrive $M — display
   division by 1000 with a unit label is presentation, parity-strip precedent); NSA YoY
   (`fmtSigned`); `×{vs_2014_avg}` vs 2014 average.
2. **`DcConstructionChart`** (new client component): two lines on one $B axis — nominal SAAR
   (sky) and real 2018-$ SAAR (amber); echarts with the house `baseOption`, PNG-export via the
   `wrapRef`/`getInstanceByDom` pattern, no mode toggle (both lines fit one axis). Nulls in
   `real` simply truncate that line (echarts skips null points).
3. **Methodology sentence** appended to the existing method paragraph: Census C30 source +
   two-month lag, the no-FRED-mirror fact, SAAR-level/NSA-YoY split, and "real = deflated by our
   DC Build index to constant 2018-01 dollars — a series that requires a DC-specific input-cost
   deflator to exist."

No nav/route changes; e2e stays 21 routes; no new client math (arrays pre-baked) → no new vitest.

## 8. Testing

- **Connector:** fixture xlsx bytes are GENERATED in-test with openpyxl (`BytesIO` save — no
  binary blobs in the repo, no network): happy-path parse (both files' sheet names), p/r suffix
  stripping, blank-cell skip, footer stop, and one drift test per check (wrong sheet name,
  missing Date header, missing "Data center" column, out-of-range value, zero data rows).
- **collect wiring:** `tests/test_run_daily.py` `fake_get` gains a census.gov branch returning
  fixture xlsx bytes (a small bytes-response fake alongside `_TextResponse`); source-count pin
  16 → 17 (`test_run_daily.py:146`), registry pins 240 → 242 series and the sources set in
  `test_registry.py`.
- **Engine (pure dicts):** deflation worked example (saar 200, build index 125 → real 160);
  real `null` before the deflator's first month and past the Build grid end; NSA YoY worked
  example + missing-base None; `None` return on empty inputs; `vs_2014_avg` arithmetic.
- **Writer/schema:** null block validates; populated block validates; array-length-alignment pin;
  rounding.
- **Site:** build + e2e stay green; section hidden when `construction: null` (covered implicitly
  by build against regenerated real data; the null path is pipeline-tested).

## 9. Risks, ranked

1. **Workbook layout drift** — Census reshuffles columns/sheets occasionally. Mitigated by the
   five drift checks (§4); a drifted file fails only the CENSUS source row, page carries forward.
2. **openpyxl supply chain/step change** — first new dependency in the pipeline; pinned `>=3.1`,
   used read-only. CI installs it via `pip install -e ".[dev]"` unchanged.
3. **Revision churn** — `p`/`r` revisions rewrite recent months each release; value-dedupe
   append gives a clean vintage trail, and YoY-off-NSA avoids the SA model's deeper history
   revisions.
4. **Deflator coverage gap** — if the Build grid ends before the latest construction month, that
   month's `real` is null; the chart truncates honestly rather than extrapolating the deflator.
5. **Scale confusion (SAAR vs monthly)** — the two series differ ~12×; unit labels are pinned in
   the registry names, the published `unit` field, and the chart's "$B/yr (annualized)" axis
   label; the NSA series is published only as the YoY scalar, never as a level on the same chart.
