import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ForecasterDots, ensembleLabel } from "./ForecasterDots";
import type { Forecaster } from "@/lib/types";

const calls = [{ name: "Macrogauge", value: 0.1 }, { name: "Cleveland", value: 0.4 }] as Forecaster[];
const render = (ensemble: number, weights: Record<string, number>) =>
  renderToStaticMarkup(createElement(ForecasterDots, { rows: [{ label: "CPI", ensemble, weights, forecasters: calls }] }));

describe("ForecasterDots legend", () => {
  it("says equal-weight only when the ensemble's weights are equal", () => {
    expect(render(0.25, { macrogauge: 0.5, cleveland: 0.5 })).toContain("equal-weight ensemble");
    // earned inverse-MAE weights: 0.8 × 0.10 + 0.2 × 0.40 = 0.16, not the 0.25 an equal weight implies
    const weighted = render(0.16, { macrogauge: 0.8, cleveland: 0.2 });
    expect(weighted).not.toContain("equal-weight");
    expect(weighted).toContain("ensemble, weighted by past accuracy");
  });
  it("reads three-way thirds as equal and any weighted row as weighted", () => {
    expect(ensembleLabel([{ a: 0.3333, b: 0.3333, c: 0.3333 }])).toBe("equal-weight ensemble");
    expect(ensembleLabel([{ a: 0.5, b: 0.5 }, { a: 0.7, b: 0.3 }])).toBe("ensemble, weighted by past accuracy");
  });
});
