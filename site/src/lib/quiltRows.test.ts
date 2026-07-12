import { describe, expect, it } from "vitest";
import { buildComponentRows, COMPONENT_ROWS } from "./quiltRows";
import type { QuiltComponent } from "./quiltRows";

const comp = (code: string, label: string, weight: number): QuiltComponent => ({
  code,
  label,
  weight,
  ours_yoy_pct: [1.0],
  official_yoy_pct: [1.0],
});

describe("buildComponentRows", () => {
  it("renders pinned components in presentation order with display labels", () => {
    const components = COMPONENT_ROWS.map(([code], i) =>
      comp(code, `internal ${code}`, 1 - i * 0.01),
    ).reverse(); // artifact order must not matter
    const rows = buildComponentRows(components);
    expect(rows.map((r) => r.label)).toEqual(COMPONENT_ROWS.map(([, label]) => label));
  });

  it("appends unpinned components by weight instead of silently dropping them", () => {
    const rows = buildComponentRows([
      comp("shelter_rent", "internal shelter", 0.1),
      comp("datacenter", "Data Center", 0.02),
      comp("robotaxis", "Robotaxis", 0.05),
    ]);
    // pinned first under its display label, then extras by weight desc under
    // their artifact labels — nothing vanishes
    expect(rows.map((r) => r.label)).toEqual([
      "Shelter: Rent",
      "Robotaxis",
      "Data Center",
    ]);
  });
});
