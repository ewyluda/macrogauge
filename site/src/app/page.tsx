import official from "../../public/data/official.json";
import qa from "../../public/data/qa.json";
import status from "../../public/data/sources_status.json";
import { KpiCard } from "@/components/KpiCard";
import { DeltaChip } from "@/components/DeltaChip";
import { StatusPill } from "@/components/StatusPill";
import { Section } from "@/components/Section";
import { fmtMonth, fmtPct, fmtSigned, fmtMoney, yoyColor } from "@/lib/format";

const GROUP_TITLES: Record<string, string> = {
  grocery: "Grocery basket",
  energy: "Energy",
  rates: "Rates",
  markets: "Markets",
  fiscal: "Fiscal",
};

function QuoteCard({ q }: { q: (typeof official.quotes)[number] }) {
  return (
    <div
      style={{
        background: "var(--card)",
        border: "1px solid var(--border)",
        borderRadius: 10,
        padding: 12,
        minWidth: 150,
        flex: "1 1 150px",
      }}
    >
      <div
        style={{
          fontSize: 11,
          letterSpacing: "0.08em",
          textTransform: "uppercase",
          color: "var(--muted)",
        }}
      >
        {q.label}
      </div>
      <div
        style={{
          fontSize: 22,
          fontWeight: 700,
          fontVariantNumeric: "tabular-nums",
          margin: "2px 0",
        }}
      >
        {fmtMoney(q.latest, q.unit)}
      </div>
      <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
        <DeltaChip value={q.yoy_pct} prefix="YoY" />
        <span style={{ fontSize: 11, color: "var(--muted)" }}>{q.obs_date}</span>
      </div>
    </div>
  );
}

export default function Home() {
  const { cpi, core } = official.headline;
  const gas = official.quotes.find((q) => q.code === "eia_gasreg_w")!;
  const mortgage = official.quotes.find((q) => q.code === "pmms_30yr")!;
  const gold = official.quotes.find((q) => q.code === "fmp_gold")!;
  const debt = official.quotes.find((q) => q.code === "fiscal_debt_total")!;
  const groups = ["grocery", "energy", "rates", "markets", "fiscal"] as const;

  return (
    <main style={{ maxWidth: 1200, margin: "0 auto", padding: 24 }}>
      <header
        style={{
          display: "flex",
          flexWrap: "wrap",
          alignItems: "baseline",
          gap: 12,
          justifyContent: "space-between",
        }}
      >
        <div>
          <h1 style={{ fontSize: 26, fontWeight: 700, margin: 0 }}>
            macrogauge{" "}
            <span style={{ color: "var(--muted)", fontWeight: 400, fontSize: 16 }}>
              daily US inflation &amp; macro
            </span>
          </h1>
          <div style={{ color: "var(--muted)", fontSize: 13, marginTop: 4 }}>
            published {official.published_at} · official data · gauge coming in phase 1b
          </div>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <StatusPill ok={true} label={`CPI ${fmtPct(cpi.yoy_pct)}`} />
          <StatusPill
            ok={qa.passed === qa.total}
            label={`Self-test ${qa.passed}/${qa.total}`}
          />
        </div>
      </header>

      <div style={{ display: "flex", gap: 16, flexWrap: "wrap", marginTop: 24 }}>
        <KpiCard
          label="Official CPI · YoY"
          value={fmtPct(cpi.yoy_pct)}
          context={`${fmtMonth(cpi.month)} print · prev ${fmtPct(cpi.prev_yoy_pct)}`}
          accent="amber"
        />
        <KpiCard
          label="Core CPI · YoY"
          value={fmtPct(core.yoy_pct)}
          context={`${fmtMonth(core.month)} print · prev ${fmtPct(core.prev_yoy_pct)}`}
          accent="amber"
        />
        <KpiCard
          label="Gas · regular"
          value={fmtMoney(gas.latest, gas.unit)}
          context={`${fmtSigned(gas.yoy_pct)} YoY · wk of ${gas.obs_date}`}
          accent="sky"
        />
        <KpiCard
          label="30yr mortgage"
          value={fmtMoney(mortgage.latest, mortgage.unit)}
          context={`${fmtSigned(mortgage.yoy_pct)} YoY · ${mortgage.obs_date}`}
          accent="sky"
        />
        <KpiCard
          label="Gold"
          value={fmtMoney(gold.latest, gold.unit)}
          context={`${fmtSigned(gold.yoy_pct)} YoY · ${gold.obs_date}`}
          accent="violet"
        />
        <KpiCard
          label="Public debt"
          value={`$${(debt.latest / 1e12).toFixed(2)}T`}
          context={`${fmtSigned(debt.yoy_pct)} YoY · ${debt.obs_date}`}
          accent="violet"
        />
      </div>

      <Section title={`Official CPI components — YoY (${fmtMonth(cpi.month)} print)`}>
        <div
          style={{
            background: "var(--card)",
            border: "1px solid var(--border)",
            borderRadius: 10,
            overflow: "hidden",
          }}
        >
          <table
            style={{
              width: "100%",
              borderCollapse: "collapse",
              fontVariantNumeric: "tabular-nums",
            }}
          >
            <thead>
              <tr>
                {["Component", "YoY", "MoM"].map((h, i) => (
                  <th
                    key={h}
                    style={{
                      textAlign: i === 0 ? "left" : "right",
                      fontSize: 11,
                      letterSpacing: "0.08em",
                      textTransform: "uppercase",
                      color: "var(--muted)",
                      fontWeight: 500,
                      padding: "10px 16px",
                      borderBottom: "1px solid var(--border)",
                    }}
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {official.components.map((c) => (
                <tr key={c.code}>
                  <td
                    style={{
                      padding: "8px 16px",
                      fontSize: 14,
                      borderBottom: "1px solid var(--border)",
                    }}
                  >
                    {c.label}
                  </td>
                  <td
                    style={{
                      padding: "8px 16px",
                      fontSize: 14,
                      fontWeight: 600,
                      textAlign: "right",
                      color: yoyColor(c.yoy_pct),
                      borderBottom: "1px solid var(--border)",
                    }}
                  >
                    {fmtSigned(c.yoy_pct)}
                  </td>
                  <td
                    style={{
                      padding: "8px 16px",
                      fontSize: 14,
                      textAlign: "right",
                      color: yoyColor(c.mom_pct),
                      borderBottom: "1px solid var(--border)",
                    }}
                  >
                    {fmtSigned(c.mom_pct)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>

      {groups.map((g) => (
        <Section key={g} title={GROUP_TITLES[g]}>
          <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
            {official.quotes
              .filter((q) => q.group === g)
              .map((q) => (
                <QuoteCard key={q.code} q={q} />
              ))}
          </div>
        </Section>
      ))}

      <Section title="Sources">
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {status.sources.map((s) => (
            <StatusPill
              key={s.name}
              ok={s.ok}
              label={`${s.name} · ${s.latest_obs ?? "never"}`}
            />
          ))}
        </div>
        <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 12 }}>
          All figures from official/public sources (BLS, FRED, EIA, Zillow, Freddie
          Mac, U.S. Treasury, FMP) — collected daily, published with as-of dates. The
          independent macrogauge index arrives in phase 1b.
        </div>
      </Section>
    </main>
  );
}
