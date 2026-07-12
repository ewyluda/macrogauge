# DC Series Verification Spike Notes (2026-07-12)

Verification run against live FRED, EIA, FMP, and BLS QCEW endpoints using the
user's own API keys (`.env`, symlinked into this worktree). Corrects the
plan's candidate series IDs where the candidate 404'd or a closer match
existed. These IDs are authoritative for Tasks 3-4 — where this file
disagrees with the plan body, this file wins.

## (a) Final national series table

| registry code | confirmed source_id | title | frequency | observation_start | units |
|---|---|---|---|---|---|
| `ces_constr_ahe` | `CES2000000003` | Average Hourly Earnings of All Employees, Construction | Monthly | 2006-03-01 | $/hr |
| `ppi_elec_contr` | `PCU23821X23821X` | PPI by Industry: Electrical Contractors, Nonresidential Building Work | Monthly | 2007-12-01 | index |
| `ppi_plumb_hvac` | `PCU23822X23822X` | PPI by Industry: Plumbing, Heating and Air-Conditioning Contractors, Nonresidential Building Work | Monthly | 2007-12-01 | index |
| `ppi_steel` | `WPU1017` | PPI by Commodity: Steel Mill Products | Monthly | 1939-01-01 | index |
| `ppi_concrete` | `PCU327320327320` | PPI by Industry: Ready-Mix Concrete Manufacturing | Monthly | 1965-01-01 | index |
| `ppi_copper_wire` | `WPU10260314` | PPI by Commodity: Copper Wire and Cable | Monthly | 1986-12-01 | index |
| `ppi_alum_shapes` | `WPU102501` | PPI by Commodity: Aluminum Mill Shapes | Monthly | 1947-01-01 | index |
| `ppi_switchgear` | `WPU1175` | PPI by Commodity: Switchgear, Switchboard, Industrial Controls Equipment | Monthly | 1947-01-01 | index |
| `ppi_transformer` | `WPU1174` | PPI by Commodity: Transformers and Power Regulators | Monthly | 1947-01-01 | index |
| `ppi_genset` | `PCU333611333611` | PPI by Industry: Turbine and Turbine Generator Set Units Manufacturing | Monthly | 1982-06-01 | index |
| `ppi_hvac_equip` | `PCU333415333415` | PPI by Industry: Air-Conditioning, Refrigeration, and Forced Air Heating Equipment Manufacturing | Monthly | 1977-12-01 | index |
| `ppi_pumps` | `WPU1141` | PPI by Commodity: Pumps, Compressors, and Equipment | Monthly | 1947-01-01 | index |
| `ces_dp_ahe` | `CES5000000003` | Average Hourly Earnings of All Employees, Information (supersector) | Monthly | 2006-03-01 | $/hr |
| `ppi_mach_repair` | `PCU811310811310` | PPI by Industry: Commercial Machinery Repair and Maintenance | Monthly | 2006-06-01 | index |
| `fmp_copper` | `HGUSD` | Copper futures front month | daily (futures) | 2017-01-03 (history checked from) | $/lb |
| `fmp_alum` | `ALIUSD` | Aluminum futures front month | daily (futures) | 2017-01-03 (history checked from) | $/ton |
| `eia_elec_ind_us` / `eia_elec_ind_{st}` | `ELEC.PRICE.{ST}-IND.M` | Industrial electricity price | Monthly | pre-2017 (long-running EIA series) | cents/kWh |
| `qcew_wage23_us` / `qcew_wage23_{st}` | QCEW industry-23 CSV, `area_fips` `US000`/`{fips}000`, `own_code` 5 | Avg weekly wage, private construction (NAICS 23) | Quarterly | pre-2017 | $/week |

All confirmed IDs are Monthly (or daily for futures / quarterly for QCEW), with
`observation_start` on or before 2017-01-01 except the two AHE series
(`CES2000000003`, `CES5000000003`), which both start 2006-03-01 — still
comfortably before the 2017-01 grid start.

## (b) Substitutions and why

- **`ppi_elec_contr`**: plan's candidate `PCU238210238210` 404s ("series does
  not exist"). FRED search for "PPI electrical contractors" surfaces
  `PCU23821X23821X` (Electrical Contractors, Nonresidential Building Work,
  monthly, starts 2007-12) as the closest live match — same NAICS 23821X
  contractor class the candidate targeted.
