# Collectors-First Design — DRAM spot, GPU compute, inference prices, STEO vintages (Wave 3a)

**Status:** Approved 2026-07-15 (brainstorming session; breadth decision: broad-but-bounded,
~25 series / 5 source keys). Follows waves 1–2 (DC Hardware index 9d68daf, construction boom
53fe47b, both deployed).
**Inputs:** 2026-07-15 enhancement research (endpoints verified live that day);
`pipeline/connectors/aaa.py` (drift-protection convention), `pipeline/collect.py` (source-key
isolation, `EIA_STATE` key-reuse precedent), `pipeline/engine/blend.py::splice_anchored`
(no-overlap → official-only, verified), `pipeline/store/vintage.py` (value-dedupe append). STEO
`/v2/seriesid/STEO.ESICU_US.M` verified live this session on the EXISTING EIA connector route
(456 rows incl. forecast curve through 2027-12).

**The wave's job is to start clocks, not ship features.** Three upcoming features are gated on
collection start, not UI: the DRAM nowcast tail (no backfill exists; the anchored splice can't
activate until spot history reaches back past a PPI print — earliest ~mid-September), the
cost-of-compute index family (forward-only; every uncollected day is history lost), and
accountability_power (the STEO API serves only the current vintage; grading needs 2–3 archived
releases). Wave 3a wires all of them into the store now. **No published artifact changes, no site
changes** — `sources_status.json` gains 5 rows automatically and `/status` renders them
generically.

## 1. Scope

**In scope:** 4 new connector modules (`dramex`, `vastai`, `sfcompute`, `openrouter`) + 1
connector-free source key (`STEO` reusing `_eia`); ~23 registry series; the dormant DRAM
`live_proxy` config + a 3-line engine label fix; tests and pins.

**Out of scope (later waves):** any index construction from the new series (3b), the inference
basket-versioning rule (3b — an index-construction rule, not a collection rule), publication of
any collected value (ToS postures below become binding only when values are published), wholesale
power connectors and backfills (wave 4), accountability_power artifact/page (wave 4).

## 2. Decisions locked in brainstorming

1. **Broad-but-bounded universe** (~25 series): skipped series have no backfill, so breadth wins
   where the marginal cost is a registry row on an already-built connector; extra *scrape*
   surface (RunPod/Lambda posted prices, more DRAMeXchange rows) stays out — drift babysitting is
   the real cost, not storage.
2. **One isolated source key per provider** (5 new keys). Never grouped: a flaky scrape must not
   fail another provider's status row (hard house invariant).
