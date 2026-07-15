import { describe, expect, it } from "vitest";
import { cardLabel, cleanName } from "./groceryLabels";

describe("cleanName", () => {
  it("strips the Avg price prefix and pops a known unit token", () => {
    expect(cleanName("Avg price: bacon, sliced, lb")).toEqual({
      title: "Bacon, sliced",
      unit: "lb",
    });
  });

  it("capitalizes the first letter only", () => {
    expect(cleanName("eggs, grade A, dozen").title).toBe("Eggs, grade A");
  });

  it("maps display units (12oz → 12 oz)", () => {
    expect(cleanName("coffee, ground roast, 12oz").unit).toBe("12 oz");
  });

  it("keeps unknown trailing tokens in the title instead of dropping them", () => {
    const { title, unit } = cleanName("ham, boneless, 16 oz");
    expect(unit).toBeNull();
    expect(title).toBe("Ham, boneless, 16 oz");
  });

  it("handles single-part names without a unit", () => {
    expect(cleanName("electricity")).toEqual({
      title: "Electricity",
      unit: null,
    });
  });

  it("never treats a lone unit-like name as a unit", () => {
    // parts.length > 1 guard: "lb" alone is a (weird) title, not a unit
    expect(cleanName("lb")).toEqual({ title: "Lb", unit: null });
  });
});

describe("cardLabel", () => {
  it("joins title and unit with · per", () => {
    expect(cardLabel("Avg price: milk, whole, gallon")).toBe(
      "Milk, whole · per gallon",
    );
  });

  it("returns the bare title when no unit token is present", () => {
    expect(cardLabel("bananas")).toBe("Bananas");
  });

  it("handles utility units", () => {
    expect(cardLabel("electricity, kWh")).toBe("Electricity · per kWh");
    expect(cardLabel("utility gas, therm")).toBe("Utility gas · per therm");
  });
});
