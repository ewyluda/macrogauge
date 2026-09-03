import { describe, expect, it } from "vitest";
import { COMPONENTS, COMPONENT_BY_OFFICIAL, componentHref, splicePosition } from "./components";

describe("components", () => {
  it("loads the 14-component basket with weights summing to one", () => {
    expect(COMPONENTS).toHaveLength(14);
    expect(COMPONENTS.reduce((s, c) => s + c.weight, 0)).toBeCloseTo(1, 9);
    expect(COMPONENT_BY_OFFICIAL["CUUR0000SETB01"]).toBe("fuel");
    expect(componentHref("fuel")).toBe("/components/fuel");
  });
  it("finds the splice point as the first divergence from the official index", () => {
    expect(splicePosition([100, 100, 100.2, 101], [100, 100, 100, 100])).toBe(2);
    expect(splicePosition([100, 100], [100, 100])).toBeNull();
    expect(splicePosition([null, 100.5], [100, 100])).toBe(1);
  });
});
