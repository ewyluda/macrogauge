/** Homepage reconciliation strip (review 2026-09-26 backlog #7):
 *
 *    official CPI print
 *      + decomposition error   (our 14-component reconstruction of the BLS
 *                               basket − the official all-items print: the
 *                               cost of re-pricing BLS's ~200 strata as 14)
 *    = 14-component reconstruction (Σ weight × BLS component YoY)
 *      + component gaps        (Σ weight × (ours − BLS), gaptable total)
 *    = macrogauge               (Σ weight × our component YoY)
 *
 *  Every input is a published number (pulse, methodology
 *  validation.bls_reconstruction, gaptable); nothing here re-derives a level.
 *  Each published figure is rounded to 2dp, so the two legs can miss the
 *  headline by a rounding residual — surfaced, never absorbed. */

export type ReconcileInput = {
  official: { yoy_pct: number; month: string };
  reconstruction: { weighted_bls_yoy_pct: number; official_yoy_pct: number };
  componentGapPp: number;
  gauge: { yoy_pct: number; as_of: string };
  /** pulse.gap_pp — the published headline gap (from unrounded levels), so
   *  the strip agrees with the headline tile's chip to the hundredth */
  headlineGapPp: number;
};

export type Reconciliation = {
  officialPct: number;
  decompositionErrorPp: number;
  reconstructionPct: number;
  componentGapPp: number;
  gaugePct: number;
  /** published gauge − official */
  headlineGapPp: number;
  /** headlineGap − (decompositionError + componentGap): 2dp rounding only */
  roundingPp: number;
  /** the reconstruction was graded against a different print than the tile */
  stale: boolean;
};

const r2 = (x: number) => Math.round(x * 100) / 100;

export function reconcile(x: ReconcileInput): Reconciliation {
  const decompositionErrorPp = r2(x.reconstruction.weighted_bls_yoy_pct - x.official.yoy_pct);
  const headlineGapPp = x.headlineGapPp;
  return {
    officialPct: x.official.yoy_pct,
    decompositionErrorPp,
    reconstructionPct: x.reconstruction.weighted_bls_yoy_pct,
    componentGapPp: x.componentGapPp,
    gaugePct: x.gauge.yoy_pct,
    headlineGapPp,
    roundingPp: r2(headlineGapPp - decompositionErrorPp - x.componentGapPp),
    stale: r2(x.reconstruction.official_yoy_pct) !== r2(x.official.yoy_pct),
  };
}

/** Reference print for each gauge variant's gap on /gap. */
export type VariantRef = "cpi" | "core" | "pce";
export const VARIANT_REF: Record<string, VariantRef> = {
  gauge: "cpi",
  tracker: "cpi",
  col: "cpi",
  supercore: "core",
  pce: "pce",
};

/** A variant's gap vs its own reference print, null when either side is
 *  missing. 2dp, like every other published gap. */
export function variantGap(yoy: number | null, ref: { yoy_pct: number | null } | undefined): number | null {
  if (yoy == null || ref?.yoy_pct == null) return null;
  return r2(yoy - ref.yoy_pct);
}
