import { describe, expect, it } from "vitest";
import { baselineName, changesHeadline, fmtDelta, fmtReading, partitionMovers } from "./changesHeadline";
import type { Mover } from "./types";

const m = (key: string, over: Partial<Mover>): Mover => ({
  key, label: key, section: "AI Infra", kind: "level", unit: "$/MWh", notable: 3, href: "/power",
  value: 83.2, as_of: "2026-10-07", prev_value: 80, prev_as_of: "2026-10-06", delta: 4, delta_unit: "%",
  significance: 1.33, ...over,
});

describe("changesHeadline", () => {
  it("leads with the top AI-infra mover, past its notable threshold", () => {
    expect(changesHeadline([m("hub", { label: "PJM Western Hub 30-day average" })]))
      .toBe("The biggest AI-infra move since the previous publish: PJM Western Hub 30-day average rose 4.0% to $83.20/MWh.");
    expect(changesHeadline([m("ten", { label: "10-year Treasury yield", kind: "rate", unit: "%", value: 5.15, delta: -12,
      delta_unit: "bp", significance: 2.4 })]))
      .toBe("The biggest AI-infra move since the previous publish: 10-year Treasury yield fell 12bp to 5.15%.");
  });
  it("reads a hub that left a negative average as a $/MWh rise, never a % fall", () => {
    // the writer's absolute change off a nonpositive base: -$10 -> +$10
    expect(changesHeadline([m("hub", { label: "Example hub", value: 10, prev_value: -10, delta: 20, delta_unit: "$/MWh",
      notable: 2, significance: 10 })]))
      .toBe("The biggest AI-infra move since the previous publish: Example hub rose $20.00/MWh to $10.00/MWh.");
    expect(fmtReading({ kind: "level", unit: "$/MWh" }, -5)).toBe("−$5.00/MWh");
    expect(fmtDelta({ delta: -5, delta_unit: "$/MWh" })).toBe("−$5.00/MWh");
  });
  it("calls a sub-threshold day quiet, skips other sections, and says so when nothing moved", () => {
    expect(changesHeadline([m("g", { section: "Inflation", significance: 9 }), m("tok", { label: "Token price index", unit: "index",
      value: 96.6, delta: 0.3, significance: 0.3 })]))
      .toBe("A quiet day for AI infrastructure: the largest move, Token price index, was up 0.3% to 96.6, within its usual range.");
    expect(changesHeadline([m("a", { delta: 0, significance: 0 })])).toBe("No AI-infra reading changed since the previous publish.");
    expect(changesHeadline([m("a", { delta: null, prev_value: null, significance: null })])).toBeNull();
    expect(changesHeadline(undefined)).toBeNull();
  });
});

describe("formatting and partition", () => {
  it("reads each unit and delta kind", () => {
    expect(fmtReading({ kind: "level", unit: "$B" }, 242.5)).toBe("$243B");
    expect(fmtReading({ kind: "level", unit: "MW" }, 41475.5)).toBe("41,476 MW");
    expect(fmtReading({ kind: "yoy", unit: "%" }, 12.27)).toBe("+12.3%");
    expect(fmtDelta({ delta: 0.3, delta_unit: "pp" })).toBe("+0.30pp");
    expect(fmtDelta({ delta: null, delta_unit: "%" })).toBe("new");
  });
  it("splits movers from unchanged and new readings", () => {
    const { moved, unchanged } = partitionMovers([m("a", {}), m("b", { delta: 0 }), m("c", { delta: null })]);
    expect(moved.map((x) => x.key)).toEqual(["a"]);
    expect(unchanged.map((x) => x.key)).toEqual(["b", "c"]);
  });
});

describe("baselineName", () => {
  it("names the baseline from the two stamps, on US Eastern days", () => {
    // 2026-10-15 18:07 ET against 2026-10-14 19:54 ET: yesterday's last publish
    expect(baselineName("2026-10-15T22:07:26Z", "2026-10-14T23:54:12Z")).toBe("the previous day's last publish");
    // against 16:41 ET the same day (old files, or no baseline kept yet)
    expect(baselineName("2026-10-15T22:07:26Z", "2026-10-15T20:41:02Z")).toBe("the previous publish");
    // 02:30 UTC on the 15th is 22:30 ET on the 14th
    expect(baselineName("2026-10-15T12:53:47Z", "2026-10-15T02:30:00Z")).toBe("the previous day's last publish");
    expect(baselineName("2026-10-15T12:53:47Z", null)).toBeNull();
  });
});
