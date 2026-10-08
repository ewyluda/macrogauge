import { describe, expect, it } from "vitest";
import { issuerTakeaway } from "./issuerBonds";
import type { IssuerDeal } from "./types";

const d = (issuer: string, cohort: IssuerDeal["cohort"], spread: number | null, comparable = true): IssuerDeal => ({
  issuer, name: issuer, cohort, deal_date: "2026-02-03", instrument: comparable ? "senior notes" : "convertible notes",
  comparable, tranche: "x", coupon_pct: 5, maturity: "2036-02-03", years: 10, amount_usd_b: 1, yield_pct: 5,
  yield_basis: "stated", spread_bp: spread, spread_basis: spread == null ? null : "stated", benchmark: null,
  quote: "q", source: "s", source_url: "https://x",
});

describe("issuerTakeaway", () => {
  it("compares each cohort's median spread on straight notes only", () => {
    expect(issuerTakeaway([d("MSFT", "hyperscaler", 60), d("ORCL", "hyperscaler", 140), d("META", "hyperscaler", 85),
      d("CRWV", "neocloud", 512), d("NBIS", "neocloud", null, false)]))
      .toBe("On their latest notes the hyperscalers priced a median 85bp over Treasuries; CRWV 512bp.");
    // two comparable neoclouds read as a median, never one named issuer
    expect(issuerTakeaway([d("MSFT", "hyperscaler", 60), d("ORCL", "hyperscaler", 140), d("CRWV", "neocloud", 500), d("X", "neocloud", 600)]))
      .toBe("On their latest notes the hyperscalers priced a median 100bp over Treasuries; the neoclouds a median 550bp.");
  });
  it("names a lone hyperscaler with its verb", () => {
    expect(issuerTakeaway([d("MSFT", "hyperscaler", 60), d("CRWV", "neocloud", 500)]))
      .toBe("On their latest notes MSFT priced 60bp over Treasuries; CRWV 500bp.");
  });
  it("says nothing without a comparable spread in both cohorts", () => {
    expect(issuerTakeaway([d("MSFT", "hyperscaler", 60), d("NBIS", "neocloud", null, false)])).toBeNull();
  });
});
