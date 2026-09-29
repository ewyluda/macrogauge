import { describe, expect, it } from "vitest";
import { clauseText, settle, type ClauseSeries, type ClauseTerms } from "./clause";

const S: ClauseSeries = { basket: "build", code: "switchgear", label: "PPI switchgear & switchboard", series: "ppi_switchgear",
  source_id: "WPU1175", months: ["2025-08", "2026-07", "2026-08"], latest: [400, 420.184, 430.247],
  first_print: [399, 419.25, 430.247], first_release: ["2025-09-11", "2026-08-13", "2026-09-11"] };
const T: ClauseTerms = { baseMonth: "2025-08", adjMonth: "2026-08", vintage: "latest", bandPct: 0, bandMode: "excess",
  sharePct: 100, capPct: null, floorPct: null, contractValue: 1_000_000, escalablePct: 100 };

describe("settle", () => {
  it("adjusts by the index ratio with no band/share/cap", () => {
    const r = settle(S, T);
    expect(r.ok && r.changePct).toBeCloseTo(7.56175, 4);
    expect(r.ok && r.dollars).toBeCloseTo(75617.5, 0);
  });
  it("deadband excess mode counts only the part beyond the band", () => {
    const r = settle(S, { ...T, bandPct: 5 });
    expect(r.ok && r.excessPct).toBeCloseTo(2.56175, 4);
  });
  it("deadband full mode is all-or-nothing", () => {
    expect((settle(S, { ...T, bandPct: 8, bandMode: "full" }) as { adjustedPct: number }).adjustedPct).toBe(0);
    expect((settle(S, { ...T, bandPct: 5, bandMode: "full" }) as { adjustedPct: number }).adjustedPct).toBeCloseTo(7.56175, 4);
  });
  it("applies share, escalable portion and cap", () => {
    const r = settle(S, { ...T, sharePct: 50, capPct: 3, escalablePct: 40 });
    expect(r.ok && r.adjustedPct).toBe(3);
    expect(r.ok && r.capped).toBe("cap");
    expect(r.ok && r.dollars).toBeCloseTo(12000, 6);
  });
  it("uses the first print and reports release dates", () => {
    const r = settle(S, { ...T, vintage: "first_print" });
    expect(r.ok && r.baseIndex).toBe(399);
    expect(r.ok && r.adjRelease).toBe("2026-09-11");
  });
  it("rejects bad terms and missing months", () => {
    expect(settle(S, { ...T, adjMonth: "2025-08" }).ok).toBe(false);
    expect(settle(S, { ...T, baseMonth: "2024-01" }).ok).toBe(false);
  });
});

describe("clauseText", () => {
  it("names the series, vintage, band, share and limits", () => {
    const txt = clauseText(S, { ...T, bandPct: 5, sharePct: 50, capPct: 10, floorPct: 5, vintage: "first_print", escalablePct: 40 });
    expect(txt).toContain("(WPU1175)");
    expect(txt).toContain("as first published");
    expect(txt).toContain("August 2026");
    expect(txt).toContain("portion exceeding 5%");
    expect(txt).toContain("Buyer shall bear 50%");
    expect(txt).toContain("an increase of 10% or a decrease of 5%");
  });
});
