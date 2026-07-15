# Wave 3a Task 1 — Collectors verification spike notes

**Date of all live fetches: 2026-07-15** (curl, timestamps as returned by each source). No value
below is invented — every number traces to a fetch captured during this session and archived (in
full, untrimmed form) before the fixtures were trimmed. Where a candidate string in
`docs/superpowers/specs/2026-07-15-collectors-first-design.md` §3 was not found live, the
substitution and its reasoning are recorded explicitly; nothing was silently kept.

Access notes up front: **none of the four sources required a browser User-Agent.** Plain `curl`
with its default UA (`curl/8.x`, no `-A` flag) returned HTTP 200 for all of
`www.dramexchange.com`, `sfcompute.com`, `console.vast.ai`, and `openrouter.ai` — sizes identical
to the browser-UA fetch. A browser UA was used for the primary fetches out of caution (per the
brief) but turned out unnecessary; this is a positive finding for the connectors (no UA header
needed in `pipeline/collect.py`'s `http_get` calls), recorded here rather than assumed.

---

## 1. DRAMeXchange (`DRAMEX`)

**Fetch:** `GET https://www.dramexchange.com/`, HTTP 200, 191549 bytes (≈191.5 KB decimal,
matches the design doc's "191 KB" claim). `robots.txt` returns HTTP 302 → `/Error/Error404` — no
active robots.txt, confirming the design doc's claim.

**All three candidate row labels found verbatim, unchanged — no substitution needed:**

| code | label (exact, as it appears in the HTML) | table | session average |
|---|---|---|---|
| `dramex_nand_mlc64` | `MLC 64Gb 8GBx8` | Flash Spot Price | `31.100` |
| `dramex_ddr5_16g` | `DDR5 16Gb (2Gx8) 4800/5600` | DRAM Spot Price | `48.900` |
| `dramex_ddr4_16g` | `DDR4 16Gb (2Gx8) 3200` | DRAM Spot Price | `79.375` |

Label text sits inside `<a original-title="..." href="...">` after an `<img>` tag, e.g.:
```html
<td class="tab_tr_gray2">
    <a original-title="Micron ,Kioxia" href="/Price/Flash_Spot">
        <img border="0" style="vertical-align: middle;" src="/Common/Images/mlc.gif"> MLC 64Gb 8GBx8
    </a>
</td>
```
Note the label cell's class is `tab_tr_gray2` — **not** `tab_tr_gray`. The six columns after the
label (Daily High, Daily Low, Session High, Session Low, Session Average, then a non-numeric
History icon cell) are:
```html
<td class="tab_tr_gray">45.00</td>   <!-- 1: Daily High -->
<td class="tab_tr_gray">27.00</td>   <!-- 2: Daily Low -->
<td class="tab_tr_gray">45.00</td>   <!-- 3: Session High -->
<td class="tab_tr_gray">27.00</td>   <!-- 4: Session Low -->
<td class="tab_tr_gray">31.100</td>  <!-- 5: Session Average -->
<td class="tab_tr_font9">...</td>    <!-- Session Change — different class, not tab_tr_gray -->
<td class="tab_tr_gray"><img .../></td>  <!-- History icon — also tab_tr_gray but non-numeric -->
```

**Candidate confirmed: the 5th numeric `tab_tr_gray` cell after the label is the Session
Average.** Verified with the regex actually run against the trimmed fixture:
```python
re.search(re.escape(label) + r'.*?</a>\s*</td>((?:\s*<td class="tab_tr_gray">[^<]*</td>){5})', html, re.S)
```
then take `re.findall(r'<td class="tab_tr_gray">([^<]*)</td>', group)[4]`. This produced
`31.100` / `48.900` / `79.375` exactly, and — tested — the label anchor does **not** false-match
neighboring rows (`DDR5 16Gb (2Gx8) eTT`, `DDR4 16Gb (2Gx8) eTT`, `SLC 2Gb 256MBx8`,
`SLC 1Gb 128MBx8` all present as negative controls in the fixture and correctly excluded because
the regex is anchored on the exact label text, not on cell position alone).

**Operational finding — worth flagging for Task 2:** the DRAM Spot Price table's own "Last
Update" banner read `Jul.15 2026 18:10 (GMT+8)` (today, fresh) but the Flash Spot Price table
(source of `dramex_nand_mlc64`, our NAND proxy target) read `Jul.6 2026 14:40 (GMT+8)` — **9 days
stale on the source's own site** at fetch time. This isn't a scrape failure; the site itself
hadn't refreshed Flash Spot prices in over a week. With `max_staleness_days: 7` on
`dramex_nand_mlc64` (per spec §3.1), the very first collection could already be inside or near the
staleness window depending on when the wave actually starts collecting. Recorded, not resolved —
Task 2/6 should decide whether 7 days is still the right threshold for this specific row or
whether NAND flash-spot on this source is inherently lower-cadence than DRAM spot.

**Full untrimmed source (191549 bytes) not committed** — only the trimmed fixture is. Trimmed
fixture: `tests/fixtures/dramex.html` (18262 bytes), containing the DRAM Spot Price table (header
+ `DDR5 16Gb (2Gx8) 4800/5600` target + `DDR5 16Gb (2Gx8) eTT` neighbor + `DDR4 16Gb (2Gx8) 3200`
target + `DDR4 16Gb (2Gx8) eTT` neighbor) and the Flash Spot Price table (header +
`SLC 2Gb 256MBx8` neighbor + `SLC 1Gb 128MBx8` neighbor + `MLC 64Gb 8GBx8` target) — all table
structure, cell classes, and cell ordering preserved byte-for-byte from the live fetch.

**Expected fixture-parse values (for test assertions):**
- `MLC 64Gb 8GBx8` → session average `31.100`
- `DDR5 16Gb (2Gx8) 4800/5600` → session average `48.900`
- `DDR4 16Gb (2Gx8) 3200` → session average `79.375`
- Negative controls present and must NOT satisfy any target regex: `DDR5 16Gb (2Gx8) eTT`
  (`23.620`), `DDR4 16Gb (2Gx8) eTT` (`11.525`), `SLC 2Gb 256MBx8` (`4.038`),
  `SLC 1Gb 128MBx8` (`3.563`).

### DRAMeXchange ToS §6.3 posture — correction to the design doc

Fetched `https://www.dramexchange.com/About/TermsOfUse` (HTTP 200, 29505 bytes). Site owned by
TrendForce Corp.; policy dated "JANUARY 01, 2020". Exact text of the relevant clauses:

> **6.2** YOU MAY NOT REPRODUCE, MODIFY, CREATE DERIVATIVE WORKS FROM, DISPLAY, PERFORM, PUBLISH,
> DISTRIBUTE, DISSEMINATE, BROADCAST OR CIRCULATE TO ANY THIRD PARTY, ANY MATERIALS CONTAINED ON
> THE SERVICES WITHOUT THE EXPRESS PRIOR WRITTEN CONSENT OF THE WEBSITE OR ITS LEGAL OWNER.
>
> **6.3** UNDER AUTHORIZED USE, MODIFICATION, REPRODUCTION, PUBLISHING, OR DISSEMINATION OF
> CONTENTS, USERS ARE REQUIRED TO INCLUDE A NOTICE INDICATING THAT THE WEBSITE IS THE SOURCE OF
> THE MATERIAL, INCLUDING THE NAME OF THE WEBSITE AND ITS URL ADDRESS.

**This is more restrictive than the design doc's paraphrase.** The design doc (§3.1) states
"§6.3 permits use with attribution — publish only derived/rebased values, never raw price
republication," reading §6.3 as a standalone grant. On the text actually fetched, §6.3's
attribution duty is conditioned on **"AUTHORIZED USE"** — and §6.2 makes reproduction/publication
of site materials conditional on **"THE EXPRESS PRIOR WRITTEN CONSENT OF THE WEBSITE."** §6.3 does
not itself confer that consent; it only specifies what attribution must accompany use that is
*otherwise* authorized. Neither clause restricts collection/storage for internal/research use
(they govern reproduction, publication, and third-party dissemination), so Wave 3a's
collect-only scope is unaffected. But **the "use with attribution" framing for eventual
publication should not be treated as settled** — §6.2's written-consent requirement is the
governing clause and belongs in 3b's pre-publication legal review, sharper than the current
"revisit formally in 3b" risk note.

---

## 2. vast.ai (`VASTAI`)

**Fetch:** `GET https://console.vast.ai/api/v0/bundles/?q=<urlencoded>` per GPU, query body
exactly `{"gpu_name":{"eq":"<name>"},"rentable":{"eq":true},"gpu_frac":{"eq":1},"type":"on-demand","limit":1000}`
— all 5 candidate `gpu_name` values returned HTTP 200 with a real `{"offers": [...]}` body. **No
substitution needed; all 5 candidates confirmed live.**

| code | `gpu_name` | offers (n) | median $/GPU-hr (`dph_total`/`num_gpus`) | response size |
|---|---|---|---|---|
| `vast_h100_sxm` | `H100 SXM` | 6 | 1.761388888888889 | 17694 B |
| `vast_h200` | `H200` | 4 | 3.6094480994152045 | 11963 B |
| `vast_b200` | `B200` | **2** | 9.416927083333333 | 5888 B |
| `vast_a100_sxm` | `A100 SXM4` | 19 | 0.8267037037037035 | 56242 B |
| `vast_rtx4090` | `RTX 4090` | 64 | 0.35712962962962963 | 188399 B |

All medians fall inside the spec's plausible range (0.05, 50) $/GPU-hr. Every offer object carries
`dph_total`, `num_gpus`, and `gpu_name` — required-field check passes for all 5 GPU types.

**Finding:** `B200` returned only **2** offers today — below the §2.6 thin-market floor
(store only when n ≥ 3). This is not a `gpu_name` problem (the string is correct and returns real,
well-formed offers); it's the *normal, designed* outcome of the honesty rule — no observation
would be written for `vast_b200` today, and carry-forward absorbs the gap. Recorded as expected
behavior, not a substitution.

**Fixture:** `tests/fixtures/vastai_bundles.json` — the full, unmodified live H100 SXM response
(6 offers, real field structure, 22258 bytes as saved/pretty-printed). Chosen because it already
returned exactly 6 offers, matching the brief's "~6 real offers" instruction without needing to
drop any fields or offers.

**Expected fixture-parse value:** n=6 offers, `gpu_name` = `"H100 SXM"` for all; median of
`dph_total/num_gpus` = `1.761388888888889`; n ≥ 3 so an observation would be stored.

---

## 3. sfcompute (`SFCOMPUTE`)

**Fetch:** `GET https://sfcompute.com`, HTTP 200, 119896 bytes. `pricesByHardwareType` found once
in a `<script>self.__next_f.push(...)</script>` Next.js flight payload. **Section keys confirmed:
`H100`, `H200`, `B200`** — no `B300` key despite `B300` text appearing elsewhere on the page
(marketing copy only, not a `pricesByHardwareType` section).

**Exact escaping (byte-verified, not just JSON-string-escaped-when-parsed):** the raw HTML bytes
on disk literally contain a backslash character (0x5C) followed by a double-quote, e.g.:
```
pricesByHardwareType\":{\"H100\":[{\"date\":\"$D2026-07-15T23:59:59.000Z\",\"avg\":2.12,\"top\":2.232327684928637,\"bottom\":1.9876723150713624},...
```
confirmed via `open(path, 'rb').read()` — this is literal text in the HTML (the RSC flight
payload embeds a JSON string as a JS string literal, so its internal quotes are backslash-escaped
as literal characters), not an artifact of how a JSON parser would render escapes. The `$D` prefix
on `date` values is also literal. Each row is `{"date":"$D<ISO8601>","avg":<num>,"top":<num>,"bottom":<num>}`
with the quotes/backslashes as shown. Row count: **31 rows per hardware type**, confirmed by
`\"date\"` occurrence count in each section — matches the design doc's "~31 daily rows" claim
exactly.

**Two regex approaches, both verified against the trimmed fixture:**
1. Bracket-counting extraction of the section body after `\"<KEY>\":[`, then
   `findall(r'\\"date\\":\\"\$D([0-9-]+)T[^\\]*\\",\\"avg\\":([0-9.]+)', section)` — robust to key
   order, recommended for the connector.
2. Simpler lookahead regex per section, e.g. `r'\\"H100\\":\[(.*?)\](?=,\\"H200\\":)'` — works but
   is order-dependent (relies on `H200` immediately following `H100`, `B200` immediately following
   `H200`) and has no clean terminator for the last key (`B200`) without a different lookahead.
   Verdict: **candidate regex/approach is workable, bracket-counting is the corrected/recommended
   form** — record both, prefer #1 for Task 4.

**Critical finding — H200 and B200 are all-zero today.** Every one of the 31 rows in both the
`H200` and `B200` sections has `"avg":0,"top":0,"bottom":0`. Only `H100` has real nonzero values
(range ~1.94–2.12 across the 31-day window; today's row: `avg:2.12`). This is real, fetched data —
not a parsing failure — but it means the spec's plausible-range check **(0.2, 50) $/GPU-hr would
reject every H200/B200 row today as `"structure drift?"`**, which is a false-positive drift signal
(the source and parse are both fine; there is simply no live H100/H200/B200... correction, no live
H200/B200 trading yet on sfcompute's spot board). **Flagging for Task 4:** recommend treating
`avg == 0` (or `avg <= 0`) as "no market today" and skipping the row (store nothing, let
carry-forward absorb it) — the same honesty pattern vast.ai already uses for `n < 3`, just not
called out in the design doc for sfcompute. This is a design decision for Task 4, not something
this spike resolves unilaterally.

**Fixture:** `tests/fixtures/sfcompute.html` (1949 bytes) — trimmed to the `pricesByHardwareType`
payload with the first 5 rows (2026-07-15 back to 2026-07-11) of each of `H100`, `H200`, `B200`,
escaping preserved verbatim, wrapped in a minimal `<script>self.__next_f.push([1,"2d:...` shell
matching the live structure.

**Expected fixture-parse values:**
- `H100`: 5 rows; first row `date=2026-07-15, avg=2.12`; all 5 `avg` values nonzero
  (`2.12, 2.11, 1.94, 2.01, 2.04`).
- `H200`: 5 rows; all `avg=0` (`0, 0, 0, 0, 0`).
- `B200`: 5 rows; all `avg=0` (`0, 0, 0, 0, 0`).

---

## 4. OpenRouter (`OPENROUTER`)

**Fetch:** `GET https://openrouter.ai/api/v1/models`, HTTP 200, 525696 bytes, **342 models**
(matches design doc's "342 models" exactly). `pricing.prompt`/`pricing.completion` present as
USD-per-token strings on every model checked.

**4 of 6 candidates found unchanged; 2 substituted (provider's current equivalent tier, per the
brief's instruction):**

| candidate id | status | final id | prompt $/Mtok | completion $/Mtok |
|---|---|---|---|---|
| `openai/gpt-4o` | found | `openai/gpt-4o` | 2.5 | 10.0 |
| `anthropic/claude-3.5-sonnet` | **gone** | `anthropic/claude-sonnet-5` | 2.0 | 10.0 |
| `meta-llama/llama-3.1-70b-instruct` | found | `meta-llama/llama-3.1-70b-instruct` | 0.4 | 0.4 |
| `deepseek/deepseek-chat` | found | `deepseek/deepseek-chat` | 0.2002 | 0.8001 |
| `google/gemini-2.0-flash-001` | **gone** | `google/gemini-3.5-flash` | 1.5 | 9.0 |
| `mistralai/mistral-large` | found | `mistralai/mistral-large` | 2.0 | 6.0 |

**Substitution reasoning:**
- `anthropic/claude-3.5-sonnet` is absent from the live `anthropic/*` id list (15 current
  Anthropic ids, spanning Haiku/Sonnet/Opus tiers up through `claude-opus-4.8`,
  `claude-sonnet-4.6`, `claude-fable-5`, `claude-sonnet-5`). `anthropic/claude-sonnet-5` is the
  current "Sonnet"-tier flagship (`name: "Anthropic: Claude Sonnet 5"`), the direct current-tier
  equivalent of the candidate's Sonnet naming — confirmed via full model entry (text+image+file→text
  modality, not an image/audio-specialized variant).
- `google/gemini-2.0-flash-001` is absent from the live `google/gemini*` id list. Excluded the
  image-specialized variants (`gemini-3.1-flash-image`, `gemini-3-pro-image`, etc.), preview
  builds (`gemini-3-flash-preview`), and the cheaper Lite tier (`gemini-3.1-flash-lite`).
  `google/gemini-3.5-flash` is the current mainline, non-preview "Flash" tier (`name: "Google:
  Gemini 3.5 Flash"`, `modality: text+image+file+audio+video->text`, general-purpose chat model) —
  the direct current-tier equivalent of the candidate.

Both substitutions confirmed by inspecting each model's full JSON entry (`architecture`,
`description`, `pricing`), not id-string pattern-matching alone.

**Fixture:** `tests/fixtures/openrouter_models.json` (19939 bytes) — the 6 final models' complete,
unmodified entries (full field structure: `id`, `canonical_slug`, `name`, `description`,
`context_length`, `architecture`, `pricing` with all sub-fields, `top_provider`,
`supported_parameters`, etc.), wrapped in `{"data": [...]}` matching the live envelope.

**Expected fixture-parse values ($/Mtok, ×1e6 from raw per-token pricing):**
`openai/gpt-4o` → 2.5 / 10.0; `anthropic/claude-sonnet-5` → 2.0 / 10.0;
`meta-llama/llama-3.1-70b-instruct` → 0.4 / 0.4; `deepseek/deepseek-chat` → 0.2002 / 0.8001;
`google/gemini-3.5-flash` → 1.5 / 9.0; `mistralai/mistral-large` → 2.0 / 6.0. All within the
spec's plausible range (0.01, 500) $/Mtok.

**No dropped series** — all 6 basket slots filled (4 unchanged + 2 substituted); zero-models-found
error path can't be exercised live today (would need a fixture with none of the 6 present, which
Task 5's unit tests should construct synthetically, not something this spike fabricates).

---

## 5. STEO (existing `_eia` connector, zero new connector code)

**Read-only check**, per the brief: `.venv/bin/python`, `.env` sourced for `EIA_API_KEY`, called
`pipeline.connectors.eia.fetch(["STEO.ESICU_US.M", "STEO.ELWHU_PJ.M"], key)` directly — **no
`run_daily`, no store writes.** Confirmed no files were written under `store/`.

**Result:** 672 total `Observation` rows returned across 2 HTTP GETs to
`https://api.eia.gov/v2/seriesid/{sid}`.

| series | n | obs_date range |
|---|---|---|
| `STEO.ESICU_US.M` | 456 | `1990-01-01` .. `2027-12-01` |
| `STEO.ELWHU_PJ.M` | 216 | `2010-01-01` .. `2027-12-01` |

`STEO.ESICU_US.M`'s 456-row count exactly matches the design doc's "456 rows incl. forecast curve
through 2027-12" claim. Both series carry observations dated **through 2027-12-01** — 17 months
past today (2026-07-15) — confirming the forecast-curve semantics described in design doc §3.5.

**Monthly-period → obs_date rendering confirmed:** the connector's `month_first(period)` turns an
EIA monthly `period` string like `"2027-12"` into `obs_date = "2027-12-01"` (first-of-month).
Sample rows returned directly from the call:
```
Observation(series_code='STEO.ESICU_US.M', obs_date='2027-12-01', value=8.6909, vintage_date='2026-07-15', source='EIA', route='API')
Observation(series_code='STEO.ELWHU_PJ.M', obs_date='2010-01-01', value=62.43215028, vintage_date='2026-07-15', source='EIA', route='API')
```
`vintage_date` = `today_et()` = `2026-07-15` on every row of this run, as expected for a fresh
collection with no `vintage_date` override.

No fixture file produced for STEO (per spec §3.5, "zero connector code" — it rides the existing
EIA connector/route, so Task 6's `test_run_daily.py` fake should extend the existing
`api.eia.gov` fake branch, not add a new fixture file).

---

## Summary — final strings for Tasks 2–6

- **DRAMeXchange labels (unchanged, no substitution):** `MLC 64Gb 8GBx8`,
  `DDR5 16Gb (2Gx8) 4800/5600`, `DDR4 16Gb (2Gx8) 3200`. Session-average cell = 5th numeric
  `tab_tr_gray` cell following the label's closing `</a></td>`.
- **vast.ai `gpu_name` (unchanged, no substitution):** `H100 SXM`, `H200`, `B200`, `A100 SXM4`,
  `RTX 4090`.
- **sfcompute row regex:** candidate structure OK (payload keys `H100`/`H200`/`B200`, `\"`-escaped
  JSON, `$D`-prefixed dates, confirmed by byte-level inspection); **recommend bracket-counting
  section extraction over the lookahead-regex alternative** for order-independence. Separately:
  **H200/B200 `avg` values are 0 today** — recommend a skip-on-zero rule for Task 4 (not yet in
  the design doc).
- **OpenRouter 6 final model ids:** `openai/gpt-4o`, `anthropic/claude-sonnet-5` (substituted for
  `anthropic/claude-3.5-sonnet`), `meta-llama/llama-3.1-70b-instruct`, `deepseek/deepseek-chat`,
  `google/gemini-3.5-flash` (substituted for `google/gemini-2.0-flash-001`),
  `mistralai/mistral-large`.
- **STEO:** confirmed live on the existing `_eia` route; no series dropped; future-dated
  observations and `month_first` obs_date rendering both confirmed.

## Fixtures produced

- `tests/fixtures/dramex.html` (18262 bytes)
- `tests/fixtures/sfcompute.html` (1949 bytes)
- `tests/fixtures/vastai_bundles.json` (22258 bytes)
- `tests/fixtures/openrouter_models.json` (19939 bytes)

No series were dropped from scope — all ~25 series in design doc §3 remain viable, subject to the
two open design questions flagged above (DRAM NAND staleness threshold; sfcompute zero-avg
handling), both left for Tasks 2/4/6 to resolve, not decided here.
