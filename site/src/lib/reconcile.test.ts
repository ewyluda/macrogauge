import { describe, expect, it } from "vitest";
import pulse from "../../public/data/pulse.json";
import gaptable from "../../public/data/gaptable.json";
import methodology from "../../public/data/methodology.json";
import official from "../../public/data/official.json";
import { reconcile, variantGap, VARIANT_REF } from "./reconcile";

describe("reconcile (official -> reconstruction -> ours)", () => {
  it("splits the headline gap into decomposition error + component gaps", () => {
    const r = reconcile({
      official: { yoy_pct: 3.4, month: "2026-08-01" },
      reconstruction: { weighted_bls_yoy_pct: 3.34, official_yoy_pct: 3.4 },
      componentGapPp: -0.19,
      gauge: { yoy_pct: 3.15, as_of: "2026-09-28" },
      headlineGapPp: -0.24,
    });
    expect(r.decompositionErrorPp).toBe(-0.06);
    expect(r.headlineGapPp).toBe(-0.24);
    expect(r.roundingPp).toBe(0.01);
    expect(r.stale).toBe(false);
  });

  it("flags a reconstruction graded against a different print", () => {
    const r = reconcile({
      official: { yoy_pct: 3.5, month: "2026-09-01" },
      reconstruction: { weighted_bls_yoy_pct: 3.34, official_yoy_pct: 3.4 },
      componentGapPp: 0,
      gauge: { yoy_pct: 3.34, as_of: "2026-10-14" },
      headlineGapPp: -0.16,
    });
    expect(r.stale).toBe(true);
  });

  it("closes on the committed artifacts to within 2dp rounding", () => {
    // gauge = Σw·ours, reconstruction = Σw·bls, total gap = Σw·(ours − bls):
    // an identity, so only the per-figure 2dp rounding can separate the legs
    const r = reconcile({
      official: pulse.official,
      reconstruction: methodology.validation.bls_reconstruction,
      componentGapPp: gaptable.total_gap_pp,
      gauge: pulse.gauge,
      headlineGapPp: pulse.gap_pp,
    });
    expect(Math.abs(r.roundingPp)).toBeLessThanOrEqual(0.03);
  });
});

describe("variantGap on /gap", () => {
  it("grades supercore against services less rent of shelter and pce against PCEPI", () => {
    expect(VARIANT_REF.supercore).toBe("services");
    expect(VARIANT_REF.pce).toBe("pce");
    expect(variantGap(2.61, { yoy_pct: 2.45 })).toBe(0.16);
    expect(variantGap(3.18, { yoy_pct: 3.7 })).toBe(-0.52);
    expect(variantGap(null, { yoy_pct: 3.7 })).toBeNull();
    expect(variantGap(3.18, undefined)).toBeNull();
  });

  it("has a reference print for every published variant", () => {
    for (const key of Object.keys(gaptable.variants)) expect(VARIANT_REF[key]).toBeDefined();
    for (const ref of new Set(Object.values(VARIANT_REF))) {
      if (ref === "services") continue; // from compare.json (core CPI fallback), not official.headline
      expect(official.headline[ref]).toHaveProperty("yoy_pct");
    }
  });
});
