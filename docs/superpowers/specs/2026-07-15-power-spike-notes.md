# Power Tail Verification Spike Notes (2026-07-15)

Verification run against live CAISO OASIS, MISO marketreports, EIA's ICE workbook, and the
EIA v2 API (Henry Hub) — all keyless except Henry Hub (existing `EIA_API_KEY`). Corrects the
design doc's (`docs/superpowers/specs/2026-07-15-power-tail-design.md` §3) candidate strings
where a live fetch disagreed. These strings are authoritative for the connector tasks — where
this file disagrees with the design doc, this file wins.

**Headline results:** CAISO and MISO candidates verified almost exactly as proposed (one
DST/offset nuance on CAISO, one preamble-line-count correction on MISO). ICE's PJM hub label
verified exactly — but **the `ice_ercot_north` candidate does not exist anywhere in the source
file; no ERCOT/Texas hub of any kind is present.** Henry Hub's headline value (2.83, 2026-07-13)
matches the design doc exactly, but **the specific seriesid string `RNGWHHD` 404s** — the
working identifier is the compound v1-style id `NG.RNGWHHD.D`.

## 1. CAISO — SingleZip PRC_LMP DAM, node TH_SP15_GEN-APND

**URL (verified working, both test dates):**
```
https://oasis.caiso.com/oasisapi/SingleZip?queryname=PRC_LMP&startdatetime=<D>T07:00-0000&enddatetime=<D+1>T07:00-0000&version=1&market_run_id=DAM&node=TH_SP15_GEN-APND&resultformat=6
```
`D`/`D+1` = `YYYYMMDD`. Response: HTTP 200, `Content-Type: application/x-zip-compressed`, one
CSV inside (stdlib `zipfile` unzips cleanly, no browser UA needed — plain `curl` UA works).

**DST/offset finding (load-bearing, not in the design doc):** the `T07:00-0000` offset is only
clean during Pacific Daylight Time. Tested trade date 2026-01-02 (Pacific Standard Time month):
- `startdatetime=20260102T07:00-0000` → mixed result: 5 rows tagged `OPR_DT=2026-01-01` (the
  prior day's HE24) + 115 rows tagged `OPR_DT=2026-01-02` (HE1-23 only) — **not a clean single
  trade date**, and only 23 of 24 hours of the target date.
- `startdatetime=20260102T08:00-0000` → clean: all 120 rows `OPR_DT=2026-01-02` (full 24 hours).

**Recommendation for the connector:** don't trust the window boundary to equal one trade date;
always filter unzipped rows by the `OPR_DT` column against the intended date after unzip (a
correctness fix, not just a nicety — a hardcoded `T07:00` offset silently produces a
Frankenstein day during PST months, twice a year at DST transitions). Alternatively, compute the
GMT offset from the target date's Pacific-time DST status (07:00 PDT / 08:00 PST) — the `OPR_DT`
filter is the simpler, more robust fix and doesn't require a DST calendar.

**Exact CSV column names (16 columns, confirmed via header row):**
```
INTERVALSTARTTIME_GMT,INTERVALENDTIME_GMT,OPR_DT,OPR_HR,OPR_INTERVAL,NODE_ID_XML,NODE_ID,NODE,
MARKET_RUN_ID,LMP_TYPE,XML_DATA_ITEM,PNODE_RESMRID,GRP_TYPE,POS,MW,GROUP
```
(`INTERVALSTARTTIME_GMT`, `LMP_TYPE`, `MW` candidates all confirmed present, exact names.)

**LMP_TYPE filter value:** `LMP` (exact string). All 5 values present, 24 rows each on a normal
day: `LMP`, `MCC`, `MCE`, `MCL`, `MGHG` — filter must be `LMP_TYPE == "LMP"` or the other 4
components get averaged in too.

**Hourly row count:** filtering `LMP_TYPE=="LMP"` on an aligned window gives exactly **24** rows
(one/hour). Design doc's accepted range [20, 28] is fine for real DST days (verified structurally
via the PST-offset finding above, which produces 23- or 25-row artifacts from *misalignment*, not
genuine DST — a real spring-forward/fall-back day would show 23/25 in a correctly-aligned window).

