import pulse from "../../public/data/pulse.json";
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
  const quote = (code: string) => official.quotes.find((q) => q.code === code);
  const gas = quote("eia_gasreg_w");
  const mortgage = quote("pmms_30yr");
  const gold = quote("fmp_gold");
  const debt = quote("fiscal_debt_total");
  const groups = ["grocery", "energy", "rates", "markets", "fiscal"] as const;

  return (
    <div>
      <div style={{ color: "var(--muted)", fontSize: 13, marginTop: 16 }}>
        daily US inflation &amp; macro · published {pulse.published_at} ·
        independent gauge + official data
      </div>

      <div style={{ display: "flex", gap: 16, flexWrap: "wrap", marginTop: 24 }}>
        <KpiCard
          label="Macrogauge · YoY"
          value={fmtPct(pulse.gauge.yoy_pct)}
          context={`${pulse.gauge.coverage_pct.toFixed(0)}% live weight · as of ${pulse.gauge.as_of}`}
          accent="sky"
          chip={<DeltaChip value={pulse.gap_pp} prefix="vs official" />}
        />
        <KpiCard
          label="Official CPI · YoY"
          value={fmtPct(cpi.yoy_pct)}
          context={`${fmtMonth(cpi.month)} print · prev ${fmtPct(cpi.prev_yoy_pct)} · as of ${cpi.as_of}`}
          accent="amber"
        />
        <KpiCard
          label="Core CPI · YoY"
          value={fmtPct(core.yoy_pct)}
          context={`${fmtMonth(core.month)} print · prev ${fmtPct(core.prev_yoy_pct)} · as of ${core.as_of}`}
          accent="amber"
        />
        {gas && (
          <KpiCard
            label="Gas · regular"
            value={fmtMoney(gas.latest, gas.unit)}
            context={`${fmtSigned(gas.yoy_pct)} YoY · wk of ${gas.obs_date}`}
            accent="sky"
          />
        )}
        {mortgage && (
          <KpiCard
            label="30yr mortgage"
            value={fmtMoney(mortgage.latest, mortgage.unit)}
            context={`${fmtSigned(mortgage.yoy_pct)} YoY · ${mortgage.obs_date}`}
            accent="sky"
          />
        )}
        {gold && (
          <KpiCard
            label="Gold"
            value={fmtMoney(gold.latest, gold.unit)}
            context={`${fmtSigned(gold.yoy_pct)} YoY · ${gold.obs_date}`}
            accent="violet"
          />
        )}
        {debt && (
          <KpiCard
            label="Public debt"
            value={`$${(debt.latest / 1e12).toFixed(2)}T`}
            context={`${fmtSigned(debt.yoy_pct)} YoY · ${debt.obs_date}`}
            accent="violet"
          />
        )}
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
          independent macrogauge index re-prices the CPI basket daily from live
          market and public data ({pulse.gauge.coverage_pct.toFixed(0)}% of basket
          weight today; the rest carries official BLS values forward between
          prints).
        </div>
      </Section>
    </div>
  );
}
