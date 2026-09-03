import type { Metadata } from "next";
import marketsJson from "../../../public/data/dc_markets.json";
import { Section } from "@/components/Section";
import { PortfolioClient } from "@/components/PortfolioClient";
import { ESCALATION_DATA } from "@/lib/escalationData";

const markets = (marketsJson as { markets: { key: string; name: string }[] }).markets.map((m) => ({ key: m.key, name: m.name }));

export const metadata: Metadata = {
  title: "Portfolio — your program's escalation exposure",
  description: "Define your projects — market, MW, base estimate, base and delivery months, carry basis — and read the program's escalation to date and at delivery off the DC Build index. Stays in your browser.",
};

export default function PortfolioPage() {
  return (
    <div>
      <h1>
        Portfolio <span className="subtitle">your program&apos;s escalation exposure, project by project</span>
      </h1>
      <p className="lede">
        Everything else on the site is market-level. You manage a program. Enter each project&apos;s base estimate and base
        month and the DC Build index escalates it to the last complete month; pick a delivery month and a carry basis and it
        carries it forward — by a realized historical regime you chose, never by a forecast — with the p10–p90 of like-length
        history as the band. Projects live in this browser and in the link; nothing is sent anywhere.
      </p>
      <PortfolioClient data={ESCALATION_DATA} markets={markets} />
      <Section title="Reading this honestly">
        <div style={{ fontSize: 13, color: "var(--muted)", lineHeight: 1.6 }}>
          The index is an input-price index ({ESCALATION_DATA.rebase}), not a turnkey $/MW quote, so the base estimate is yours and
          the output is a ratio applied to it. The carry bases are measured windows of the same index (long-run, trailing 3-year,
          current momentum) plus two hindsight-selected episodes (GFC, COVID peak) that carry no grade; the{" "}
          <a href="/dc-scoreboard">grading harness</a> shows how each rolling basis has held up on every vintage since 2018, and the
          basis with the best mean error has been the worst contingency. Every number on this page can be re-derived from{" "}
          <a href="/data">datacenter.json</a> and the calculator math in the repository.
        </div>
      </Section>
    </div>
  );
}
