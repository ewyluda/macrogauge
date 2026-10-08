import { describe, expect, it } from "vitest";
import { spreadTakeaway } from "./groceryHeadline";

const short = (n: string) => n.replace(/ \(USDA\)$/, "");

describe("spreadTakeaway", () => {
  it("names the widest positive and negative spreads", () => {
    expect(spreadTakeaway([
      { name: "Shell eggs (USDA)", spread_pp: -0.45 },
      { name: "Ground beef 80-89% (USDA)", spread_pp: 19.68 },
      { name: "Sliced bacon (USDA)", spread_pp: -11.3 },
      { name: "Milk (USDA)", spread_pp: null },
    ], short)).toBe("Ground beef 80-89%'s shelf price is outrunning its wholesale price by +19.7pp a year; Sliced bacon's shelf price trails wholesale by 11.3pp.");
  });
  it("says they move together when nothing is positive or negative enough to name", () => {
    expect(spreadTakeaway([{ name: "A", spread_pp: 0 }], short)).toBe("Shelf and wholesale prices are moving within 0.0pp of each other.");
    expect(spreadTakeaway([], short)).toBeNull();
  });
});
