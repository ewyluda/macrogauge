import { describe, expect, it } from "vitest";
import {
  bridge,
  bridgeWindow,
  escalate,
  monthDiff,
  monthIndexAtOrBefore,
} from "./dcEscalation";

// 2 years, index 100 -> 114.49 (a plausible DC Build path)
const MONTHS = ["2024-03", "2025-03", "2026-03"];
const INDEX = [100, 106.81, 114.49];

describe("escalate", () => {
  it("escalates a base cost by the index ratio", () => {
    const r = escalate(MONTHS, INDEX, "2024-03", 9_000_000)!;
    expect(r.baseMonth).toBe("2024-03");
    expect(r.endMonth).toBe("2026-03");
    expect(r.monthsElapsed).toBe(24);
    expect(r.pct).toBeCloseTo(14.49, 2);
    expect(r.escalatedCost).toBeCloseTo(10_304_100, 0);   // 9M * 1.1449
    expect(r.deltaCost).toBeCloseTo(1_304_100, 0);
    expect(r.annualizedPct).toBeCloseTo(7.0, 1);           // 1.1449^(12/24) - 1
  });

  it("uses the nearest month at or before the base", () => {
    const r = escalate(MONTHS, INDEX, "2024-11", 100)!;
    expect(r.baseMonth).toBe("2024-03");
    expect(r.escalatedCost).toBeCloseTo(114.49, 2);
  });

  it("returns null before the series starts", () => {
    expect(escalate(MONTHS, INDEX, "2024-02", 100)).toBeNull();
  });

  it("does not divide by zero when base is the last month", () => {
    const r = escalate(MONTHS, INDEX, "2026-03", 100)!;
    expect(r.monthsElapsed).toBe(0);
    expect(r.pct).toBeCloseTo(0, 6);
    expect(r.annualizedPct).toBe(0);
  });
});

// two components, weights summing to 1 — headline is their weighted mean
const B_MONTHS = ["2024-03", "2025-03", "2026-03"];
const B_COMPONENTS = [
  { code: "steel", label: "Steel mill products", group: "materials", weight: 0.6 },
  { code: "switchgear", label: "Switchgear & switchboard", group: "electrical", weight: 0.4 },
];
const B_INDEX = {
  steel: [100, 110, 125],
  switchgear: [100, 102, 105],
};
// headline: .6*100+.4*100 = 100 -> .6*125+.4*105 = 117
const B_HEADLINE = [100, 106.8, 117];

describe("bridge", () => {
  it("contributions sum exactly to the headline escalation", () => {
    const rows = bridge(B_MONTHS, B_INDEX, B_COMPONENTS, "2024-03", 1_000_000);
    const headline = escalate(B_MONTHS, B_HEADLINE, "2024-03", 1_000_000)!;
    const summed = rows.reduce((a, r) => a + r.contributionPp, 0);
    expect(summed).toBeCloseTo(headline.pct, 6);   // 17.00
  });

  it("computes per-component escalation and cost attribution", () => {
    const rows = bridge(B_MONTHS, B_INDEX, B_COMPONENTS, "2024-03", 1_000_000);
    const steel = rows.find((r) => r.code === "steel")!;
    expect(steel.componentPct).toBeCloseTo(25, 6);           // 100 -> 125
    expect(steel.contributionPp).toBeCloseTo(15, 6);         // 100 * .6 * 25 / 100
    expect(steel.contributionCost).toBeCloseTo(150_000, 0);  // 1M * .6 * 25 / 100
  });

  it("exposes the component's own base/end index levels, distinct from the headline's", () => {
    // This is what makes the published contribution formula evaluable on screen:
    // weight (from BridgeComponent) x (componentEndIndex - componentBaseIndex) / headlineBase.
    const rows = bridge(B_MONTHS, B_INDEX, B_COMPONENTS, "2024-03", 1_000_000);
    const steel = rows.find((r) => r.code === "steel")!;
    const switchgear = rows.find((r) => r.code === "switchgear")!;
    expect(steel.componentBaseIndex).toBe(100);
    expect(steel.componentEndIndex).toBe(125);
    expect(switchgear.componentBaseIndex).toBe(100);
    expect(switchgear.componentEndIndex).toBe(105);
    // and weight * componentPct is NOT contributionPp except when every
    // component starts at 100 (which this fixture happens to do at "2024-03" —
    // the mismatch only shows up once components diverge from a common base,
    // exercised on live data rather than this synthetic fixture).
  });

  it("sorts by absolute contribution, largest first", () => {
    const rows = bridge(B_MONTHS, B_INDEX, B_COMPONENTS, "2024-03", 1_000_000);
    expect(rows.map((r) => r.code)).toEqual(["steel", "switchgear"]);
  });

  it("returns an empty array before the series starts", () => {
    expect(bridge(B_MONTHS, B_INDEX, B_COMPONENTS, "2024-02", 100)).toEqual([]);
  });
});