**Daily means (2 dp):**
- 2026-07-14 (yesterday): **44.99** $/MWh (24 rows)
- 2026-07-15 (today): **44.39** $/MWh (24 rows) — confirms DAM data for the current trade date
  is available same-day (published prior afternoon, per design doc; fetched successfully at
  ~9:11pm ET, well after any 8:40am ET run).
- 2026-01-02 history probe (08:00 offset, clean window): **33.46** $/MWh (24 rows). History
  depth to 2026-01-02 confirmed live and working.

**Throttle behavior (confirmed, exact message):** two rapid successive requests (no sleep)
→ first returns 200, second (and a third, immediately after) both return **HTTP 429** with body:
```html
<html><body><p>CAISO Acceptable Use Policy Violation. Please retry your request after 5 seconds.</p></body></html>
```
A retry after a 6s sleep returns 200 again. **≥5s between requests is the exact, literal
threshold the server states** — the spec's "≥5s sleep" is confirmed correct, not just a safe
guess.

**5-row CSV excerpt (header + first 5 hours, LMP_TYPE=="LMP", 2026-07-14):**
```
INTERVALSTARTTIME_GMT,INTERVALENDTIME_GMT,OPR_DT,OPR_HR,OPR_INTERVAL,NODE_ID_XML,NODE_ID,NODE,MARKET_RUN_ID,LMP_TYPE,XML_DATA_ITEM,PNODE_RESMRID,GRP_TYPE,POS,MW,GROUP
2026-07-14T07:00:00-00:00,2026-07-14T08:00:00-00:00,2026-07-14,1,0,TH_SP15_GEN-APND,TH_SP15_GEN-APND,TH_SP15_GEN-APND,DAM,LMP,LMP_PRC,TH_SP15_GEN-APND,ALL_APNODES,0,55.5152,1
2026-07-14T08:00:00-00:00,2026-07-14T09:00:00-00:00,2026-07-14,2,0,TH_SP15_GEN-APND,TH_SP15_GEN-APND,TH_SP15_GEN-APND,DAM,LMP,LMP_PRC,TH_SP15_GEN-APND,ALL_APNODES,0,48.61367,1
2026-07-14T09:00:00-00:00,2026-07-14T10:00:00-00:00,2026-07-14,3,0,TH_SP15_GEN-APND,TH_SP15_GEN-APND,TH_SP15_GEN-APND,DAM,LMP,LMP_PRC,TH_SP15_GEN-APND,ALL_APNODES,0,46.41399,1
2026-07-14T10:00:00-00:00,2026-07-14T11:00:00-00:00,2026-07-14,4,0,TH_SP15_GEN-APND,TH_SP15_GEN-APND,TH_SP15_GEN-APND,DAM,LMP,LMP_PRC,TH_SP15_GEN-APND,ALL_APNODES,0,43.25317,1
2026-07-14T11:00:00-00:00,2026-07-14T12:00:00-00:00,2026-07-14,5,0,TH_SP15_GEN-APND,TH_SP15_GEN-APND,TH_SP15_GEN-APND,DAM,LMP,LMP_PRC,TH_SP15_GEN-APND,ALL_APNODES,0,43.97726,1
```
(Rows arrive unsorted in the raw CSV; sorted here by `INTERVALSTARTTIME_GMT` for readability.)

## 2. MISO — Indiana Hub day-ahead ex-post LMP

**URL (verified working):** `https://docs.misoenergy.org/marketreports/YYYYMMDD_da_expost_lmp.csv`
— HTTP 200, `Content-Type: application/octet-stream`, plain CSV (Azure blob storage backend).
Required a browser User-Agent for reliability (`Mozilla/5.0 ... Chrome/124.0 Safari/537.36`);
not re-tested with a bare UA, so treat a browser UA as a requirement for this host.

