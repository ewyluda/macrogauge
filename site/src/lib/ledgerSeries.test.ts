import { describe, expect, it } from "vitest";
import { rowVerify, todayAtPublishes } from "./ledgerSeries";
import ledgerJson from "../../public/data/ledger.json";
import provenance from "../../../config/ledger_provenance.json";
import type { LedgerRow } from "./types";

const row = (date: string, dc_build_as_of: string | null) => ({ date, dc_build_as_of } as unknown as LedgerRow);

describe("todayAtPublishes", () => {
  it("reads today's history at each row's own reference date, else the publish date", () => {
    const rows = [row("2026-10-06", "2026-10-05"), row("2026-10-07", null), row("2026-10-08", "2026-09-01")];
    expect(todayAtPublishes(rows, "dc_build_as_of", ["2026-10-05", "2026-10-07"], [8.4, 8.5]))
      .toEqual([8.4, 8.5, null]);
  });
});

describe("rowVerify", () => {
  const repo = "ewyluda/macrogauge";

  it("links a backfilled row to the commit that published its reading, not the later append", () => {
    // published 2026-08-12, appended to the ledger 2026-09-03 in 1471b1f;
    // 71a428c is the daily publish whose pulse.json carries this reading
    expect(rowVerify(repo, "2026-08-12T15:43:29Z", provenance)).toEqual({
      href: "https://github.com/ewyluda/macrogauge/commit/71a428c5bcc4064ad93023af5c73b7a72fa08388",
      label: "Verify: the commit that published this reading", backfilled: true });
  });

  it("filters a live row to a window holding the commit that appended it", () => {
    // appended by 7936a6a at 2026-10-07T18:52:03Z, six seconds after publish
    const v = rowVerify(repo, "2026-10-07T18:51:57Z", provenance);
    expect(v.backfilled).toBe(false);
    const q = new URL(v.href).searchParams;
    expect(new URL(v.href).pathname).toBe("/ewyluda/macrogauge/commits/main/store/ledger/pulse.jsonl");
    expect(q.get("since")! <= "2026-10-07" && "2026-10-07" < q.get("until")!).toBe(true);
  });

  it("names a source commit for every row published before the ledger existed, and only those", () => {
    for (const r of ledgerJson.rows) {
      expect(r.published_at in provenance.sources).toBe(r.published_at < provenance.appended_at);
    }
  });
});
