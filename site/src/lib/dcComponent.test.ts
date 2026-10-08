import { describe, expect, it } from "vitest";
import datacenter from "../../public/data/datacenter.json";
import { annualized, ownSeries, yoySeries } from "./dcComponent";
import { artifact } from "./artifact";

describe("ownSeries", () => {
  it("cuts the forward-filled tail at the last observation month", () => {
    expect(ownSeries(["2026-07", "2026-08", "2026-09"], [1, 2, 2], "2026-08-01"))
      .toEqual({ months: ["2026-07", "2026-08"], levels: [1, 2] });
  });
  it("keeps the whole series for a live tail observed this month, or no date", () => {
    expect(ownSeries(["2026-09", "2026-10"], [1, 2], "2026-10-08").months).toHaveLength(2);
    expect(ownSeries(["2026-09", "2026-10"], [1, 2], null).months).toHaveLength(2);
  });
});

describe("yoySeries / annualized", () => {
  const s = { months: Array.from({ length: 13 }, (_, i) => `m${i}`), levels: [100, ...Array(9).fill(104), 105, 106, 110.25] };
  it("measures twelve months back", () => {
    expect(yoySeries(s)[12]).toBe(10.25);
    expect(yoySeries(s)[11]).toBeNull();
  });
  it("compounds an n-month change to a year", () => {
    expect(annualized(s, 12)).toBeCloseTo(10.25, 10);
    expect(annualized({ months: ["a"], levels: [1] }, 3)).toBeNull();
  });
});

describe("against the published index", () => {
  it("reproduces each official component's published YoY at its own last month", () => {
    const dc = artifact("datacenter", datacenter);
    for (const ix of [dc.indexes.build, dc.indexes.ops, dc.indexes.hardware]) {
      for (const c of ix.components.filter((x) => x.mode === "official" && x.yoy_pct != null)) {
        const yoy = yoySeries(ownSeries(ix.monthly.months, ix.monthly.components[c.code], c.last_obs));
        expect(yoy[yoy.length - 1], c.code).toBeCloseTo(c.yoy_pct!, 1);
      }
    }
  });
});
