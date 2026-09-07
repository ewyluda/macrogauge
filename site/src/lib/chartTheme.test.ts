import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { C } from "./chartTheme";

describe("shared research palette", () => {
  it("keeps canvas chart colors aligned with CSS tokens", () => {
    const css = readFileSync(new URL("../app/globals.css", import.meta.url), "utf8");
    for (const [key, value] of Object.entries(C)) {
      if (key === "col") continue; // chart-only comparison color
      const token = ["bg", "card", "border", "text", "muted"].includes(key) ? key : `accent-${key}`;
      expect(css.match(new RegExp(`--${token}:\\s*(#[0-9A-Fa-f]+)`))?.[1]).toBe(value);
    }
  });

  it("keeps normal text and semantic accents readable on white cards", () => {
    const luminance = (hex: string) => {
      const rgb = hex.match(/[a-f0-9]{2}/gi)!.map((v) => parseInt(v, 16) / 255)
        .map((v) => v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
      return rgb[0] * 0.2126 + rgb[1] * 0.7152 + rgb[2] * 0.0722;
    };
    for (const color of [C.text, C.muted, C.sky, C.red, C.emerald, C.amber, C.violet]) {
      expect((1.05) / (luminance(color) + 0.05)).toBeGreaterThanOrEqual(4.5);
    }
  });
});
