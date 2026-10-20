import { describe, expect, it } from "vitest";
import { gasHeadline } from "./gasHeadline";

const hub = (label: string, p: number | null, g: number | null, ratio = 32.8, prior = 20.2, cc = 4.4) =>
  ({ label, power_yoy_pct: p, gas_yoy_pct: g, ratio, ratio_year_ago: prior, vs_cc_fuel: cc });
const spot = { latest: 3.22, avg30_yoy_pct: -0.7 };

describe("gasHeadline", () => {
  it("leads with the hub whose power outran gas", () => {
    const h = gasHeadline(spot, [hub("MISO Indiana Hub", 23.2, 1.6), hub("PJM Western Hub", 59.9, -1.7)]);
    expect(h?.title).toBe("PJM Western Hub power is up 60% on the year while Henry Hub gas is down 1.7%");
    expect(h?.detail).toBe(
      "Over the same 30 days a megawatt-hour there cost as much as 32.8 MMBtu of gas, against 20.2 a year earlier — 4.4× a combined-cycle plant's fuel bill. The fuel did not move the price; the grid did.",
    );
  });

  it("falls back to Henry Hub when gas explains the move", () => {
    const h = gasHeadline(spot, [hub("ERCOT North Hub", 30, 20)]);
    expect(h).toEqual({ title: "Henry Hub gas is $3.22/MMBtu, its 30-day average flat on the year", detail: null });
  });

  it("falls back when no hub rose 10% or none has both changes", () => {
    expect(gasHeadline(spot, [hub("SPP North Hub", 8, -5)])?.title).toMatch(/^Henry Hub gas is \$3\.22/);
    expect(gasHeadline(spot, [hub("SPP North Hub", null, -5)])?.title).toMatch(/^Henry Hub/);
    expect(gasHeadline({ latest: 3.5, avg30_yoy_pct: null }, null)?.title).toBe("Henry Hub gas is $3.50/MMBtu");
  });

  it("is null without a Henry Hub reading", () => {
    expect(gasHeadline(null, [hub("PJM Western Hub", 59.9, -1.7)])).toBeNull();
  });
});