**Preamble structure (correction: not "2 header lines" — 4 preamble lines + 1 column-header
line = 5 lines before the first data row):**
```
1: Day Ahead Market ExPost LMPs
2: 07/14/2026
3: (blank)
4: ,,,All Hours-Ending are Eastern Standard Time (EST)
5: Node,Type,Value,HE 1,HE 2,...,HE 24
6: <first data row>
```
The fixture preserves this exact structure (see §2 fixture below). If a future task needs a
literal "2 header lines" constant, use **5** (or: 1 title, 1 date, 1 blank, 1 note, 1
column-header — whichever the parser counts as "skip before column header row").

**Exact Indiana Hub label:** `INDIANA.HUB` (column 1, "Node") — confirmed exact string, `Hub`
in column 2 ("Type" — node category, unrelated to the LMP/MCC/MLC distinction).

**Row-type column distinguishing LMP from MCC/MLC:** column 3, **header name `Value`** (not a
"Type" column despite the name collision with column 2). Confirmed values for `INDIANA.HUB`:
exactly 3 rows, `Value` ∈ {`LMP`, `MCC`, `MLC`} — connector must filter `Value == "LMP"` and
average `HE 1`..`HE 24` on that row only.

**HE column count:** **24** (`HE 1` through `HE 24`), confirmed on both a normal day
(2026-07-14) and the 2026 US spring-forward DST date (**2026-03-08**, verified a Sunday). On the
DST date the file still carries all 24 HE columns fully populated for `INDIANA.HUB` (LMP/MCC/MLC
rows each have 24 comma-separated values) — MISO's CSV schema is a fixed 24-column shape
regardless of the real-world 23-hour wall-clock day; no special-casing needed by the connector
for DST day structure (a genuine finding, differs from the design doc's implication that DST
needed shape verification — it did, and the shape is stable).

**404 example (correction: not weekend/holiday-related):** fetched **Sunday 2026-07-12** — file
exists, HTTP 200, normal data (**MISO's day-ahead market runs every day, weekends included; no
weekend/holiday gap**). The genuine 404 boundary is the *publish horizon*: MISO publishes a
trade date's ex-post file the **evening before** (file for 07/15 already had
`last-modified: Tue, 14 Jul 2026 18:04:40 GMT`, and 07/16's file was also already available by
the time of this spike, ~9:18pm ET 07/15). Fetching **2026-07-17** (2 days out) returned:
```
HTTP/2 404
content-type: application/xml
<?xml version="1.0" encoding="utf-8"?><Error><Code>BlobNotFound</Code><Message>The specified blob does not exist.…</Message></Error>
```
**Recommendation:** the connector's "404 = skip, don't error" carve-out should trigger on dates
beyond the ~1-day publish horizon, not on a weekend/holiday calendar (MISO has none for this
report) — simpler than the design doc implied.

**Trimmed fixture:** `tests/fixtures/miso_da_expost.csv` — real 2026-07-14 data, preamble (5
lines) + `INDIANA.HUB` (LMP/MCC/MLC, 3 rows) + 2 alphabetically-neighboring named hubs,
`ILLINOIS.HUB` and `MICHIGAN.HUB` (LMP/MCC/MLC each, 3 rows apiece) = 14 lines total, 9 data
rows. **Expected daily mean for `INDIANA.HUB` (`Value=="LMP"`, mean of HE1-HE24):
140.89 $/MWh** (a genuine heat-driven price-spike day — well inside the (−100, 3000) plausible
range).

## 3. ICE — EIA's `ice_electric-2026.xlsx` workbook

**URL:** `https://www.eia.gov/electricity/wholesale/xls/ice_electric-2026.xlsx` — HTTP 200,
`.xlsx`, no browser UA required (curl default UA worked). Single sheet named `2026`, dims
`A1:L647` (646 data rows, column L unused/blank).