- **`ppi_plumb_hvac`**: same failure mode; candidate `PCU238220238220` 404s,
  substituted with `PCU23822X23822X` (Plumbing/HVAC Contractors,
  Nonresidential Building Work, monthly, starts 2007-12).
- **`ppi_copper_wire`**: candidate `WPU10260321` 404s. `WPU1026` (nonferrous
  wire & cable, the plan's own fallback) exists but is broader than intended.
  A targeted search surfaced `WPU10260314` — "Copper Wire and Cable"
  specifically, monthly, starts 1986-12 — a tighter match to the concept than
  the nonferrous fallback, so used instead.
- **`ppi_alum_shapes`**: candidate `WPU1025` exists but its title is "Nonferrous
  Mill Shapes" (all nonferrous metals, not aluminum-specific). `WPU102501`
  ("Aluminum Mill Shapes" exactly) exists, is monthly, and starts 1947 — used
  in place of the broader candidate.
- **`ces_dp_ahe`**: candidate `CES5051800003` 404s — FRED does not publish a
  national average-hourly-earnings series at NAICS 518 (data
  processing/hosting) detail; only local-area *employment counts* exist at
  that detail (e.g. `SMU06000005051800001`), not wages, and not national.
  Substituted with `CES5000000003` — Average Hourly Earnings, Information
  supersector (NAICS 51) — the finest-grain national AHE series that contains
  data processing/hosting. This is a broader substitution than the others
  (supersector vs. 3-digit industry); flagged as a known approximation for
  the "facilities & ops wages" ops-basket component.

All 10 other candidates (`ces_constr_ahe`, `ppi_steel`, `ppi_concrete`,
`ppi_switchgear`, `ppi_transformer`, `ppi_genset`, `ppi_hvac_equip`,
`ppi_pumps`, `ppi_mach_repair`) verified exactly as proposed: Monthly,
`observation_start` ≤ 2017-01-01, titles matching the concept.

## (c) EIA state industrial electricity — value column finding

`GET https://api.eia.gov/v2/seriesid/{sid}` (`sid` = `ELEC.PRICE.{ST}-IND.M`)
returns `response.data[0]` with:
- `period`: `"YYYY-MM"` (latest checked: `2026-04`)
- `price`: float, **units `cents per kilowatt-hour`** (this is the value
  column — there is no separate `value` key)
- `stateid`, `stateDescription`, `sectorid` (`IND`), `sectorName`

Confirmed for `US`, `CA`, `VA` — pattern generalizes directly to all 50
states + DC by swapping the 2-letter `stateid` in the series ID.

## (d) QCEW CSV — header, route, and national-row finding

`GET https://data.bls.gov/cew/data/api/{year}/{qtr}/industry/{naics}.csv`
(checked `2025/4/industry/23.csv`, 200 OK, ~1.1MB).

Header (relevant columns): `area_fips`, `own_code`, `industry_code`,
`agglvl_code`, `size_code`, `year`, `qtr`, `total_qtrly_wages`, `avg_wkly_wage`
— confirms the plan's assumed field names exactly, no adjustment needed to
Task 2's connector/test field names.

- **`US000` DOES have an `own_code` 5 (private) row** in the industry-23
  slice — the plan's contingency (extra `area/US000.csv` GET) is **not
  needed**. `US000/5`: `avg_wkly_wage=1815`.
- `06000` (CA) `own_code` 5: `avg_wkly_wage=1973`.
- `51000` (VA) `own_code` 5: `avg_wkly_wage=1804`.
- `48000` (TX) `own_code` 5: `avg_wkly_wage=1851`.

Fixture recorded at `tests/fixtures/qcew_industry23.csv`: header line + the
four `own_code`-5 rows above (US000, 06000, 48000, 51000) — 5 lines total,
confirmed by `wc -l`.

## (e) FMP futures confirmation

`GET /stable/batch-quote?symbols=HGUSD,ALIUSD` — both quote live (HGUSD
$6.28/lb copper, ALIUSD $3303.50/ton aluminum).

`GET /stable/historical-price-eod/light?symbol={sym}&from=2017-01-01` —
HGUSD: 2496 rows, earliest 2017-01-03. ALIUSD: 2493 rows, earliest
2017-01-03. Both comfortably exceed the "at least a year" acceptance bar;
deep history reaches back to the 2017 grid start itself, though (per spec)
the anchored splice only needs overlap with the most recent PPI print, not
full grid depth.

## (f) Final weights

Base building blocks (Turner & Townsend "Data centre construction cost index
2025-2026" and industry cost-structure summaries, see citations below) put
**mechanical & electrical equipment consistently at 30-50%+ of total
construction cost** for hyperscale/AI-class facilities, with electrical
specifically called out as the single largest cost driver (transformer/
switchgear lead times and pricing have both surged since 2019-2024). This
confirms the plan's instruction to stress-test the electrical share upward
from a flat 30%.

Citations:
- Turner & Townsend, "Data centre construction cost index 2025-2026" —
  https://www.turnerandtownsend.com/insights/data-centre-construction-cost-index-2025-2026/
  and https://reports.turnerandtownsend.com/data-centre-construction-cost-index-2025/methodology
  — capital cost is captured under: shell & core, architectural fit-out,
  mechanical & electrical fit-out, GC prelims/margin/contingency, and
  **mechanical and electrical equipment** as a distinct heading; 5.5% YoY
  cost-per-watt increase in 2025 (vs 9.0% in 2024); electrical
  equipment/supply chain named as the primary inflation driver industry-wide.
- Industry cost-structure summary (aggregating public breakdowns) —
  https://www.alpha-matica.com/post/deconstructing-the-data-center-a-look-at-the-cost-structure-1
  — **electrical systems ~50%** of total construction cost; **mechanical &
  cooling 15-20%**; building shell/fit-out the remainder. Note: this
  "electrical systems" figure bundles equipment *and* its installation labor
  and wiring materials — broader than our basket's equipment-only
  "electrical" group, so it upper-bounds rather than directly sets the
  electrical-equipment weight.
- Recent transformer/switchgear pricing/lead-time commentary (industry press,
  aggregated in the same source above) — transformer costs up 77-95% and
  lead times to 4 years since 2019, corroborating the emphasis on electrical
  equipment as the highest-conviction weight to lean into.

Given the ~50% "electrical systems" ceiling includes labor/materials this
basket already prices separately elsewhere, the final weights nudge the
electrical-equipment group up from the plan's flat 30% to **35%**, taking the
difference from materials (25% → 20%) rather than labor (kept at 30%, since
labor costs are separately and robustly documented via CES/PPI contractor
series) or mechanical (kept at 15%, in the middle of the cited 15-20% range).

### DC Build (group sums, must total 1.0)

| group | weight | citation basis |
|---|---|---|
| labor | 0.30 | unchanged — CES/PPI contractor-labor series are well-established at this share in construction cost models generally |
| materials | 0.20 | reduced from plan's 0.25 to fund the electrical bump |
| electrical | 0.35 | raised from plan's 0.30 per Turner & Townsend / cost-structure citations above |
| mechanical | 0.15 | unchanged — matches the cited 15-20% mechanical/cooling range |

Per-series weights within each group (unchanged proportional split from the
plan except rescaled to the new group totals):

| code | group | weight |
|---|---|---|
| `constr_wages` | labor | 0.15 |
| `elec_contractors` | labor | 0.09 |
| `plumb_hvac_contractors` | labor | 0.06 |
| `steel` | materials | 0.065 |
| `concrete` | materials | 0.05 |
| `copper_wire` | materials | 0.055 |
| `alum_shapes` | materials | 0.03 |
| `switchgear` | electrical | 0.14 |
| `transformers` | electrical | 0.12 |
| `generators` | electrical | 0.09 |
| `hvac_equip` | mechanical | 0.10 |
| `pumps` | mechanical | 0.05 |

Sum check: 0.15+0.09+0.06 (0.30) + 0.065+0.05+0.055+0.03 (0.20) +
0.14+0.12+0.09 (0.35) + 0.10+0.05 (0.15) = 1.00 exactly.

### DC Ops (unchanged from plan — no citation basis to revise)

| code | group | weight |
|---|---|---|
| `power` | power | 0.55 |
| `ops_wages` | ops_labor | 0.30 |
| `maintenance` | maintenance | 0.15 |

The ops basket's power-dominant split is directly supported by industry
commentary that electricity is the dominant recurring opex line for
data-center operations (power/cooling opex >> facilities labor and
maintenance combined) — no stress-test flag was raised for this basket, so
the plan's provisional weights stand as final.

## Environment note

Verification used the repo's `.env` (FRED/EIA/FMP/USDA keys), symlinked into
this worktree rather than copied, and never echoed to stdout/logs.
