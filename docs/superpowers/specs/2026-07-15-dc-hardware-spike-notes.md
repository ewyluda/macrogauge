# DC Hardware Weight Citation Spike Notes (2026-07-15)

Verification run against public web sources (Dell'Oro Group press releases, Synergy Research
articles, IDC-sourced press coverage, SemiAnalysis/Epoch AI cost-anatomy research, and
industry/trade press) to check the DC Hardware basket's provisional group shares — compute
0.60 / storage & memory 0.25 / network 0.15 — against published data-center IT-capex
breakdowns, per `docs/superpowers/plans/2026-07-15-dc-hardware-index.md` Task 1 and
`docs/superpowers/specs/2026-07-15-dc-hardware-index-design.md` §3. Every figure below was
fetched live 2026-07-15; no citation is invented, and any figure that could not be
independently confirmed is flagged as such rather than stated as fact.

**Bottom line: storage moves from 0.25 → 0.15, compute moves from 0.60 → 0.65, network moves
from 0.15 → 0.20.** No citation found supports storage at a quarter of DC IT-hardware capex —
every source, including AI-era ones, puts freestanding storage/memory capex well below that
figure. Compute's dominance and network's AI-cycle buildout are both better supported than the
plan's provisional shares. These are the numbers Task 3 uses verbatim; group sums are what the
citations support, and the compute-group lens subdivision (§c below) is an explicit editorial
call, not a cited split.

## (a) Citations gathered