describe("bridgeWindow", () => {
  it("decomposes an arbitrary window, not just to the grid end", () => {
    const rows = bridgeWindow(
      B_MONTHS, B_INDEX, B_COMPONENTS, "2024-03", "2025-03", 1_000_000
    );
    const total = rows.reduce((s, r) => s + r.contributionPp, 0);
    const headlineBase = B_COMPONENTS.reduce(
      (a, c) => a + c.weight * B_INDEX[c.code as keyof typeof B_INDEX][0], 0);
    const headlineEnd = B_COMPONENTS.reduce(
      (a, c) => a + c.weight * B_INDEX[c.code as keyof typeof B_INDEX][1], 0);
    expect(total).toBeCloseTo((headlineEnd / headlineBase - 1) * 100, 10);
  });

  it("is what bridge() delegates to", () => {
    const viaBridge = bridge(B_MONTHS, B_INDEX, B_COMPONENTS, "2024-03", 1000);
    const viaWindow = bridgeWindow(
      B_MONTHS, B_INDEX, B_COMPONENTS, "2024-03",
      B_MONTHS[B_MONTHS.length - 1], 1000);
    expect(viaWindow).toEqual(viaBridge);
  });

  it("returns [] for an end month before the base", () => {
    expect(bridgeWindow(
      B_MONTHS, B_INDEX, B_COMPONENTS, "2026-03", "2024-03", 1000
    )).toEqual([]);
  });

  it("falls through to zero-contribution rows (not []) when the end month equals the base month", () => {
    // Guards a deliberate decision: DcEscalationClient.tsx calls bridge() with a
    // user-controlled base month and does not guard on rows.length. If the user
    // selects the final month, they should still see a full row set with
    // 0.00pp contributions, not an emptied table body.
    const rows = bridgeWindow(
      B_MONTHS, B_INDEX, B_COMPONENTS, "2026-03", "2026-03", 1000
    );
    expect(rows).toHaveLength(B_COMPONENTS.length);
    rows.forEach((r) => {
      expect(r.componentPct).toBeCloseTo(0, 10);
      expect(r.contributionPp).toBeCloseTo(0, 10);
      expect(r.contributionCost).toBeCloseTo(0, 10);
    });
  });
});

describe("escalate with a forward segment", () => {
  it("is unchanged when no forward is supplied", () => {
    const r = escalate(MONTHS, INDEX, "2024-03", 9_000_000)!;
    expect(r.forward).toBeNull();
    expect(r.totalCost).toBeCloseTo(r.escalatedCost, 6);
    expect(r.totalPct).toBeCloseTo(r.pct, 10);
    expect(r.totalFactor).toBeCloseTo(1 + r.pct / 100, 10);
  });

  it("compounds the forward leg from the historical end month", () => {
    const r = escalate(MONTHS, INDEX, "2024-03", 1_000_000, {
      deliveryMonth: "2028-03",
      annualizedPct: 5,
    })!;
    expect(r.forward!.fromMonth).toBe("2026-03");
    expect(r.forward!.monthsAhead).toBe(24);
    expect(r.forward!.factor).toBeCloseTo(1.1025, 6);   // 1.05^2
    expect(r.forward!.pct).toBeCloseTo(10.25, 6);
    // total = historical 1.1449 x forward 1.1025
    expect(r.totalFactor).toBeCloseTo(1.1449 * 1.1025, 6);
    expect(r.totalCost).toBeCloseTo(1_000_000 * 1.1449 * 1.1025, 2);
  });

  it("handles a negative carry rate", () => {
    const r = escalate(MONTHS, INDEX, "2024-03", 1_000_000, {
      deliveryMonth: "2027-03",
      annualizedPct: -3,
    })!;
    expect(r.forward!.factor).toBeCloseTo(0.97, 6);
    expect(r.totalFactor).toBeLessThan(1.1449);
  });

  it("ignores a delivery month at or before the historical end", () => {
    const r = escalate(MONTHS, INDEX, "2024-03", 1_000_000, {
      deliveryMonth: "2026-03",
      annualizedPct: 5,
    })!;
    expect(r.forward).toBeNull();
    expect(r.totalCost).toBeCloseTo(r.escalatedCost, 6);
  });
});

describe("month helpers are exported for dcContingency", () => {
  it("monthDiff counts whole months", () => {
    expect(monthDiff("2024-03", "2026-03")).toBe(24);
    expect(monthDiff("2026-03", "2024-03")).toBe(-24);
  });
  it("monthIndexAtOrBefore finds the nearest earlier month", () => {
    expect(monthIndexAtOrBefore(MONTHS, "2025-11")).toBe(1);
    expect(monthIndexAtOrBefore(MONTHS, "2024-02")).toBe(-1);
  });
});
