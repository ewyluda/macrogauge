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
      "Over the same 30 days a megawatt-hour there cost as much as 32.8 MMBtu of Henry Hub gas, against 20.2 a year earlier — 4.4× a combined-cycle plant's fuel bill at Henry Hub prices. Power outran Henry Hub; whether local gas prices, the generation mix or grid scarcity made up the rest is not separated here.",
    );
  });

  it("names no cause when local gas alone could explain the move (PR #134 review counterexample)", () => {
    // power $60 -> $90 with Henry Hub flat at $3: local gas $8 -> $12 at a fixed
    // 7.5 heat rate explains all of it with no grid markup, so blaming the grid is wrong
    const h = gasHeadline({ latest: 3, avg30_yoy_pct: 0 }, [hub("Synthetic hub", 50, 0, 30, 20, 30 / 7.548)]);
    expect(h?.title).toBe("Synthetic hub power is up 50% on the year while Henry Hub gas is flat");
    expect(h?.detail).not.toMatch(/grid did|did not move/);
    expect(h?.detail).toMatch(/local gas prices, the generation mix or grid scarcity made up the rest is not separated here\.$/);
  });

  it("states a material Henry Hub rise that is still under half the power move", () => {
    const h = gasHeadline(spot, [hub("ERCOT North Hub", 40, 15, 12.6, 10.4, 1.7)]);
    expect(h?.title).toBe("ERCOT North Hub power is up 40% on the year while Henry Hub gas is up 15%");
    expect(h?.detail).toMatch(/^Over the same 30 days .* 12\.6 MMBtu of Henry Hub gas, against 10\.4/);
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
