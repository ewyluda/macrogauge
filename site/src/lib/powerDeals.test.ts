import { describe, expect, it } from "vitest";
import { powerDealsTakeaway } from "./powerDeals";
import type { PowerDeals } from "./types";

const pd = (totals: PowerDeals["totals"]): PowerDeals =>
  ({ as_of_curated: "2026-10-08", basis: "b", mw_note: "n", totals, deals: [] });

describe("powerDealsTakeaway", () => {
  it("keeps PPAs apart from the rest of the signed MW and names what is not yet firm", () => {
    expect(powerDealsTakeaway(pd({ signed_mw: 20087, signed_ppa_mw: 9550, pending_mw: 5200, preliminary_mw: 4850, deals: 26 })))
      .toBe("20.1 GW of signed power deals stand behind these companies' data centers, but only 9.6 GW of it is " +
            "power purchase agreements; 5.2 GW more awaits regulator approval and 4.9 GW is MOUs, LOIs or options.");
  });

  it("drops empty clauses and says so when every signed MW is a PPA", () => {
    expect(powerDealsTakeaway(pd({ signed_mw: 1000, signed_ppa_mw: 1000, pending_mw: 0, preliminary_mw: 0, deals: 1 })))
      .toBe("1.0 GW of signed power deals stand behind these companies' data centers, all of it power purchase agreements.");
    expect(powerDealsTakeaway(undefined)).toBeNull();
    expect(powerDealsTakeaway(pd({ signed_mw: 0, signed_ppa_mw: 0, pending_mw: 0, preliminary_mw: 0, deals: 0 }))).toBeNull();
  });
});
