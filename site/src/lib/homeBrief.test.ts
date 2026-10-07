import { describe, expect, it } from "vitest";
import dc from "../../public/data/datacenter.json";
import { dcTakeaway, moveWords } from "./homeBrief";

describe("moveWords", () => {
  it("rounds before choosing a direction", () => {
    expect(moveWords(8.46)).toBe("up 8.5%");
    expect(moveWords(-1.24)).toBe("down 1.2%");
    expect(moveWords(0.04)).toBe("flat");
    expect(moveWords(-0.04)).toBe("flat");
  });
});

describe("dcTakeaway", () => {
  const comps = [
    { label: "Construction wages", contribution_pp: 0.63 },
    { label: "Switchgear & switchboard", contribution_pp: 1.72 },
    { label: "Steel mill products", contribution_pp: 1.52 },
    { label: "Ready-mix concrete", contribution_pp: -0.2 },
    { label: "AC & refrigeration equipment", contribution_pp: null },
  ];

  it("names the two biggest drivers that moved with the headline", () => {
    expect(dcTakeaway({ build: 8.5, ops: 5.6, hardware: 32.2, comps })).toBe(
      "Data-center build input costs are up 8.5% on the year, led by switchgear & switchboard (+1.72pp) " +
        "and steel mill products (+1.52pp). IT hardware costs are up 32.2% and operating costs up 5.6%.",
    );
  });

  it("never lets a rising component lead a falling index", () => {
    const s = dcTakeaway({ build: -0.8, ops: null, hardware: null, comps })!;
    expect(s).toBe("Data-center build input costs are down 0.8% on the year, led by ready-mix concrete (−0.20pp).");
  });

  it("keeps acronyms capitalised mid-sentence", () => {
    const s = dcTakeaway({ build: 2, ops: null, hardware: null,
      comps: [{ label: "AC & refrigeration equipment", contribution_pp: 0.4 }] })!;
    expect(s).toContain("led by AC & refrigeration equipment (+0.40pp)");
  });

  it("drops the driver clause when the index is flat, and missing legs", () => {
    expect(dcTakeaway({ build: 0.02, ops: 1.1, hardware: null, comps })).toBe(
      "Data-center build input costs are flat on the year. Operating costs are up 1.1%.",
    );
    expect(dcTakeaway({ build: null, ops: 1, hardware: 1, comps })).toBeNull();
  });

  it("agrees with the published DC Build tile", () => {
    const b = dc.indexes.build;
    const s = dcTakeaway({ build: b.headline_yoy_pct, ops: dc.indexes.ops.headline_yoy_pct,
      hardware: dc.indexes.hardware.headline_yoy_pct, comps: b.components })!;
    expect(s).toContain(moveWords(b.headline_yoy_pct));
  });
});
