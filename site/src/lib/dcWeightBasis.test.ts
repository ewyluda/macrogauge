import { describe, expect, it } from "vitest";
import dc from "../../public/data/datacenter.json";
import { DC_WEIGHT_BASIS, type DcIndexKey } from "./dcWeightBasis";

const KEYS: DcIndexKey[] = ["build", "ops", "hardware"];

describe("DC weight basis", () => {
  it("covers exactly the published groups of every index, at the published weights", () => {
    for (const k of KEYS) {
      const groups = dc.indexes[k].groups;
      expect(Object.keys(DC_WEIGHT_BASIS[k]).sort()).toEqual(groups.map((g) => g.group).sort());
      for (const g of groups) {
        // a reweight in config/dc_basket.json must come with a rewritten rationale
        expect(DC_WEIGHT_BASIS[k][g.group].weight, `${k}.${g.group}`).toBeCloseTo(g.weight, 6);
      }
    }
  });

  it("each basket's stated weights sum to 1", () => {
    for (const k of KEYS) {
      const sum = Object.values(DC_WEIGHT_BASIS[k]).reduce((s, b) => s + b.weight, 0);
      expect(sum).toBeCloseTo(1, 9);
    }
  });

  it("every citation is an https link with a label", () => {
    for (const k of KEYS) {
      for (const b of Object.values(DC_WEIGHT_BASIS[k])) {
        for (const c of b.cites) {
          expect(c.href).toMatch(/^https:\/\//);
          expect(c.label.length).toBeGreaterThan(5);
        }
      }
    }
  });
});
