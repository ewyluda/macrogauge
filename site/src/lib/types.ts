// Hand-written types for published artifacts whose shape legally varies with
// data availability. Pages must cast these imports (`import x from ".json"`
// then `x as Fuel`) instead of relying on inference: TypeScript infers JSON
// types from the *committed sample*, so a valid degraded artifact — nulled
// fields, empty arrays — would otherwise fail `next build`.
// Keep in sync with schemas/{fuel,nextprint,nowcast_latest}.schema.json.

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
    parameters: { fuel_beta: number; rent_lag_months: number; rent_w: number };
    components: NowcastComponent[];
  };
  pce: {
    mom_pct: number | null;
    status: string;
    as_of: string | null;
    parameters: { observations?: number; intercept?: number; cpi_beta?: number; window_months?: number };
  };
  nfp: { change_thousands: number } | null;
  benchmarks: Record<string, number | null>;
  ensemble: { value: number | null; weights: Record<string, number> };
  generated_on: string;
};