3. **NAND spot is the future storage proxy**, not DDR5: NAICS 334112 (the basket's storage PPI)
   makes storage devices — SSDs and drives — and NAND is their input silicon. DDR4/DDR5 spot are
   collected for future memory work but proxy nothing yet.
4. **Dormant proxy ships now** with an honest label: `splice_anchored` returns official-only when
   the proxy has no observation at/before the last official print (verified), so the config is
   safe today and self-activates when overlap exists. The engine's `mode` must reflect *actual*
   tail contribution, not proxy presence (§4).
5. **Raw over blended for inference prices:** per-model prompt and completion $/Mtok stored as
   separate series; blending is index-time policy (3b), and raw rows keep every future blend
   possible.
6. **Thin-market honesty for vast.ai:** an observation is stored only when the median rests on
   ≥3 offers; thinner days are skipped and carry-forward absorbs them.

## 3. Sources & series

**No invented identifiers:** every row label, `gpu_name` value, and OpenRouter model id below is
a *candidate* pinned by the research; **implementation task #1 is a verification spike** that
fetches each source live, records trimmed fixtures into `tests/fixtures/`, confirms the exact
strings, and substitutes current equivalents where drift has already happened (recorded in
`docs/superpowers/specs/2026-07-15-collectors-spike-notes.md`).

### 3.1 `DRAMEX` — DRAM/NAND spot (scrape, keyless)

`https://www.dramexchange.com/` server-renders spot tables (191 KB plain HTML, no robots.txt;
verified twice 2026-07-15). Three sessions/day; the closing session (~18:10 GMT+8 ≈ 6:10 AM ET)
precedes the 8:40 ET run, so one daily fetch captures the close. Session-average column.

| code | candidate row label | staleness |
|---|---|---|
| `dramex_nand_mlc64` | `MLC 64Gb 8GBx8` (NAND flash) | 7 |
| `dramex_ddr5_16g` | `DDR5 16Gb (2Gx8) 4800/5600` | 7 |
| `dramex_ddr4_16g` | `DDR4 16Gb (2Gx8) 3200` | 7 |

`source_id` = the pinned row label. Drift protection (house pattern): regex anchored on the row
label capturing the session-average cell, pinned to a recorded fixture; plausible range
(0.5, 1000) $ per unit; any miss → `"structure drift?"` ValueError. Weekend/holiday gaps are
carry-forward, not errors. ToS posture (corrected by the 2026-07-15 spike): **§6.2 requires
written consent for publication/redistribution; §6.3 alone is not a standalone attribution
license.** Collection for internal analysis proceeds in this wave; publication of any
DRAM-derived value is GATED on a wave-3b ToS resolution (written consent, or an alternative
source, or publishing only sufficiently-derived aggregates after review). The NAND row also
updates slower than daily (observed 9 days stale) — its staleness limit is 21, not 7.

### 3.2 `VASTAI` — GPU rental medians (keyless API)

`GET https://console.vast.ai/api/v0/bundles/?q=<urlencoded JSON>` per GPU type (research-verified
live; the GET-with-?q form works, the POST form does not). Query per GPU:
`{"gpu_name":{"eq":"<name>"},"rentable":{"eq":true},"gpu_frac":{"eq":1},"type":"on-demand","limit":1000}`.
The connector computes **median of `dph_total`/`num_gpus`** over returned offers — a documented
measurement, the connector's one computation. **Store only when n ≥ 3 offers** (§2.6).

| code | candidate `gpu_name` | staleness |
|---|---|---|
| `vast_h100_sxm` | `H100 SXM` | 7 |
| `vast_h200` | `H200` | 7 |
| `vast_b200` | `B200` | 7 |
| `vast_a100_sxm` | `A100 SXM4` | 7 |
| `vast_rtx4090` | `RTX 4090` | 7 |

`source_id` = the `gpu_name` string. Unofficial/undocumented endpoint → treated like a scrape:
required-field check on the response (`offers[].dph_total`, `.num_gpus`, `.gpu_name`) raises
`"structure drift?"`; plausible range (0.05, 50) $/GPU-hr on the median. Five GETs per run.

### 3.3 `SFCOMPUTE` — H100/H200/B200 spot averages (scrape)

`https://sfcompute.com` homepage embeds `pricesByHardwareType` in its Next.js flight payload
(research-verified: `{H100:[{date,avg,top,bottom},…], H200:[…], B200:[…]}`, trailing ~31 daily
rows). Each fetch emits ~31 observations per type (obs_date from the payload); the store's
value-dedupe keeps re-fetched days free, and a missed run self-heals from the next day's overlap
— unique among our scrapes.

| code | payload key | field | staleness |
|---|---|---|---|
| `sfc_h100` | `H100` | `avg` | 7 |

(`sfc_h200`/`sfc_b200` were cut post-spike: those markets showed zero trades — the connector
supports their keys; register the series when they trade.)

Drift protection: regex pinned to the fixture's payload shape (the `$D`-prefixed escaped-JSON
Next.js format); plausible range (0.2, 50) $/GPU-hr; zero parsed rows → drift error.

### 3.4 `OPENROUTER` — AI inference prices (keyless API)

`GET https://openrouter.ai/api/v1/models` (keyless, verified twice 2026-07-15: 342 models,
`pricing.prompt`/`pricing.completion` as USD-per-token strings). Connector converts to **$/Mtok**
(×1e6). Fixed 6-model basket → 12 series; `source_id` = `<model_id>:prompt` /
`<model_id>:completion`.

Candidate models (spike verifies current ids; substitute the provider's current equivalent tier
where an id is gone, recorded in spike notes): `openai/gpt-4o`,
`anthropic/claude-3.5-sonnet`, `meta-llama/llama-3.1-70b-instruct`, `deepseek/deepseek-chat`,
`google/gemini-2.0-flash-001`, `mistralai/mistral-large`. Codes `or_gpt4o_{in,out}`,
`or_claude_sonnet_{in,out}`, `or_llama70b_{in,out}`, `or_deepseek_{in,out}`,
`or_gemini_flash_{in,out}`, `or_mistral_large_{in,out}`; staleness 7.

Failure semantics: a basket model missing from the response **skips its two series** (no error —
deprecation shows up as per-series staleness within 7 days, the designed early-warning);
unparsable response or **zero** basket models found → `"structure drift?"` error. Plausible range
(0.01, 500) $/Mtok. Basket *versioning* (chain-linking substitutions into an index) is explicitly
3b's problem; collection just follows these fixed ids.

### 3.5 `STEO` — EIA forecast vintages (existing key, zero connector code)

New source key reusing `_eia` exactly as `EIA_STATE` does (own status row + failure domain, same
fetch mechanics — `https://api.eia.gov/v2/seriesid/{sid}`, verified live this session).

| code | source_id | staleness |
|---|---|---|
| `steo_elec_ind_us` | `STEO.ESICU_US.M` | 45 |
| `steo_power_pj` | `STEO.ELWHU_PJ.M` | 45 |

