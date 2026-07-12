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
  method: string;
  disclaimer: string;
};

export type NowcastComponent = {
  component: string;
  mom_pct: number;
  weight: number;
  contribution_pp: number;
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
