import { describe, expect, it } from "vitest";
import dc from "../../public/data/datacenter.json";
import { dcTakeaway, homeReadings, moveWords } from "./homeBrief";
import dcJson from "../../public/data/datacenter.json";
import computeJson from "../../public/data/compute.json";
import capacityJson from "../../public/data/capacity.json";
import ratesJson from "../../public/data/rates.json";
import { artifact } from "./artifact";

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

describe("homeReadings (audit F3)", () => {
  const dc = artifact("datacenter", dcJson);
  const compute = artifact("compute", computeJson);
  const capacity = artifact("capacity", capacityJson);
  const rates = artifact("rates", ratesJson);
  const by = (rs: ReturnType<typeof homeReadings>, key: string) => rs.find((r) => r.key === key)!;

  it("dates the PJM card to its own window end, not the homepage publish", () => {
    const pjm = dc.power!.hubs.find((h) => h.code === "ice_pjm_west")!;
    const shifted = { ...dc, power: { ...dc.power!, hubs: dc.power!.hubs.map((h) =>
      h.code === "ice_pjm_west" ? { ...h, asof: "2026-09-29", avg30: 85.72, avg30_yoy_pct: 61.9 } : h) } };
    expect(pjm).toBeDefined();
    expect(by(homeReadings(shifted, compute, capacity, rates), "power").context)
      .toBe("30-day avg to Sep 29, 2026 · +61.9% vs a year ago");
  });

  it("marks a stale GPU quote stale, with its date and no recent-period change", () => {
    const gpus = compute.gpus.map((g) => g.code === "vast_h100_sxm"
      ? { ...g, usd_per_gpu_hr: 2.18, as_of: "2026-09-01", chg_30d_pct: 36, stale: true } : g);
    const stale = by(homeReadings(dc, { ...compute, gpus }, capacity, rates), "gpu").context;
    expect(stale).toBe("vast.ai median · stale, as of Sep 1, 2026");
    expect(stale).not.toContain("in 30 days");
    const fresh = compute.gpus.map((g) => g.code === "vast_h100_sxm"
      ? { ...g, usd_per_gpu_hr: 2.21, as_of: "2026-10-08", chg_30d_pct: 1.5, stale: false } : g);
    expect(by(homeReadings(dc, { ...compute, gpus: fresh }, capacity, rates), "gpu").context)
      .toBe("vast.ai median · +1.5% in 30 days · Oct 8, 2026");
  });
});
