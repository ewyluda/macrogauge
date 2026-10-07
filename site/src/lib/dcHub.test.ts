import { describe, expect, it } from "vitest";
import { dcHeadline, powerSummary, surgeFromLow } from "./dcHub";
import type { PowerData } from "@/components/PowerPanel";

describe("dcHeadline", () => {
  it("leads with the biggest mover", () => {
    expect(dcHeadline([{ label: "Build", yoy: 8.51 }, { label: "Ops", yoy: 5.63 }, { label: "Hardware", yoy: 32.21 }]))
      .toBe("Hardware costs are up 32.2% on the year; build up 8.5%, ops up 5.6%");
  });
  it("skips missing readings and is null with none", () => {
    expect(dcHeadline([{ label: "Build", yoy: -1.24 }, { label: "Ops", yoy: null }])).toBe("Build costs are down 1.2% on the year");
    expect(dcHeadline([{ label: "Build", yoy: null }])).toBeNull();
  });
});

describe("surgeFromLow", () => {
  const dates = ["2024-06-01", "2025-06-01", "2025-12-01", "2026-10-01"];
  it("measures from the low inside the window to the latest value", () => {
    const s = surgeFromLow("Hardware", dates, [99, 96, 101, 132]);
    expect(s).toMatchObject({ from: "2025-06-01", to: "2026-10-01", label: "Hardware +38% since Jun 2025" });
    expect(s!.pct).toBeCloseTo(37.5, 1);
  });
  it("ignores lows before the window and trailing nulls", () => {
    const s = surgeFromLow("X", ["2020-01-01", "2026-01-01", "2026-09-01", "2026-10-01"], [50, 100, 120, null]);
    expect(s).toMatchObject({ from: "2026-01-01", to: "2026-09-01" });
  });
  it("says nothing when the move is small or the latest point is the low", () => {
    expect(surgeFromLow("X", dates, [99, 96, 101, 104])).toBeNull();
    expect(surgeFromLow("X", dates, [99, 98, 97, 90])).toBeNull();
    expect(surgeFromLow("X", [], [])).toBeNull();
  });
});

const hub = (label: string, yoy: number | null) => ({ code: label, label, latest: 50, asof: "2026-10-07", unit: "$/MWh", avg30: 50, avg30_yoy_pct: yoy });
const power = {
  tail: { active: false, smooth_days: null, hubs: [] },
  hubs: [hub("SPP North Hub", 1.9), hub("PJM Western Hub", 61.9), hub("Mid-Columbia", null)],
  henry_hub: null,
  capacity_auction: { source: "PJM", asof: "2026-07-22", rows: [] },
  capacity_markets: [
    { iso: "MISO", name: "PRA", product: "", status: "auction", note: "", source: "", source_url: "", asof: "", rows: [{ period: "2025/26", price_mw_day: 217 }] },
    { iso: "PJM", name: "BRA", product: "", status: "auction", note: "", source: "", source_url: "", asof: "",
      rows: [{ period: "2024/25", price_mw_day: 28.92 }, { period: "2028/29", price_mw_day: 325 }] },
  ],
  tariffs: [{}, {}, {}],
} as unknown as PowerData;

describe("powerSummary", () => {
  it("picks the hottest hub, PJM's latest capacity price and counts tariffs", () => {
    const s = powerSummary(power);
    expect(s.hub?.label).toBe("PJM Western Hub");
    expect(s.capacity).toEqual({ iso: "PJM", period: "2028/29", price: 325, first: "2024/25", firstPrice: 28.92 });
    expect(s.tariffs).toBe(3);
    expect(s.headline).toBe("Wholesale power at PJM Western Hub is up 61.9% on the year; PJM capacity costs 11× what it did for 2024/25");
  });
  it("is empty without power data", () => {
    expect(powerSummary(null)).toEqual({ hub: null, capacity: null, tariffs: 0, headline: null });
  });
});
