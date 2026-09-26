import { describe, expect, it } from "vitest";
import { contrast, EMPTY_CELL, heatColor, luminance, ramp, TEXT_DARK, TEXT_LIGHT, textOn } from "./heat";

describe("luminance / contrast", () => {
  it("matches the WCAG reference points", () => {
    expect(luminance("#FFFFFF")).toBeCloseTo(1, 6);
    expect(luminance("#000")).toBe(0);
    expect(luminance("rgb(255,255,255)")).toBeCloseTo(1, 6);
    expect(contrast("#FFFFFF", "#000000")).toBeCloseTo(21, 6);
    expect(contrast("#777777", "#777777")).toBeCloseTo(1, 6);
  });
});

describe("textOn", () => {
  it("puts dark ink on the amber stretch where white fails AA", () => {
    const amber = heatColor(3); // ≈3% YoY on the −2…6 ramp
    expect(contrast(amber, TEXT_LIGHT)).toBeLessThan(4.5);
    expect(textOn(amber)).toBe(TEXT_DARK);
    expect(contrast(amber, TEXT_DARK)).toBeGreaterThan(4.5);
  });
  it("keeps white on the slate, blue and red ends and the empty cell", () => {
    for (const c of [heatColor(0), heatColor(-2), heatColor(6), EMPTY_CELL]) expect(textOn(c)).toBe(TEXT_LIGHT);
  });
  it("always picks the higher-contrast option across the whole ramp", () => {
    for (let k = 0; k <= 100; k++) {
      const bg = ramp(k / 100);
      const chosen = textOn(bg);
      const other = chosen === TEXT_DARK ? TEXT_LIGHT : TEXT_DARK;
      expect(contrast(bg, chosen)).toBeGreaterThanOrEqual(contrast(bg, other));
      // with the better choice the ramp never drops below 4:1 anywhere
      expect(contrast(bg, chosen)).toBeGreaterThan(4);
    }
  });
});
