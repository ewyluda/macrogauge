// Why each DC index group carries the weight it does, with the public sources
// behind it. Transcribed from the weight spikes that set config/dc_basket.json:
// docs/superpowers/specs/2026-07-12-dc-series-spike-notes.md §(f) (Build, Ops)
// and docs/superpowers/specs/2026-07-15-dc-hardware-spike-notes.md §(a)–(e)
// (Hardware). `weight` restates the config value the text argues for:
// dcWeightBasis.test.ts fails when the published group weights drift from it,
// so a reweight can't ship with a stale rationale.

export type Cite = { label: string; href: string };
export type WeightBasis = { weight: number; note: string; cites: Cite[] };
export type DcIndexKey = "build" | "ops" | "hardware";

const TT: Cite = {
  label: "Turner & Townsend, Data centre construction cost index 2025–2026",
  href: "https://www.turnerandtownsend.com/insights/data-centre-construction-cost-index-2025-2026/",
};
const COST_STRUCTURE: Cite = {
  label: "Alpha Matica, data-center cost structure",
  href: "https://www.alpha-matica.com/post/deconstructing-the-data-center-a-look-at-the-cost-structure-1",
};
const EPOCH: Cite = {
  label: "Epoch AI, TCO of a 1 GW AI data center (2026)",
  href: "https://epoch.ai/data-insights/ai-datacenter-cost-breakdown",
};
const IOT: Cite = {
  label: "IoT Analytics, data-center infrastructure market 2025–2030",
  href: "https://iot-analytics.com/data-center-infrastructure-market/",
};
const DELLORO_CAPEX: Cite = {
  label: "Dell'Oro, data-center capex to surpass $1 trillion by 2029",
  href: "https://www.delloro.com/news/data-center-capex-to-surpass-1-trillion-by-2029/",
};
const DELLORO_NETWORK: Cite = {
  label: "Dell'Oro, AI back-end network switch forecast",
  href: "https://www.delloro.com/2026-predictions-data-center-switch-frontend-ai-backed-networks/",
};

const OPS_NOTE =
  "Design weights, not taken from a single published study: electricity is the largest recurring " +
  "operating cost of a data center, so it carries the majority share ahead of facilities labor and maintenance.";

export const DC_WEIGHT_BASIS: Record<DcIndexKey, Record<string, WeightBasis>> = {
  build: {
    labor: {
      weight: 0.3,
      note: "Construction wages plus electrical and plumbing/HVAC contractor prices, at the share construction cost models commonly give site labor. No external source was used to move it.",
      cites: [],
    },
    materials: {
      weight: 0.2,
      note: "Cut from a provisional 25% to fund the larger electrical share; steel, concrete, copper and aluminum keep their proportions inside the group.",
      cites: [],
    },
    electrical: {
      weight: 0.35,
      note: "Raised from 30%. Turner & Townsend names electrical equipment the main source of data-center cost inflation, and public cost breakdowns put electrical systems near 50% of build cost. That 50% includes installation labor and wiring this basket prices elsewhere, so it caps the equipment-only share rather than setting it.",
      cites: [TT, COST_STRUCTURE],
    },
    mechanical: {
      weight: 0.15,
      note: "Inside the 15–20% range public cost breakdowns give mechanical and cooling systems.",
      cites: [COST_STRUCTURE],
    },
  },
  ops: {
    power: { weight: 0.55, note: OPS_NOTE, cites: [] },
    ops_labor: { weight: 0.3, note: OPS_NOTE, cites: [] },
    maintenance: { weight: 0.15, note: OPS_NOTE, cites: [] },
  },
  hardware: {
    compute: {
      weight: 0.65,
      note: "Every source puts servers at 60% or more of data-center IT spend: about 60% of a 1 GW AI cluster's annual cost (Epoch AI) and about 79% of server, storage and network spend in 2024 (IoT Analytics). Accelerated servers are heading toward half of all data-center infrastructure spend by 2029 (Dell'Oro).",
      cites: [EPOCH, IOT, DELLORO_CAPEX],
    },
    storage: {
      weight: 0.15,
      note: "No source supports a quarter share: storage is about 8% of server, storage and network spend (IoT Analytics), and Epoch AI's AI-cluster model has no separate storage line. Held above that at 15% because memory is the most volatile hardware price in 2025–26.",
      cites: [IOT, EPOCH],
    },
    network: {
      weight: 0.2,
      note: "Above the traditional 10–13% because AI back-end networks are a fast-growing cost: Dell'Oro forecasts AI back-end switch spend above $100 billion by 2030, and network is about 14% of Epoch AI's 1 GW cluster cost.",
      cites: [DELLORO_NETWORK, EPOCH],
    },
  },
};

/** When each basket's weights were last checked against the sources above. */
export const DC_WEIGHT_REVIEWED: Record<DcIndexKey, string> = {
  build: "2026-07-12",
  ops: "2026-07-12",
  hardware: "2026-07-15",
};