| Source | Date | URL | Finding |
|---|---|---|---|
| Dell'Oro Group, "Data Center Capex to Surpass $1 Trillion by 2029" (Baron Fung) | 2025-02-05 | https://www.delloro.com/news/data-center-capex-to-surpass-1-trillion-by-2029/ | "Accelerated servers for AI training and domain-specific workloads could represent nearly half of data center infrastructure spending by 2029." Compute's structural share is rising, not flat. |
| Dell'Oro Group, "Data Center Capex to Grow at 21 Percent CAGR Through 2029" (Baron Fung) | 2025-08-06 | https://www.delloro.com/news/data-center-capex-to-grow-at-21-percent-cagr-through-2029/ | "GPUs and custom AI accelerators now account for roughly one third of total data center capex." That's GPU/accelerator silicon *alone*, against a denominator that includes non-IT facility/power spend — corroborates compute as the single largest hardware category well before finished systems and semis/components are added in. |
| Dell'Oro Group, "Hyperscaler AI Deployments Lift Data Center Capex to Record Highs in 2Q 2025" | 2025-09-16 | https://www.delloro.com/news/hyperscaler-ai-deployments-lift-data-center-capex-to-record-highs-in-2q-2025/ | "Accelerated server spending rose 76 percent, driven by the ramp of NVIDIA Blackwell Ultra platforms..."; white-box vendors >60% of server market. Compute is both the largest and fastest-growing category. Directional, no exact split disclosed (full split is in Dell'Oro's paid quarterly report). |
| Epoch AI, "Total cost of ownership of a one-gigawatt AI data center" | 2026-05-14 | https://epoch.ai/data-insights/ai-datacenter-cost-breakdown | Direct three-way split for a GPU-cluster AI data center: **servers ≈ 60% of total annualized TCO** ($5B of $8.5B/yr), **networking ≈ 13%**, **storage ≈ 1–1.5%**. Strongest single citation for a compute/storage/network split; note the denominator is *total* annualized cost (incl. power/land/cooling), an even broader base than IT-hardware-only, and "storage ≈1-1.5%" reflects a pure GPU-training-cluster frame that structurally undercounts freestanding enterprise storage. |
| IoT Analytics, "Data Center Equipment & Infrastructure Market Report 2025–2030" | 2025-11 | https://iot-analytics.com/data-center-infrastructure-market/ | 2024 actuals, general/traditional (non-AI-cluster-specific) market: **servers 61%, networking 10%, storage 6.5%** of total DC spending. Renormalized to just these three categories (sum 77.5%): compute ≈79%, network ≈13%, storage ≈8%. This is the "pre-AI-cycle" baseline the plan's brief anticipated. |
| Synergy Research Group (aggregated press coverage, srgresearch.com) | 2025 (reporting CY2024 data) | https://www.srgresearch.com/research/data-center-infrastructure | "The main hardware-oriented segments of servers, storage and networking in aggregate accounted for 85% of the data center infrastructure market" in 2024 (up from 77% in 2021). Confirms these three are the dominant hardware categories; the specific server/storage/network sub-split sits behind Synergy's paywalled report and was **not** independently confirmed — used only as corroborating context, not as a split source. |
| InfotechLead / Digital Journal, reporting IDC Q1 2026 storage-market data | 2026-04 | https://infotechlead.com/networking/storage-market-jumps-22-7-to-9-2-bn-in-q1-2026-as-ai-demand-and-flash-storage-adoption-surge-96585 ; https://www.digitaljournal.com/article/ai-demand-pushes-enterprise-storage-market-into-faster-growth-phase/ | Worldwide external OEM enterprise storage systems revenue $9.2–9.9B in Q1 2026, +22.7–22.9% YoY, explicitly attributed to "AI demand" and All-Flash-Array adoption (>50% of storage revenue). Set against IDC's own reported Q1 2026 server-market run-rate (~$120B+/quarter per the same news cycle, e.g. theregister.com/2025/12/15/idc_server_storage_q3/), **storage is ≈8% of server-market spend even during this AI-elevated growth spurt** — the key citation capping how far storage can be justified above the traditional 6.5–8% baseline. |
| Tom's Hardware / Yahoo Finance, reporting a SemiAnalysis estimate | 2026-04-03 | https://www.tomshardware.com/tech-industry/memory-will-consume-30-percent-of-hyperscaler-spending-this-year ; https://finance.yahoo.com/sectors/technology/articles/memory-consume-30-hyperscaler-ai-135827019.html | "Memory will consume roughly 30% of total hyperscaler capex in calendar year 2026... up from approximately 8% in CY23 and CY24" (SemiAnalysis). A real, dated, named-analyst 4x swing — the strongest available citation for 2025–26 memory-price-cycle salience. **Caveat, load-bearing for the weight decision below:** this "memory" figure is dominated by HBM co-packaged directly onto GPU/accelerator silicon — economically part of the *compute* category in our taxonomy — not the freestanding "computer storage device manufacturing" PPI (`PCU334112334112`) that our storage group actually tracks. Used as salience/directional evidence, not transplanted as a literal storage-group share. |
| Sourceability / Tom's Hardware, memory price tracking (TrendForce-sourced) | 2026-01 to 2026-07 (rolling) | https://sourceability.com/post/tracking-memory-price-increases-across-the-last-several-quarters ; https://www.tomshardware.com/pc-components/ram/memory-price-surge-begins-to-cool-as-consumers-hit-affordability-limit-ai-demand-still-keeps-dram-and-nand-prices-climbing-through-q3-2026 | DRAM contract prices +58–63% QoQ and NAND +70–75% QoQ in 2Q 2026, moderating to +13–18% / +10–15% QoQ in Q3 2026 — a sustained multi-quarter repricing cycle, not a one-off print. Corroborates that `ppi_storage`'s own +31.5% YoY (design spec §3, snapshot 2026-07-15) sits inside a real, broad industry cycle rather than being an outlier — the substantive reason to hold storage's weight at the pre-AI ceiling rather than drop it to the raw ~8% capex-share floor. |
| Dell'Oro Group, "Data Center Networking in 2025–2026" + SDxCentral coverage | 2026-02-05 | https://www.delloro.com/2026-predictions-data-center-switch-frontend-ai-backed-networks/ ; https://www.sdxcentral.com/news/ai-back-end-networks-to-drive-data-center-switch-spending-past-100b-by-2030/ | Dell'Oro: "Spending on data center switches deployed in AI back-end networks is forecast to surpass $100 billion by 2030"; a prior Dell'Oro estimate put Ethernet alone at "nearly $80 billion in data center switch sales over the next five years." Directly quoted via SDxCentral's coverage of the Dell'Oro report (Dell'Oro's own site was not paywalled for this specific figure). Supports network's AI-cycle buildout as a genuine, fast-growing cost category beyond the traditional ~10–13% baseline. |

## (b) Per-group weight decision

### Compute: 0.60 → **0.65**