**Exact header row (row 1, `data_only=True` via openpyxl), 11 populated columns:**
```
Price hub | Trade date | Delivery start date | Delivery \nend date | High price $/MWh |
Low price $/MWh | Wtd avg price $/MWh | Change | Daily volume MWh | Number of trades |
Number of counterparties
```
Note: **"Delivery end date" header contains a literal embedded newline** (`'Delivery \nend
date'`) — an exact-string match must include it.

**Date-cell type:** Python `datetime.datetime` objects (openpyxl `data_only=True`), not strings
— confirmed for `Trade date`, `Delivery start date`, `Delivery end date`.

**All 7 hub labels present in the file (exact strings), and their most recent values (all as of
trade date 2026-07-07 — an 8-day lag from today, matching the design doc's "≤8 days" estimate):**

| exact hub label | latest trade date | wtd avg $/MWh |
|---|---|---|
| `Indiana Hub RT Peak` | 2026-07-07 | 85.00 |
| `Mid C Peak` | 2026-07-07 | 31.55 |
| `NP15 EZ Gen DA LMP Peak` | 2026-07-07 | 28.50 |
| `Nepool MH DA LMP Peak` | 2026-07-07 | 52.00 |
| `PJM WH Real Time Peak` | 2026-07-07 | 72.38 |
| `Palo Verde Peak` | 2026-07-07 | 36.68 |
| `SP15 EZ Gen DA LMP Peak` | 2026-07-07 | 23.79 |

**PJM Western Hub label — confirmed exact match to the design doc's candidate:**
`PJM WH Real Time Peak`.

**ERCOT North — UNFETCHABLE, house honesty rule invoked.** Exhaustively searched every cell in
the workbook (all 647 rows × 12 columns) for the substrings `ercot`, `texas`, `north`, `houston`
(case-insensitive): **zero matches anywhere in the file.** The 7 hubs above are the complete set
— none represent ERCOT or any Texas region. The design doc's `ice_ercot_north` candidate
(§3.3: "ERCOT North hub — spike pins exact label") **does not exist in this source and cannot be
pinned.** No substitute Texas-region hub exists in this file either.

**Recommendation:** drop `ice_ercot_north` from Wave 4 scope entirely — do not invent a
replacement label or substitute a different hub under that name. The registry arithmetic in the
design doc (§3, "series 265 → 270, 5 new") should become **265 → 269 (4 new)**:
`caiso_sp15_da`, `miso_indiana_da`, `ice_pjm_west`, `eia_henry_hub`. The "power bill" panel's ICE
breadth is PJM-only (East) unless the controller chooses a different available hub (e.g.
`Nepool MH DA LMP Peak` for New England, or `Palo Verde Peak` for the desert Southwest) as a
second panel-only card — that is a scope decision for the controller, not something this spike
should decide unilaterally.

## 4. Henry Hub — EIA v2 `seriesid` alias

**Critical correction: the bare seriesid `RNGWHHD` 404s.** Ran exactly as specified —
`pipeline.connectors.eia.fetch(["RNGWHHD"], key)` — result:
```
requests.exceptions.HTTPError: 404 Client Error: Not Found for url: https://api.eia.gov/v2/seriesid/RNGWHHD?api_key=...
```
Raw API confirms: `{"error":"Series ID 'RNGWHHD' is not valid.","code":404}`.

**Working identifier: the full v1-style compound id `NG.RNGWHHD.D`.** Tested
`https://api.eia.gov/v2/seriesid/NG.RNGWHHD.D` directly — HTTP 200, `response.total: 7416`,
matching the design doc's "7 416 obs" claim exactly (the design doc had the right total but the
wrong seriesid string — likely conflated the v1 route id with the v2 alias's expected format).

Ran `pipeline.connectors.eia.fetch(["NG.RNGWHHD.D"], key)` (read-only; confirmed no writes to
`store/`):
- Returned 4999 observations (EIA's v2 API default page size caps a single unpaginated call
  well short of the full 7416-row history — `eia.fetch` does not paginate; a future connector
  wanting deep history would need an explicit `length`/`offset` param, not needed for the daily
  tail use case).
- **Latest observation: `obs_date='2026-07-13', value=2.83`** — exact match to the design doc's
  `henry_hub: {"latest": 2.83, "asof": "2026-07-13"}` worked example, despite the wrong seriesid
  string in the doc.
- `obs_date` renders as a plain `'YYYY-MM-DD'` string (len 10) — the existing `eia.py` connector
  logic (`period if len(period) == 10 else month_first(period)`) already handles this correctly
  with no changes needed.
- `series_code` on returned `Observation` objects is the full string `NG.RNGWHHD.D` (whatever is
  passed in, echoed back) — the registry's `source_id` for `eia_henry_hub` must be
  `NG.RNGWHHD.D`, not `RNGWHHD`.

**Recommendation:** correct the design doc's §3.4 registry mapping — `eia_henry_hub` ←
`source_id` **`NG.RNGWHHD.D`** (not `RNGWHHD`). Everything else about the isolation-key plan
(`EIA_SPOT` mapping to `_eia`, staleness 7) is unaffected; only the literal string changes.

## Substitutions / dropped series — summary

- **`ice_ercot_north` — DROPPED.** No ERCOT/Texas hub exists anywhere in the ICE workbook.
  Registry arithmetic revised: series 265 → **269** (4 new, not 5): `caiso_sp15_da`,
  `miso_indiana_da`, `ice_pjm_west`, `eia_henry_hub`.
- **`eia_henry_hub` source_id corrected:** `RNGWHHD` → **`NG.RNGWHHD.D`** (the bare id 404s on
  the v2 `seriesid` alias; the compound id works and returns the exact value the design doc
  expected).
- **CAISO datetime offset:** design doc's `T07:00-0000` works today (PDT); connector should
  filter by `OPR_DT` post-unzip rather than assume the window equals exactly one trade date
  (fails silently in PST months otherwise — see §1).
- **MISO preamble line count:** design doc/brief said "2 header lines"; actual structure is 4
  preamble lines + 1 column-header line = 5 lines before data (see §2). Fixture built to the
  real 5-line structure.
- All other candidates (CAISO columns/filter/node, MISO Indiana Hub label/row-type column/HE
  count, ICE PJM hub label/header names/date-cell type) verified exactly as proposed — no
  substitution needed.

## Access notes

- **CAISO** (`oasis.caiso.com`): no browser UA needed; plain `curl` default UA returned 200.
  Throttles at <5s between requests (exact server message quoted in §1) — the daily connector's
  one-request-per-day cadence is nowhere near this limit; only the backfill script's windowed
  loop needs the ≥5s sleep, confirmed necessary and sufficient.
- **MISO** (`docs.misoenergy.org`, Azure blob storage): fetched with a browser UA
  (`Mozilla/5.0 ... Chrome/124.0 Safari/537.36`); not re-tested bare, so treat a browser UA as a
  requirement pending a counter-test in the connector task.
- **ICE** (`www.eia.gov`): no browser UA needed; plain `curl` default UA returned 200.
- **EIA v2 API** (`api.eia.gov`): existing project key (`EIA_API_KEY` in `.env`) used read-only;
  confirmed zero writes to `store/` during this spike (`eia.fetch` is a pure HTTP+parse
  function, no store I/O in its signature).

## Report path

Full report: `/Users/ericwyluda/Development/macrogauge/.superpowers/sdd/task-1-report.md`.
Fixture: `tests/fixtures/miso_da_expost.csv`. CAISO and ICE fixtures are built in-test from the
shapes recorded in §1 and §3 of this file (per the design doc's testing plan §7) — no fixture
files for those two sources.
