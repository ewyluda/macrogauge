import { describe, expect, it } from "vitest";
import { accelerationStroke } from "./metroTrail";

describe("accelerationStroke (the /housing metro trail)", () => {
  it("colours by whether rent growth sped up, not by its sign", () => {
    expect(accelerationStroke([6, 4, 2, 1])).toBe("var(--accent-emerald)");   // still positive, but cooling
    expect(accelerationStroke([1, 2, 3.5])).toBe("var(--accent-red)");
    expect(accelerationStroke([2, 2.1, null, 2.2])).toBe("var(--muted)");      // within ±0.25pp
    expect(accelerationStroke([null, 3])).toBe("var(--muted)");
  });
});