**Forecast-curve semantics (the point of collecting these):** each monthly STEO release serves
actuals *plus* forecast months (through 2027-12 today). All rows land with `vintage_date` =
collection day; the value-dedupe append writes only changed values, so each release's revisions
to the forward curve append naturally — the store accumulates exactly the per-vintage forecast
history that grading needs. Consequences, stated honestly: these series carry **future-dated
observations by design**; they must never join a basket, panel, or naïve `max(series)` consumer
(wave 4's grading logic vintage-slices); and the staleness check is vacuous for them
(latest_obs is ~18 months in the future) — the meaningful failure signal is the STEO status
row's `ok`/`error`, which the isolation machinery already provides. `ESICU_US` is the exact
series DC Ops' power component uses (grading target); `ELWHU_PJ` doubles as wave 4's monthly
wholesale spine.

## 4. Dormant DRAM proxy + honest mode label

- `config/dc_basket.json`: the hardware `storage` component gains
  `"live_proxy": "dramex_nand_mlc64"`.
- Today there is no spot observation at/before the last storage-PPI print, so
  `splice_anchored` returns official-only and the index is byte-identical — the tail
  self-activates when July spot history sits behind the August print (~mid-September), and the
  existing tail-scoped gate then covers it automatically.
- **Engine label fix (the wave's only engine change, ~3 lines):** `dcindex.run` currently sets
  `mode = "official+proxy"` whenever the proxy series merely *exists* in the store. Change the
  assignment to `"official+proxy"` only when the spliced series actually extends past the last
  official print (`max(idx) > official_end` after the splice), else `"official"` — so the page's
  "Data" column never advertises a futures tail that contributes nothing. Pinned by a test
  (proxy rows present, all after the last print → mode `"official"`, no gate flags, index
  identical to official-only).

## 5. Pipeline wiring

- `pipeline/collect.py`: import the four new connector modules; wrappers
  `_dramex/_vastai/_sfcompute/_openrouter` passing `[s.source_id for s in subset]` +
  `http_get`; `FETCHERS` gains the five keys (`"STEO": _eia`). No `POST_SOURCES` changes.
- `config/series.json`: five new `sources` entries — scrapes/APIs keyless
  (`"route": "SCRAPE"` for DRAMEX/SFCOMPUTE, `"API"` for VASTAI/OPENROUTER;
  `"STEO": {"route": "API", "cadence": "monthly", "secret": "EIA_API_KEY"}`) — plus the 25
  series rows above.
- Pins: sources 17 → 22 (`test_run_daily.py` status-row count; `test_registry.py` sources set),
  series 242 → 267. FRED count untouched.
- Error strings from all new connectors flow through the existing `_sanitize` (EIA key is the
  only secret involved, on the STEO rows).

## 6. Testing

House conventions wholesale — no network, fixtures recorded by the spike and trimmed:

- **Per-connector unit tests** (`tests/test_{dramex,vastai,sfcompute,openrouter}.py`): happy
  path against the recorded fixture; every drift check raises with `"structure drift?"`; range
  violations raise; and per-connector specials — vast.ai `n<3` → observation skipped;
  sfcompute multi-day payload → ~31 obs per type with correct obs_dates; openrouter missing
  basket model → series skipped without error, zero models → error; dramex label-anchored regex
  ignores neighboring rows.
- **`tests/test_run_daily.py`**: four new `fake_get` branches (fixture HTML/JSON); STEO rides
  the existing `api.eia.gov` branch unchanged; source-count pin 22.
- **Engine:** the §4 label fix test in `tests/test_dcindex.py`; `tests/test_dc_basket.py`
  real-config assertion updated (hardware storage component now carries the proxy — the
  wave-1 test asserting `not any(c.live_proxy for c in baskets["hardware"])` flips to assert
  exactly `{"storage": "dramex_nand_mlc64"}`).
- **Registry pins** as §5.

## 7. Risks, ranked

1. **Two new scrape surfaces** (DRAMEX, SFCOMPUTE) — highest-churn class we own; mitigated by
   drift protection + per-source isolation; a drifted source is one red status row, zero page
   impact (nothing published from them yet).
2. **Unofficial APIs** (vast.ai, OpenRouter) — undocumented/unversioned; treated as scrapes
   (required-field drift checks). OpenRouter prices are "best available routed price," a caveat
   that belongs in 3b's methodology, not here.
3. **Model churn** (OpenRouter) — collection follows fixed ids; deprecation surfaces as
   staleness within 7 days; substitution policy is 3b's basket-versioning design.
4. **DRAMeXchange ToS** — collection + derived publication with attribution is the posture;
   revisit formally in 3b before any spot-derived value is published.
5. **STEO future-dated observations** — a foot-gun for any future consumer that naïvely takes
   `max(series)`; mitigated by documentation here, the never-in-a-basket rule, and wave 4's
   vintage-slicing accessor being the only sanctioned reader.
6. **Five sources debut on one unattended bot run** — accepted deliberately (they publish
   nothing; worst case is red status rows), and it's exactly why this wave ships them without
   any dependent features.
