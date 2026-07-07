import pulse from "../../public/data/pulse_lite.json";
import qa from "../../public/data/qa.json";
import { KpiCard } from "@/components/KpiCard";
import { fmtMonth, fmtPct } from "@/lib/format";

export default function Home() {
  const cpi = pulse.official_cpi;
  return (
    <main style={{ maxWidth: 1200, margin: "0 auto", padding: 24 }}>
      <h1 style={{ fontSize: 26, fontWeight: 700, marginBottom: 4 }}>
        macrogauge{" "}
        <span style={{ color: "var(--muted)", fontWeight: 400, fontSize: 16 }}>
          daily US inflation &amp; macro — phase 0 skeleton
        </span>
      </h1>
      <div style={{ color: "var(--muted)", fontSize: 13, marginBottom: 24 }}>
        published {pulse.published_at} · SELF-TEST {qa.passed}/{qa.total}{" "}
        {qa.passed === qa.total ? "✓" : "✗"}
      </div>
      <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
        <KpiCard
          label="Official CPI · YoY"
          value={fmtPct(cpi.yoy_pct)}
          context={`${fmtMonth(cpi.month)} print · prev ${fmtPct(cpi.prev_yoy_pct)} · as of ${cpi.as_of}`}
          accent="amber"
        />
      </div>
    </main>
  );
}
