import { describe, expect, it } from "vitest";
import { changesHeadline, fmtDelta, fmtReading, partitionMovers } from "./changesHeadline";
import type { Mover } from "./types";

const m = (key: string, over: Partial<Mover>): Mover => ({
  key, label: key, section: "AI Infra", kind: "level", unit: "$/MWh", notable: 3, href: "/power",
  value: 83.2, as_of: "2026-10-07", prev_value: 80, prev_as_of: "2026-10-06", delta: 4, delta_unit: "%",
  significance: 1.33, ...over,
});

describe("changesHeadline", () => {
  it("leads with the top AI-infra mover, past its notable threshold", () => {
    expect(changesHeadline([m("hub", { label: "PJM Western Hub 30-day average" })]))
      .toBe("The biggest AI-infra move since the last publish: PJM Western Hub 30-day average rose 4.0% to $83.20/MWh.");
    expect(changesHeadline([m("ten", { label: "10-year Treasury yield", kind: "rate", unit: "%", value: 5.15, delta: -12,
      delta_unit: "bp", significance: 2.4 })]))
      .toBe("The biggest AI-infra move since the last publish: 10-year Treasury yield fell 12bp to 5.15%.");
  });
  it("calls a sub-threshold day quiet, skips other sections, and says so when nothing moved", () => {
    expect(changesHeadline([m("g", { section: "Inflation", significance: 9 }), m("tok", { label: "Token price index", unit: "index",
      value: 96.6, delta: 0.3, significance: 0.3 })]))
      .toBe("A quiet day for AI infrastructure: the largest move, Token price index, was up 0.3% to 96.6, within its usual range.");
    expect(changesHeadline([m("a", { delta: 0, significance: 0 })])).toBe("No AI-infra reading changed since the last publish.");
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
