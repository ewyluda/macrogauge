import { describe, expect, it } from "vitest";
import grocery from "../../public/data/grocery_basket.json";
import geo from "../../public/data/geo.json";
import metros from "../../public/data/metros.json";
import { grocerySlug, metroSlug, slugify, stateSlug, uniqueSlugs } from "./longtail";

describe("long-tail slugs", () => {
  it("slugifies punctuation, accents and ampersands", () => {
    expect(slugify("Bacon, sliced")).toBe("bacon-sliced");
    expect(slugify("St. Louis, MO-IL")).toBe("st-louis-mo-il");
    expect(slugify("Bread & butter")).toBe("bread-and-butter");
    expect(slugify("Café")).toBe("cafe");
  });
  it("gives every published grocery item, state and metro a unique slug", () => {
    expect(uniqueSlugs(grocery.items, (i) => grocerySlug(i.name)).size).toBe(grocery.items.length);
    expect(uniqueSlugs(geo.states, (s) => stateSlug(s.state)).size).toBe(geo.states.length);
    expect(uniqueSlugs(metros.metros, (m) => metroSlug(m.name)).size).toBe(metros.metros.length);
  });
  it("rejects collisions", () => {
    expect(() => uniqueSlugs(["A b", "a-b"], slugify)).toThrow(/collision/);
  });
});
