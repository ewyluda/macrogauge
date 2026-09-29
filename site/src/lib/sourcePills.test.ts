import { describe, expect, it } from "vitest";
import { sourcePills } from "./sourcePills";

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
