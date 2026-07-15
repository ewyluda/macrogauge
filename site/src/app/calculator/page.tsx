import type { Metadata } from "next";
import { Section } from "@/components/Section";
import { CalculatorClient } from "@/components/CalculatorClient";

export const metadata: Metadata = {
  title: "The Since-Date Calculator",
  description: "What prices have done since any date that matters to you — lease signing, last raise, first job.",
};

export default function Calculator() {
  return (
    <div>
      <h1 style={{ fontSize: 26, fontWeight: 700, margin: "24px 0 0" }}>
        The Since-Date Calculator{" "}
        <span style={{ color: "var(--muted)", fontWeight: 400, fontSize: 16 }}>
          what inflation has done since any date — computed from the daily gauge, not
          last quarter&apos;s CPI
        </span>
      </h1>
      <div style={{ marginTop: 24 }}>
        <CalculatorClient />
      </div>
      <Section title="Methodology">
        <div style={{ fontSize: 13, color: "var(--muted)", lineHeight: 1.6 }}>
          Powered by the macrogauge daily index (market prices, Jan 2018 = 100) from
          gauge_daily.json. Official-CPI calculators can only answer in whole months,
          two months late. Annualized rate = ratio^(365/days) − 1. See{" "}
          <a href="/methodology" style={{ color: "var(--accent-sky)" }}>methodology</a>{" "}
          for sources and the gauge&apos;s public track record.
        </div>
      </Section>
    </div>
  );
}
