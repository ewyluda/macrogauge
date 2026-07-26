// Hand-written types for published artifacts whose shape legally varies with
// data availability. Pages must cast these imports (`import x from ".json"`
// then `x as Fuel`) instead of relying on inference: TypeScript infers JSON
// types from the *committed sample*, so a valid degraded artifact — nulled
// fields, empty arrays — would otherwise fail `next build`.
// Keep in sync with schemas/{fuel,nextprint,nowcast_latest,outlook}.schema.json.

export type Forecaster = { name: string; value: number; kind: string; as_of: string };

export type NextPrint = {
  published_at: string;
  target: string;
  release_date: string | null; // null once the release calendar is exhausted
  reference_month: string | null;
  ensemble: { value: number | null; weights: Record<string, number> };
  forecasters: Forecaster[];
};

export type Fuel = {
  published_at: string;
  available: boolean;
  formula: string;
  as_of: string | null;
  pump: number | null;
  forward_2wk: number | null;
  proxy: string | null;
};

export type OutlookPoint = { month: string; yoy_pct: number };

export type Outlook = {
  published_at: string;
  model: string;
  as_of: string;
  origin_month: string;
  horizon_months: 12;
  latest_complete_month_yoy_pct: number;
  history: OutlookPoint[];
  forecast: Array<{
    month: string;
    central_yoy_pct: number;
    mom_pct: number;
    low_yoy_pct: number;
    high_yoy_pct: number;
  }>;
  base_effects_only: OutlookPoint[];
  sigma_monthly_pp: number;
  sigma_window_months: number;
  driver_coverage_pct: number;
  drivers: Array<{
    key: string;
    name: string;
    value: number | null;
    unit: string;
    reading: string;
    as_of: string | null;
    status: "live" | "partial" | "fallback";
    effect: string;
    sources: string[];
  }>;
  // pruned to the one knob the chart labels; the full config + component_paths
  // stay out of the RSC payload (see page.tsx)
  parameters: { baseline_annual_pct: number };
  method: string;
  disclaimer: string;
};

// --- P2 geography artifacts (metros.json / geo.json / matrix.json) ----------
// All fields are legally nullable (a series with no store rows publishes a null
// block), so pages must cast these imports rather than infer from the sample.

export type MetroBlock = {
  value: number | null;
  as_of: string | null;
  yoy_pct: number | null;
  yoy_tail: { months: string[]; yoy_pct: (number | null)[] };
};

export type Metro = {
  region_id: string;
  name: string;
  zori: MetroBlock;
  zhvi: MetroBlock;
};

export type Metros = {
  published_at: string;
  metros: Metro[];
  national: { zori: MetroBlock; zhvi: MetroBlock };
};

export type GeoMeasure = {
  value: number | null;
  as_of: string | null;
  yoy_pct: number | null;
};
export type GeoRate = {
  value: number | null;
  as_of: string | null;
  delta_1y_pp: number | null;
};
export type GeoPanel = {
  gas_regular: GeoMeasure;
  elec_res_cents: GeoMeasure;
  elec_ind_cents: GeoMeasure;
  wage_weekly: GeoMeasure;
  unemployment_pct: GeoRate;
};
export type GeoStateRow = { state: string; name: string } & GeoPanel;
export type Geo = {
  published_at: string;
  states: GeoStateRow[];
  national: GeoPanel;
};

export type MatrixRow = {
  code: string;
  label: string;
  value: number | null;
  unit: string;
  as_of: string | null;
  cadence: string;
};
export type Matrix = {
  published_at: string;
  groups: { group: string; rows: MatrixRow[] }[];
};

export type CommodityRow = {
  code: string;
  label: string;
  unit: string;
  value: number | null;
  as_of: string | null;
  yoy_pct: number | null;
  chg_30d_pct: number | null;
  spark: number[];
};
export type Commodities = {
  published_at: string;
  groups: { group: string; rows: CommodityRow[] }[];
};

