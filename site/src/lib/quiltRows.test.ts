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

  it("bls mode fills cells from official_yoy_pct, preserving nulls", () => {
    const components: QuiltComponent[] = [
      {
        ...comp("fuel", "internal fuel", 0.03),
        ours_yoy_pct: [1.1, 2.2, 3.3],
        official_yoy_pct: [4.4, null, 6.6], // trailing/lagging print stays null
      },
    ];
    const rows = buildComponentRows(components, "bls");
    expect(rows).toEqual([{ label: "Motor Fuel", values: [4.4, null, 6.6] }]);
  });

  it("defaults to ours mode, and both modes emit the same rows over the same months", () => {
    const components: QuiltComponent[] = [
      {
        ...comp("shelter_rent", "internal shelter", 0.1),
        ours_yoy_pct: [1.0, 2.0],
        official_yoy_pct: [3.0, null],
      },
      {
        ...comp("robotaxis", "Robotaxis", 0.05),
        ours_yoy_pct: [0.5, 0.6],
        official_yoy_pct: [null, null],
      },
    ];
    const ours = buildComponentRows(components, "ours");
    const bls = buildComponentRows(components, "bls");
    // explicit "ours" is the default behavior
    expect(buildComponentRows(components)).toEqual(ours);
    // same row identity and month count in both modes — only the fill differs
    expect(bls.map((r) => r.label)).toEqual(ours.map((r) => r.label));
    expect(bls.map((r) => r.values.length)).toEqual(ours.map((r) => r.values.length));
    expect(ours.map((r) => r.values)).toEqual([
      [1.0, 2.0],
      [0.5, 0.6],
    ]);
    expect(bls.map((r) => r.values)).toEqual([
      [3.0, null],
      [null, null],
    ]);
  });
});
