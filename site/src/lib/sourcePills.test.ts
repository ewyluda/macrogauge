import { describe, expect, it } from "vitest";
import { obsLabel, sourcePills } from "./sourcePills";

describe("sourcePills (B14: status not by colour alone)", () => {
  const rows = [
    { name: "fred", ok: true, error: null, finished_at: "2026-09-28T12:00:00Z", latest_obs: "2026-09-26" },
    { name: "manheim", ok: false, error: "HTTP 404 — structure drift?", finished_at: "2026-09-28T12:00:01Z", latest_obs: "2026-07-15" },
    { name: "new source", ok: true, error: null, finished_at: "2026-09-28T12:00:02Z", latest_obs: null },
  ];
  const pills = sourcePills(rows);

  it("spells a failure out in the visible label", () => {
    expect(pills[0].label).toBe("fred · 2026-09-26");
    expect(pills[1].label).toBe("manheim · error · 2026-07-15");
    expect(pills[1].tone).toBe("advisory");
  });

  it("carries the error text in the description, not only a hover title", () => {
    expect(pills[1].detail).toContain("HTTP 404 — structure drift?");
    expect(pills[0].detail).toContain("fred ok");
  });

  it("mints DOM-safe unique ids and reads a never-observed source as never", () => {
    expect(pills.map((p) => p.id)).toEqual(["source-fred", "source-manheim", "source-new-source"]);
    expect(pills[2].label).toBe("new source · never");
  });
});

describe("obsLabel (polish review 2026-10-15: no future date reads as latest data)", () => {
  const at = "2026-10-15T22:07:00Z";
  it("labels a feed whose newest row is dated after the pull", () => {
    expect(obsLabel({ name: "STEO", latest_obs: "2027-12-01", finished_at: at })).toBe("forecast to 2027-12-01");
    expect(obsLabel({ name: "KALSHI_FED", latest_obs: "2026-12-09", finished_at: at })).toBe("market path to 2026-12-09");
    expect(obsLabel({ name: "ERCOT", latest_obs: "2026-10-16", finished_at: at })).toBe("day-ahead 2026-10-16");
    expect(obsLabel({ name: "SOMETHING_NEW", latest_obs: "2026-11-01", finished_at: at })).toBe("dated ahead to 2026-11-01");
  });
  it("leaves an observed date (and the pull day itself) alone", () => {
    expect(obsLabel({ name: "STEO", latest_obs: "2026-10-15", finished_at: at })).toBe("2026-10-15");
    expect(obsLabel({ name: "FRED", latest_obs: null, finished_at: at })).toBe("never");
    const [pill] = sourcePills([{ name: "STEO", ok: true, error: null, finished_at: at, latest_obs: "2027-12-01" }]);
    expect(pill.label).toBe("STEO · forecast to 2027-12-01");
    expect(pill.detail).toBe(`STEO ok · forecast to 2027-12-01 · last pull ${at}`);
  });
});
