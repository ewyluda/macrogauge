import { describe, expect, it } from "vitest";
import { checkMonth } from "./monthInput";

describe("checkMonth", () => {
  it("accepts an in-range YYYY-MM", () => {
    expect(checkMonth("2024-03", "2018-01", "2026-07")).toEqual({ ok: true, month: "2024-03" });
  });
  it("reports empty, malformed and out-of-range separately", () => {
    expect(checkMonth("", "2018-01", "2026-07")).toMatchObject({ ok: false, reason: "empty" });
    expect(checkMonth("2024-13", "2018-01", "2026-07")).toMatchObject({ ok: false, reason: "format" });
    expect(checkMonth("March 2024", "2018-01", "2026-07")).toMatchObject({ ok: false, reason: "format" });
    expect(checkMonth("2017-12", "2018-01", "2026-07")).toMatchObject({ ok: false, reason: "range" });
    expect(checkMonth("2026-08", "2018-01", "2026-07")).toMatchObject({ ok: false, reason: "range" });
  });
});
