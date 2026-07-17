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

export type LaborBlock = { as_of: string | null };
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