export type Labor = {
  published_at: string;
  payrolls: { level_k: number | null; mom_change_k: number | null; yoy_pct: number | null; as_of: string | null };
  unemployment: { rate: number | null; delta_1y_pp: number | null; as_of: string | null };
  claims: { initial: number | null; initial_4wk_avg: number | null; continued: number | null; as_of: string | null };
  wages: { ahe_yoy_pct: number | null; atlanta_wgt_pct: number | null; as_of: string | null };
  history: {
    monthly: { months: string[]; payrolls_yoy_pct: (number | null)[]; unemployment_rate: (number | null)[] };
    weekly: { dates: string[]; initial_claims: (number | null)[] };
  };
};

export type NowcastComponent = {
  component: string;
  mom_pct: number;
  weight: number;
  contribution_pp: number;
  basis: "measured" | "trend" | "trend+driver";
  driver_mom_pct?: number;
};

export type Nowcast = {
  published_at: string;
  target: string;
  release_date: string | null;
  reference_month: string | null;
  cpi: {
    mom_pct: number | null;
    yoy_pct: number | null;
    as_of: string | null;
    status: string;
    parameters: Record<string, number>;
    components: NowcastComponent[];
  };
  pce: {
    mom_pct: number | null;
    status: string;
    as_of: string | null;
    parameters: { observations?: number; intercept?: number; cpi_beta?: number; window_months?: number };
  };
  nfp: { change_thousands: number; reference_month: string } | null;
  benchmarks: Record<string, { value: number; as_of: string } | null>;
  ensemble: { value: number | null; weights: Record<string, number> };
  generated_on: string;
};

export type CapacityCompany = {
  t: string; n: string; role: "neocloud" | "landlord" | "operator" | "hyperscaler" | "exploratory";
  dupe: string | null; private: boolean; confidence: "filed" | "estimate";
  flag?: string | null; dom?: string | null; pipe?: string | null;
  op: number; con: number; plan: number;
  nd?: number | null; ndflag?: string | null; bk?: number | null;
  valuation_b: number | null;
  cap: number | null; px: number | null; priced_date: string | null; stale: boolean;
  ev: number | null; wmw: number; ev_per_mw: number | null;
  pct_energized: number | null; coverage: number | null;
  econ: Record<string, string> | null;
  sites: [string, number | null, string, string][];
  src: [string, string][];
  tl: [string, string, number][];
};

export type CapacityTimeline = {
  base_mw: number;
  points: { q: string; add_mw: number; cum_mw: number }[];
  milestones: Record<string, [string, string, number][]>;
};

export type CapacityCohortKey = "all" | "neocloud" | "hyperscaler";

export type Capacity = {
  published_at: string; as_of_curated: string; priced_date: string | null;
  note: string; basis: Record<string, string>;
  companies: CapacityCompany[];
  cohorts: Record<CapacityCohortKey, { companies: number; op: number; con: number; plan: number }>;
  timeline: Record<CapacityCohortKey, CapacityTimeline>;
  tenants: [string, string, number | null, string][];
  geo: { t: string; site: string; mw: number | null; st: string; lat: number; lng: number; when?: string; approx: boolean }[];
  geo_unmapped: { t: string; site: string; mw: number | null; st: string; why: string }[];
  geo_note: string;
  reference: { nvda_cap_b: number | null; cohort_ev_b: number | null };
};

// Keep in sync with schemas/dc_markets.schema.json.
export type MarketCounty = {
  fips: string;
  wage: number | null;
  emp: number | null;
  wage_yoy_pct: number | null;
  emp_yoy_pct: number | null;
};

export type MarketRow = {
  key: string;
  name: string;
  state: string;
  iso: string | null;
  grid: string | null;
  utility: string;
  note: string;
  as_of: string | null;
  base_date: string | null;
  available: boolean;
  thin_base: boolean;
  // wage/emp are the like-for-like basis (counties present in both quarters)
  // so they reconcile arithmetically with the YoY computed from them.
  wage: number | null;
  wage_yoy_pct: number | null;
  wage_spread_pp: number | null;
  emp: number | null;
  emp_yoy_pct: number | null;
  emp_spread_pp: number | null;
  // wage_cur/emp_cur_total are the market's TRUE current size, computed over
  // all counties with current-quarter data. The panel displays
  // emp_cur_total (not emp) so a market's published size never depends on
  // whether a county was disclosed a year ago.
  wage_cur: number | null;
  emp_cur_total: number | null;
  // yoy_basis is the regime marker for the YoY figures above: "like_for_like"
  // or null when there is no YoY at all (e.g. a newly-tracked or fully
  // suppressed market).
  yoy_basis: "like_for_like" | null;
  counties: MarketCounty[];
  counties_total: number;
  counties_used: number;
  counties_suppressed: string[];
  sites: number;
  mw_disclosed: number;
  sites_mw_undisclosed: number;
  // Per-status split of mw_disclosed (pipeline/publish/dc_markets.py), keyed
  // to GeoMap.tsx's legend: o/c/p/s. "In flight" means mw_construction ONLY
  // (st="c") -- the same definition capacity.py's _events() uses -- because
  // operating, planned and secured sites have no crews on site. The four
  // buckets sum to mw_disclosed.
  mw_construction: number;
  mw_planned: number;
  mw_secured: number;
  mw_operating: number;
};

