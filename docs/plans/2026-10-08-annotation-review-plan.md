# Annotation review plan — 2026-10-08

Eric's page-by-page review of the AI Infra pages (7 annotated screenshots) plus the a16z
*State of Markets* (Sept 2026) deck. This plan scopes every change before any code moves.
Baseline: `main` at `f58df0d` · pytest 1265 · `npm test` 388 · e2e 230.

## Decisions already made (Eric, 2026-10-08)

| # | Decision |
|---|---|
| D1 | Pumps leave the long-lead board; the DC Build weight stays (5%), relabelled as what it is. |
| D2 | Gas turbines fold into the existing **Generator sets & turbines** row (no new package). |
| D3 | Issuer bond yields on /rates start from **new-issue pricing** (SEC filings); daily secondary yields later. |
| D4 | Roster = **the most-used models by OpenRouter paid spend** (confirmed 2026-10-08): Opus 5.5, GPT-6.1 Sol, Kimi K3, DeepSeek V4.1 Flash, GLM-5.3, Gemini 3.8 Flash, GPT-6 Luna — see "Roster by usage". |
| D5 | Shorten H1s on /power, /states, /rates and /capacity (one claim, ~12 words). |
| D6 | /power map uses a real geographic US outline (pre-projected SVG). |
| D7 | These six PRs run before scorecard handoff Session 1 (Claude's advice: slot S1 after PR 4; Eric to confirm). |
| D8 | /compute gets a tier tag per model. |
| D9 | /commodities power-hub rows switch from the single-day print YoY to the **30-day-average YoY** /power uses (PJM read +82.7% one-day vs +61.9% 30-day on 2026-10-08). Ships in PR 4 (`pipeline/publish/commodities.py` rows `ice_pjm_west`, `caiso_sp15_da`; row label names the window). |

### Roster by usage (OpenRouter rankings, week to 2026-10-07)

Source: the `["rankings","models",{"view":"week"}]` payload embedded in openrouter.ai/rankings
(top 20 models, ~130T tokens, consistent with a16z p.78's ~126T/week). Ranked by **paid spend**
(`total_usage`, $) because the index prices what people buy; free, stealth and preview models are
excluded (zero or temporary prices).

| Spend rank | Model (dated permaslug) | Week spend | Week tokens | Proposed tier |
|---|---|---|---|---|
| 1 | anthropic/claude-opus-5.5-20260921 | $3.09M | 3.4T | frontier |
| 2 | openai/gpt-5.6-sol-20260709 → successor **gpt-6.1-sol-20260929** (#8, $0.60M) | $1.31M | 1.8T | frontier |
| 3 | moonshotai/kimi-k3-20260715 | $1.18M | 1.7T | standard |
| 4 | deepseek/deepseek-v4.1-flash-20260910 | $1.17M | 33.6T | light |
| 5 | z-ai/glm-5.3-20260816 | $0.87M | 3.2T | standard |
| 6 | google/gemini-3.8-flash-20260902 | $0.76M | 2.1T | light (Flash models sit with the cheap tier) |
| 11 | openai/gpt-6-luna-20260922 | $0.29M | 6.5T | light |

Not in the week's top 20: Grok 4.7, Qwen 3.8 Max, GPT-6 Astra, Claude Sonnet 5.5, Mistral Large 4.
Tier names follow Ramp's frontier / standard / light taxonomy (a16z deck p.37). One snapshot
week is noisy, so the roster is reviewed monthly against the same payload; a change is a
`compute.py` roster edit plus a changelog entry, never automatic.

## Facts established while scoping (confirmed unless marked)

- **Pumps provenance.** `pumps` is a hand-set 5% line in `config/dc_basket.json:24`, added in
  `4a4eeb8` (2026-07-12) with no cited weight source. The board takes its packages from the basket
  (`pipeline/publish/longlead.py:110-125`). Its series is `ppi_pumps` = FRED **WPU1141, PPI pumps &
  compressors** (`config/series.json:427`), so the "Industrial pumps" label is also inaccurate.
- **BNP/a16z cross-check** (deck p.44, facility share = Power $20 + Cooling $7.5 + Facilities $7.5
  of $100, rescaled to 100%): power 57% vs our ~53%, cooling 21% vs our 21%, shell/facilities 21%
  vs our ~26.5% (we don't price land). Group-level only: BNP buckets are installed cost with labour
  inside; we split labour from materials.
- **Turbines are already in the price leg**: `ppi_genset` = PCU333611333611, PPI *turbine* &
  generator sets; the M3 backlog group for generators is already `turbines` (`longlead.py:66`).
- **A vendor carries one `dc_segment`** (`pipeline/dc_longlead.py:74`). GE Vernova's entry is its
  Electrification segment, so adding `gev` to the generators row would show the wrong segment's
  book-to-bill. Turbines need a separate vendor key for GE Vernova's Power segment.
- **The /power headline is built client-side** in `site/src/lib/dcHub.ts:73-93`, not by the pipeline.
- **Production H1 lengths** (2026-10-08): /states 34 words, /power 26, /rates 18, /capacity 18;
  everything else is 11 or fewer. Builders: `siteCosts.ts`, `dcHub.ts`, `ratesHeadline.ts`,
  `capacityCohort.ts`.
- **Headline inconsistency:** /commodities says "PJM power +83%" while /power says +61.9%. These are
  probably different windows or products; not yet investigated.
- **/compute 30d/90d all "—"** is expected: the roster changed on 2026-10-07 (`ROSTER_SINCE`,
  `pipeline/publish/compute.py:53`) and `chg_30d_pct` needs 30 days of history.
- **DeepSeek V4.1 Flash $0.30 → $0.036 input is a real price cut**, not a connector bug: same
  endpoint and field (`pipeline/connectors/openrouter.py:16,37`); the store holds 0.30 for 10-07.
- **All requested models exist on OpenRouter** (`/api/v1/models`, 2026-10-08): `anthropic/claude-opus-5.5`,
  `openai/gpt-6.1-sol`, `openai/gpt-6-astra`, `qwen/qwen3.8-max-0902` | `-prime`,
  `deepseek/deepseek-v4-pro-0813`, `x-ai/grok-4.7`. There is no GPT-6 Terra (6-series is Luna/Sol/Astra).
- **Nebius** publishes a static on-demand table at nebius.com/prices with two price columns:
  "On-demand, GPU-hour" and "GPU-hour (Effective October 1, 2026)". H100 $3.85→$4.50,
  H200 $4.50→$5.40, B200 $7.15→$8.50, B300 $7.85→$9.50; GB200/GB300 are "Contact us".
- **Bond data sources:** FMP's MCP tool surface has no corporate-bond endpoint (inferred: no such
  tool in the list). TradingView lists issuer bonds (e.g. `FINRA:ORCL6185589` Oracle 5.2% 2035;
  CoreWeave 9.0% 2031, 9.75% 2031, 9.625%/8.5% 2032 on FWB/GETTEX) and has `yield_to_maturity` /
  `yield_to_worst` bond columns, but every value fetch returned HTTP 429. It's an unofficial
  scanner endpoint (inferred: unusable from Actions without a scrape connector).
- **CRWV/NBIS debt is mostly 144A/Reg S** (the `U…` CUSIPs; NBIS mostly convertibles), so it
  doesn't file 424B2 pricing supplements. Inferred; the spike confirms.
- **The /states map is a tile grid** (`GeoStateMap.tsx` + `stateTiles.ts`), not geographic. There
  is no geographic basemap in the site today. /power has 9 hubs (`config/dc_power.json`).

---

## Work plan — six PRs, in recommended order

Every PR runs the full gate (`pytest -q`, `npm run lint && npm run build && npm test && npm run e2e`),
reports the delta against the baseline, and is verified on the right production screen after the
merge. Push, PR and merge each need Eric's go-ahead.

### PR 1 — Quick fixes: spacing + headlines (site only, no data change)

| Item | Change | Files |
|---|---|---|
| 1a | Move the peer notes out of the bordered `.table-card` so they align with the page, matching the /longlead footnote | `site/src/components/ContextPanel.tsx:103-114`; maybe `research.css:168` (32px margin) |
| 1b | /power headline: one claim, ~12 words; dates and windows move to the KPI cards. Draft: **"PJM power is up 62% in a year, and capacity costs 11× more"** | `site/src/lib/dcHub.ts:73-93`, `dcHub.test.ts` |
| 1c | *(needs Q2)* Same rule for /states, /rates, /capacity | `siteCosts.ts`, `ratesHeadline.ts`, `capacityCohort.ts` + tests |
| 1d | Explain PJM +83% (/commodities) vs +61.9% (/power): fix it if it's a bug; if it's a window difference, label the window | `pipeline/publish/commodities.py`, `dcHub.ts` |

Verify: screenshots of /datacenter (1440 + 375) and of each changed H1; e2e headline assertions
updated, not loosened. Contract: none (client-side strings).

### PR 2 — Compute roster refresh

- `pipeline/publish/compute.py`: new `MODELS`; `ROSTER_SINCE = <merge date>`; GPT-5.6 Terra and
  Llama 4 Maverick join `RETIRED_MODELS` (link-only, no rebase).
- `config/series.json`: add `or_*_in/_out` rows for new members with pinned dated IDs (never `~…-latest`);
  remove the two retired pairs.
- `config/methodology_changelog.json`: roster entry.
- Tests: `tests/test_compute.py`, the OpenRouter fixture in the `test_run_daily.py` fake, compute e2e.
- Contract: `compute.json` shape unchanged. If Q5 = yes, add a `tier` field: schema plus `gen-types`.
- Known UX: new rows show "—" for 30d/90d until ~30 days after the merge. Optionally render
  "new · since Oct N" instead of a bare dash.

### PR 3 — Nebius in the cloud GPU table

- `pipeline/connectors/cloudgpu.py`: `fetch_nebius`, a scrape with drift protection (regex pinned to a
  recorded fixture, plausible-range check, a "structure drift?" error). Column rule: pick a column by
  its header, using an "Effective <date>" column once that date is ≤ today, else the on-demand
  column. When Nebius drops the old column, the rule still holds.
- `config/series.json`: `NEBIUS` source (SCRAPE, daily) + `neb_h100/h200/b200/b300` rows.
- `pipeline/collect.py` wiring; `compute.py` `CLOUD_GPUS` += Nebius rows (prices are already per GPU-hour).
- Site: Nebius column on /compute; the "across 4 clouds" copy becomes count-driven.
- Tests: `tests/test_cloudgpu.py` + fixture `tests/fixtures/nebius_prices.html`, run_daily fake, e2e.
- Contract: `compute.json` rows gain a provider value (free string in the schema, `compute.schema.json:80`);
  `sources_status`/`qa` gain a source, and the expected-source counts derive from the registry.

### PR 4 — Long-lead board + DC Build labelling (D1, D2)

- **Research first (primary sources only):** GE Vernova Power segment Q2 2026 (8-K press release:
  orders, backlog, gas-turbine slot reservations in GW; the Q2 call quote behind "heavy-duty turbines
  ordered today deliver ~2031; 116 GW"). Optionally Siemens Energy Gas Services. Every figure quote is
  checked against its document, per the board's bar.
- `config/dc_longlead.json`:
  - Remove the `pumps` package.
  - `generators.vendors += ["gev_power"]`: a new vendor key, "GE Vernova — Power", `dc_segment: Power`.
  - `generators.lead_times +=` a gas-turbine vendor statement (the `through` year form, like Caterpillar).
- Board copy: `site/src/app/longlead/page.tsx:29` ("…HVAC, pumps…"). The coverage note is
  computed (becomes 4 packages, 45%).
- `config/dc_basket.json`: relabel `pumps` "Industrial pumps" → "Pumps & compressors (cooling-loop
  proxy)"; **weight unchanged, index history unchanged**.
- Methodology: DC Build section gains the BNP/a16z group-level cross-check and the pump-proxy
  rationale; `methodology_changelog.json` entry (label change + board change).
- Tests: `tests/test_dc_longlead.py:88-97` (asserts on the real config's package list), longlead e2e,
  any e2e or vitest text matching "Industrial pumps".
- Contract: the `datacenter.json` component label changes (CSV exports, /datacenter drivers, ledger
  untouched since it stores readings). `longlead.json` loses one package; a schema `minItems`, if
  any, is checked.

### PR 5 — Issuer bond pricing on /rates (D3) — spike, then build

**Spike (no code, ~1 session).** For MSFT, META, AMZN, GOOGL, ORCL, CRWV, NBIS, find the latest USD
deal:
- IG shelf issuers: EDGAR FWP pricing term sheet / 424B2. These usually state coupon, maturity, yield
  to maturity, spread to benchmark Treasury and pricing date (inferred: verify).
- 144A issuers (CRWV, NBIS): the 8-K announcing pricing (coupon, issue price). NBIS convertibles are
  flagged as not comparable or excluded.
- Retry TradingView's YTM fields; record whether the data looks usable as a phase-2 daily source.
- Output: `docs/research/2026-10-issuer-bond-pricing.md` with one row per issuer, quote and URL.

**Build.**
- `config/issuer_bonds.json`: hand-curated, with each quote checked against its figure at load
  (the `dc_market_pipeline` pattern).
- Loader in `pipeline/issuer_bonds.py`; `pipeline/publish/rates.py` gains an `issuers` block: stated
  spread, or yield minus the matched-maturity DGS on the pricing date, computed from the store.
- Schema + `gen-types`; /rates table: "What each builder paid to borrow", a dated new-issue row per
  issuer, with CRWV vs IG as the neocloud premium.
- A bad config nulls the block, never the panel.
- Refresh cadence: when an issuer prices a new deal (they're frequent); add a `stale` rule.

### PR 6 — /power hub map

- **Basemap (Q3).** Recommended: a committed, pre-projected US outline SVG (Albers USA, generated
  once from Census-derived `us-atlas` and checked in), so there's no runtime dependency.
  Alternative: pin hubs onto the existing state tile grid (no new asset, but geographically crude).
- `config/dc_power.json`: per-hub `lat`/`lon` (the hub's representative location; the caption says a
  hub is a price basket, not a point).
- New `HubMap.tsx`: 9 dots, colour = YoY, label = 30-day $/MWh. The table stays the accessible
  source; the map is `role="img"` with a text summary.
- Tests: vitest for the projection/placement helper, e2e that it renders with zero console errors, a
  375px overflow check.

---

## Open questions for Eric

1. **Q1 — Final roster.** Proposed tiers:
   - Frontier: Opus 5.5, GPT-6 Astra
   - Workhorse: GPT-6.1 Sol, Sonnet 5.5, Gemini 3.8 Flash, Grok 4.7
   - Open-weight: DeepSeek (V4.1 Flash or V4 Pro?), Qwen 3.8 (Max-0902 or Max-Prime?), Mistral Large 4

   Keep Gemini Flash and Mistral?
2. **Q2 — Headlines.** /power only, or apply the ~12-word rule to /states, /rates and /capacity too?
3. **Q3 — Map basemap.** Geographic SVG (recommended) or the state tile grid?
4. **Q4 — Sequencing.** Run these six PRs before scorecard handoff Session 1 (trust layer), or interleave?
5. **Q5 — Tier column.** Show a frontier/workhorse/open-weight tag on /compute (small schema add)?

## Watch-outs carried forward

- Rebase over the daily `data: daily publish` commits before every push; store JSONL conflicts
  resolve by union.
- New scrape connectors (Nebius) must fail loudly, never ingest garbage; they're isolated, so a
  break lowers freshness and never blocks the run.
- The long-lead board's primary-source bar: no a16z or TrendForce figures cited directly; only the
  vendor's own filing or call.
- `/markets` table width is tight at 1440 (1198px); not touched here, but don't add columns there.