Every citation — traditional (IoT Analytics: 61% of total DC spend, ~79% renormalized to the
three hardware categories) and AI-era (Epoch AI/SemiAnalysis: 60% of total annualized TCO;
Dell'Oro: GPUs/accelerators alone ~33% of *total* capex, servers trending toward ~50% of DC
infrastructure spend by 2029) — puts compute as the clear majority share, consistently at or
above 60%. The plan's provisional 0.60 sits at the *low* end of the cited range rather than the
middle or high end. A modest raise to 0.65 stays conservative relative to the renormalized
traditional-market figure (~79%) and the AI-cluster TCO figure (60% of an even broader,
non-IT-hardware-only denominator), while not overreacting to the more volatile GPU-cycle-specific
estimates.

### Storage & memory: 0.25 → **0.15**

No citation found supports storage at 0.25 (25%) of DC IT-hardware capex. Every source is well
below that:
- Traditional/general market (IoT Analytics, 2024 actuals): 6.5% of total DC spend, ~8%
  renormalized to servers+storage+network.
- Pure AI-training-cluster TCO (Epoch AI/SemiAnalysis): ~1–1.5% of total annualized cost.
- IDC's own Q1 2026 AI-elevated storage growth (+22.7% YoY, AI-demand-attributed): even at this
  accelerated rate, storage revenue is ≈8% of concurrent server-market revenue.

