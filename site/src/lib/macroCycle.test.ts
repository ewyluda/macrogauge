import { describe, expect, it } from "vitest";
import recession from "../../public/data/recession.json";
import { distanceToTrigger, macroCycleSentence, ROOM_SCALE, type RecessionSignal } from "./macroCycle";

const sig = (over: Partial<RecessionSignal>): RecessionSignal => ({
  name: "x", code: "T10Y3M", rule: "< 0", value: 1.06, triggered: false, op: "<", threshold: 0, ...over,
});

describe("distanceToTrigger", () => {
  it("measures room in the rule's own direction and units", () => {
    expect(distanceToTrigger(sig({}))).toEqual({ room: 1.06, share: 1.06 / 1.5, label: "1.06pp to trigger" });
    const sahm = distanceToTrigger(sig({ code: "SAHMREALTIME", op: ">=", threshold: 0.5, value: 0.1 }))!;
    expect(sahm.room).toBeCloseTo(0.4);
    expect(sahm.label).toBe("0.40pp to trigger");
    const past = distanceToTrigger(sig({ value: -0.3, triggered: true }))!;
    expect([past.share, past.label]).toEqual([0, "triggered, 0.30pp past"]);
    expect(distanceToTrigger(sig({ value: null }))).toBeNull();
    expect(distanceToTrigger(sig({ op: undefined, threshold: undefined }))).toBeNull();   // older file
  });
  it("has a design scale for every published rule", () => {
    for (const s of recession.signals) expect(ROOM_SCALE[s.code], s.code).toBeDefined();
  });
});

describe("macroCycleSentence", () => {
  it("joins what each composite says, and drops what is missing", () => {
    expect(macroCycleSentence(-9.1, 61, 0, 6))
      .toBe("The economy is cooling (heat −9), consumer stress is elevated (61 of 100), and none of 6 recession rules has triggered.");
    expect(macroCycleSentence(30, null, 2, 6)).toBe("The economy is running hot (heat +30), and 2 of 6 recession rules have triggered.");
    expect(macroCycleSentence(null, null, 0, 0)).toBeNull();
  });
});
