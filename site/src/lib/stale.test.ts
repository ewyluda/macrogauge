import { describe, expect, it } from "vitest";
import { staleness } from "./stale";

const TODAY = "2026-09-25T17:35:31Z";

describe("staleness", () => {
  it("is null when the artifact came from the same run as pulse", () => {
    expect(staleness([TODAY], TODAY)).toBeNull();
  });
  it("flags an artifact left over from an earlier publish", () => {
    expect(staleness(["2026-09-24T17:36:02Z"], TODAY)).toEqual({ shownFrom: "2026-09-24T17:36:02Z", latest: TODAY });
  });
  it("reports the OLDEST of several artifacts a page renders", () => {
    expect(staleness([TODAY, "2026-09-22T17:36:02Z", "2026-09-24T17:36:02Z"], TODAY)?.shownFrom).toBe("2026-09-22T17:36:02Z");
  });
  it("never raises a banner on a missing or unparseable stamp", () => {
    expect(staleness([undefined, null, "not a date"], TODAY)).toBeNull();
    expect(staleness(["2026-09-24T17:36:02Z"], "garbage")).toBeNull();
  });
  it("an artifact newer than pulse (engine phase failed) is not stale", () => {
    expect(staleness([TODAY], "2026-09-24T17:36:02Z")).toBeNull();
  });
});