The brief's fork was explicit: justify 0.25 with 2025–26 memory/storage price-cycle salience
*and* an AI-era-buildout citation, or lower it and re-split. The AI-era citation that exists
(SemiAnalysis: memory ≈30% of hyperscaler capex in CY2026, up 4x from CY23) is real and dated,
but — as noted in the citations table — it is dominated by HBM bundled into GPU/accelerator
packages, not the freestanding storage-device manufacturing our `ppi_storage`
(`PCU334112334112`) series prices. Transplanting that figure onto the storage *group* weight
would be citation laundering: real number, wrong denominator. The honest reading of the evidence
is that storage's structural capex *share* is small (single digits to ~8%) even in the AI era,
while its *price* is currently the most volatile and economically salient line in the basket
(sustained multi-quarter DRAM/NAND repricing, corroborated by TrendForce-sourced data; the
storage PPI's own +31.5% YoY print at design time). That salience argument supports holding
storage at the plan's own stated "pre-AI norm" ceiling of ~0.15 — capturing the price signal
without inflating the capex-share claim past what any source states. **Final: 0.15**, not 0.25,
and not dropped all the way to the raw ~8% capex-share figure either.

### Network: 0.15 → **0.20**

Citations bracket network capex share from ~10% (IoT Analytics, traditional) to ~13%
(renormalized IoT Analytics; Epoch AI/SemiAnalysis AI-cluster TCO) to a genuine AI-specific
buildout story: Dell'Oro's $100B-by-2030 AI-back-end-switch forecast and ~$80B five-year Ethernet
switch outlook, plus the broader Ethernet-overtaking-InfiniBand shift in AI fabric (found via
search, not independently re-fetched for exact figures — treated as directional corroboration,
not a load-bearing number). A raise from 0.15 to 0.20 sits above the traditional 10–13% baseline,
consistent with the AI-cycle network buildout being real and citable, while remaining well below
compute's share and not requiring the same "wrong denominator" caveat that disqualified a bigger
storage raise (Dell'Oro's switch/optics figures are literally about network hardware, not
compute silicon repurposed as a network proxy).

## (c) Lens subdivision (compute group — editorial, not cited)

The compute group's total (now 0.65, cited per §b) is split across three official series that
together approximate "compute hardware" from three angles — imported finished goods, domestic
components, and imported chips. **This three-way subdivision is an editorial blend, not a cited
split**; no source in §a breaks "compute" down by import-vs-domestic or finished-goods-vs-chips
lenses. It is carried over unchanged in *proportion* from the design spec's original 0.35/0.15/0.10
(which summed to the group's original 0.60), rescaled to the new 0.65 group total while preserving
the same relative weighting between the three lenses:

| Registry code | Series | Original weight (of 0.60) | Relative share | Rescaled weight (of 0.65) |
|---|---|---|---|---|
| `mxp_computers_exsemi` | Imported hardware ex-semis (`IR213COM`) | 0.35 | 58.3% | **0.38** |
| `ppi_semis_components` | Semis & electronic components PPI (`PCU33443344`) | 0.15 | 25.0% | **0.16** |
| `mxp_semis` | Imported semiconductors (`IR21320`) | 0.10 | 16.7% | **0.11** |

Check: 0.38 + 0.16 + 0.11 = 0.65, matching the compute group's cited total exactly.

## (d) Excluded series, with receipts

Per the design spec (`docs/superpowers/specs/2026-07-15-dc-hardware-index-design.md` §3),
carried forward here as the record of *why* these are absent from the basket, not re-derived:

- **`PCU3344133344131`** (IC packages, industry side) has a 14-month publication hole
  (2024-06 → 2025-07) that would violate the engine's YoY-base rule (component YoY computed at
  each component's own last observation — a hole spanning the prior-year comparison month
  produces a `None` YoY, not a wrong one, but the hole itself doesn't clear until 2026-08).
  Excluded from both the basket and the gap panel.
- **Fiber-optic-cable PPI `PCU335921335921`** is dormant — no prints since 2025-06. A connector
  for a dormant series would rot (perpetual staleness flag, no signal). Excluded.
- **Hedonic exclusions** (in the gap panel as contrast, deliberately *not* in the basket, per the
  design's decision #1 — the site's Manheim-vs-CPI-used-cars argument applied to hardware):
  domestic servers PPI (`ppi_servers` / `PCU3341113341115`), CPI computers & peripherals
  (`cpi_computers` / `CUUR0000SEEE01`), and the headline semiconductor manufacturing PPI
  (`ppi_semi_headline` / `PCU334413334413`). All three are subject to BLS hedonic quality
  adjustment, which structurally flattens their YoY prints relative to actual transaction prices
  (at design-time snapshot: −0.8%, −0.6%, and +4.4%/−8.0% for the related wafer series, against
  transaction-sensitive series in the 12–32% range) — averaging them into the index would mute
  the real price signal the basket exists to capture. They remain visible in the hedonic-gap
  panel precisely so the contrast is legible on the page, not hidden.

## (e) Final weights

### DC Hardware basket (group sums, must total 1.0)

| Group | Weight | Citation basis |
|---|---|---|
| Compute | **0.65** | Raised from plan's 0.60 — every citation (traditional and AI-era) puts compute's share at 60%+ of DC hardware/IT-cluster spend; §b |
| Storage & memory | **0.15** | Lowered from plan's 0.25 — no citation supports a quarter share; held at the pre-AI-norm ceiling on 2025–26 price-cycle salience grounds rather than raised on a mismatched AI-capex figure; §b |
| Network | **0.20** | Raised from plan's 0.15 — AI-back-end network buildout is real and citable (Dell'Oro switch/optics forecasts) beyond the ~10–13% traditional baseline; §b |

Sum check: 0.65 + 0.15 + 0.20 = **1.00** exactly.

### Per-series weights (Task 3's `config/dc_basket.json` copies these verbatim)

| Registry code | Group | Series | Weight |
|---|---|---|---|
| `mxp_computers_exsemi` | compute | Imported hardware ex-semis (`IR213COM`) | 0.38 |
| `ppi_semis_components` | compute | Semis & electronic components PPI (`PCU33443344`) | 0.16 |
| `mxp_semis` | compute | Imported semiconductors (`IR21320`) | 0.11 |
| `ppi_storage` | storage | Computer storage devices PPI (`PCU334112334112`) | 0.15 |
| `ppi_network_equip` | network | Network & telephone apparatus PPI (`PCU334210334210`) | 0.20 |

Sum check: 0.38 + 0.16 + 0.11 + 0.15 + 0.20 = **1.00** exactly (verified in Python to avoid
floating-point drift: `sum([0.38, 0.16, 0.11, 0.15, 0.20]) == 1.0`).

## Method note

Verification used WebSearch and WebFetch against public sources only — no API keys, no repo
state changed. Where a figure came only from a WebSearch results summary rather than a direct
WebFetch of primary text (Synergy's server/storage/network sub-split; the general Ethernet-vs-
InfiniBand share shift), it is flagged as such in §a and treated as corroborating context, never
as the sole basis for a weight. Every number that drives the final weight decision in §b/§e was
independently confirmed via WebFetch of the source page with its publication date recorded.
