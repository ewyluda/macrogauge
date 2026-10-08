import { describe, expect, it } from "vitest";
import { ledgerCommitsUrl, todayAtPublishes } from "./ledgerSeries";
import type { LedgerRow } from "./types";

const row = (date: string, dc_build_as_of: string | null) => ({ date, dc_build_as_of } as unknown as LedgerRow);

describe("todayAtPublishes", () => {
  it("reads today's history at each row's own reference date, else the publish date", () => {
    const rows = [row("2026-10-06", "2026-10-05"), row("2026-10-07", null), row("2026-10-08", "2026-09-01")];
    expect(todayAtPublishes(rows, "dc_build_as_of", ["2026-10-05", "2026-10-07"], [8.4, 8.5]))
      .toEqual([8.4, 8.5, null]);
  });
});

describe("ledgerCommitsUrl", () => {
  it("filters the ledger file's history to the publish day and the next", () => {
    expect(ledgerCommitsUrl("ewyluda/macrogauge", "2026-10-07T18:51:57Z")).toBe(
      "https://github.com/ewyluda/macrogauge/commits/main/store/ledger/pulse.jsonl?since=2026-10-07&until=2026-10-08");
  });
});
