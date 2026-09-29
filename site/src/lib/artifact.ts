import type { ArtifactTypes } from "./generated";

/** The one sanctioned JSON-import -> type seam (review 2026-09-01 B8).
 *
 *  `import x from "…/public/data/<name>.json"` infers a type from the
 *  committed SAMPLE, which a valid degraded artifact (nulled fields, empty
 *  arrays, a missing optional block) legally violates — so pages used to
 *  double-cast `x as unknown as HandType`, which checks nothing. This seam
 *  instead types the import by its schema: `ArtifactTypes[K]` is generated
 *  from `schemas/<K>.schema.json` (scripts/gen-types.mjs), the same contract
 *  the pipeline validates every artifact against before it can publish.
 *
 *  A page that needs a sharper shape than the schema states (tuple rows, a
 *  narrowed union) passes its hand-written type as `T`; the constraint
 *  `T extends ArtifactTypes[K]` makes that hand type a compile-checked
 *  REFINEMENT of the schema, so a schema change that the hand type no longer
 *  satisfies fails `next build` instead of drifting silently.
 *
 *  The cast below is the only one: it is sound exactly as far as the
 *  pipeline's inline schema validation is (a schema-invalid artifact fails
 *  the daily run and never deploys). */
export function artifact<
  K extends keyof ArtifactTypes,
  T extends ArtifactTypes[K] = ArtifactTypes[K],
>(_name: K, json: unknown): T {
  return json as T;
}
