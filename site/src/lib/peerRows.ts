/** Union-year matrix for the external calibration panel on /datacenter.
 *
 *  Every peer publishes a different span of years on a different arithmetic
 *  basis, so the panel is a sparse join, not a zip: the row axis is the sorted
 *  union of every peer's years, and a peer that does not cover a year renders
 *  an em dash. A hole is NEVER back-filled or interpolated — an absent row
 *  means the publisher did not print that year, which is information.
 *
 *  The basis/scope labels below are the load-bearing part of this module. We
 *  publish an INPUT-cost index; almost every available peer publishes a BID
 *  price (what an owner pays at tender, contractor margin included) or an
 *  OUTPUT price (what a contractor receives). In a margin-compression year
 *  those diverge and neither is wrong — so the label ships in the column
 *  header, never in a footnote.
 */

export type PeerRow = {
  year: number;
  escalation_pct: number;
  build_yoy_pct: number | null;
};

export type Peer = {
  key: string;
  firm: string;
  short: string;
  publication: string;
  source: string;
  asof: string;
  scope: string;
  basis: string;
  period_basis: string;
  geography: string;
  derived: boolean;
  caveat: string;
  quote: string;
  rows: PeerRow[];
};

export type PeerMatrix = {
  /** ascending union of every peer's years */
  years: number[];
  /** cells[yearIdx][peerIdx] — null where that peer has no row for that year */
  cells: (number | null)[][];
  /** our own DC Build YoY at each year, joined by the pipeline */
  ours: (number | null)[];
};

export const BASIS_LABEL: Record<string, string> = {
  input_cost: "input cost",
  bid_price: "bid price",
  output_price: "output price",
  cost_model: "cost model",
};

export const SCOPE_LABEL: Record<string, string> = {
  dc: "data centres",
  nonres_building: "US non-res building",
  office_building: "US office buildings",
};

export const PERIOD_LABEL: Record<string, string> = {
  calendar_year: "calendar year",
  annual_average: "annual average",
  dec_over_dec: "Dec/Dec",
};

/** Fall back to the raw config value rather than blanking an unmapped code —
 *  a new enum member should read oddly, never render as an empty cell. */
export function label(map: Record<string, string>, code: string): string {
  return map[code] ?? code;
}

export function peerMatrix(peers: Peer[]): PeerMatrix {
  const years = [...new Set(peers.flatMap((p) => p.rows.map((r) => r.year)))]
    .sort((a, b) => a - b);

  const byPeer = peers.map((p) => new Map(p.rows.map((r) => [r.year, r])));

  const cells = years.map((y) =>
    byPeer.map((m) => {
      const row = m.get(y);
      return row ? row.escalation_pct : null;
    }),
  );

  // Every peer's rows carry the same build_yoy_pct for a given year (the engine
  // joins them all against one build index), but a peer missing that year
  // carries nothing — so take the first peer that actually covers it.
  const ours = years.map((y) => {
    for (const m of byPeer) {
      const row = m.get(y);
      if (row && row.build_yoy_pct != null) return row.build_yoy_pct;
    }
    return null;
  });

  return { years, cells, ours };
}
