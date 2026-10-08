import { describe, expect, it } from "vitest";
import { buildInputsHeadline } from "./buildInputs";
import type { CommodityRow } from "./types";

const r = (code: string, yoy: number | null): CommodityRow => ({
  code, label: code, unit: "", value: 1, as_of: "2026-10-07", yoy_pct: yoy, chg_30d_pct: null, spark: [],
});

describe("buildInputsHeadline", () => {
  it("names the biggest true-YoY movers, never a dated stand-in", () => {
    expect(buildInputsHeadline([r("fmp_copper", 30.4), r("ice_pjm_west", 82.67), r("caiso_sp15_da", 93.17),
      r("ppi_steel", 23.44), r("dramex_ddr5_16g", null)]))
      .toBe("CAISO power +93%, PJM power +83% and copper +30% on the year");
  });
  it("handles a fall, one mover, and none", () => {
    expect(buildInputsHeadline([r("fmp_alum", -12.2)])).toBe("Aluminum −12% on the year");
    expect(buildInputsHeadline([r("dramex_ddr5_16g", null)])).toBeNull();
  });
});