export type DcMarkets = {
  published_at: string;
  as_of: string | null;
  base_date: string | null;
  as_of_curated: string;
  note: string;
  coverage_note: string;
  national: {
    wage: number | null;
    wage_yoy_pct: number | null;
    emp: number | null;
    emp_yoy_pct: number | null;
    as_of: string | null;
  };
  markets: MarketRow[];
};

// dc_grades.json -- the escalation grading harness behind /dc-scoreboard.
// Keep in sync with schemas/dc_grades.schema.json.

export type GradeStat = {
  n: number;
  independent_draws: number;
  shortfall_rate_pct: number;
  mean_shortfall_pp: number;
  worst_shortfall_pp: number;
  bias_pp: number;
  mae_pp: number;
};

export type Leg = {
  provenance: string;
  span: [string | null, string | null];
  anchors_n: number;
  contains_downturn: boolean;
  // Which horizons THIS leg actually grades -- the strict leg publishes only
  // [12, 24] (schema description, spec §2.1a's human ruling). Read this,
  // never assume every leg carries all four HORIZONS.
  published_horizons: number[];
  // basis_key -> horizon_key -> stats, or null when the horizon nominally
  // publishes (per published_horizons) but no anchor reached that far.
  grades: Record<string, Record<string, GradeStat | null>>;
};

export type DcGradesAnchor = {
  m: string;
  leg: string;
  bases: Record<string, number | null>;
  realized: Record<string, number | null>;
};

// Hindsight-selected regimes (GFC, COVID peak): rate + window only, never a
// grading statistic -- the schema structurally forbids shortfall/mae/bias/n
// fields on these (schemas/dc_grades.schema.json).
export type DcGradesScenario = {
  key: string;
  label: string;
  start_month: string;
  end_month: string;
  annualized_pct: number | null;
  hindsight_selected: true;
  note: string;
};

export type LeadLagHalf = {
  best_lag_months: number | null;
  best_correlation: number | null;
};

export type LeadLagMapping = {
  driver: string;
  driver_label: string;
  component: string;
  component_label: string;
  weight: number;
  months: number;
  span: [string | null, string | null];
  best_lag_months: number | null;
  best_correlation: number | null;
  stable: boolean;
  first_half: LeadLagHalf;
  second_half: LeadLagHalf;
  profile: { lag: number; corr: number | null }[];
};

export type LeadLagCaveat = { key: string; text: string };

export type LeadLag = {
  mappings: LeadLagMapping[];
  weight_covered: number;
  weight_stable: number;
  verdict: string;
  gate: string;
  // A positive gate result (weight_stable > 0) must never be rendered
  // without these alongside it -- schema requires both structurally.
  caveats: LeadLagCaveat[];
  conclusion: string;
};

export type PowerNowcast = {
  as_of: string | null;
  months_graded: number;
  carry_forward_mae: number | null;
  best_lambda: number | null;
  best_mae: number | null;
  verdict: "PASS" | "FAIL" | "INSUFFICIENT";
  note: string;
};

export type DcGrades = {
  published_at: string;
  as_of: string | null;
  paired_legs_note: string;
  revision_disclosure_pp: number;
  // Keyed by leg name ("strict"/"extended" normally; {} when degraded).
  legs: Record<string, Leg>;
  anchors: DcGradesAnchor[];
  scenarios: DcGradesScenario[];
  leadlag: LeadLag | null;
  power_nowcast: PowerNowcast | null;
};
