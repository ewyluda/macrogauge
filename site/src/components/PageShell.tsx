import Link from "next/link";
import pulse from "../../public/data/pulse.json";
import qa from "../../public/data/qa.json";
import { StatusPill } from "./StatusPill";
import { fmtPct } from "@/lib/format";

export function PageShell({ children }: { children: React.ReactNode }) {
  return (
    <main style={{ maxWidth: 1200, margin: "0 auto", padding: 24 }}>
      <header
        style={{
          display: "flex",
          flexWrap: "wrap",
          alignItems: "center",
          gap: 12,
          justifyContent: "space-between",
          paddingBottom: 16,
          borderBottom: "1px solid var(--border)",
        }}
      >
        <div style={{ display: "flex", alignItems: "baseline", gap: 18 }}>
          <Link href="/" style={{ textDecoration: "none", color: "var(--text)" }}>
            <span style={{ fontSize: 19, fontWeight: 700, letterSpacing: "0.14em" }}>
              MACROGAUGE
            </span>
          </Link>
          <nav style={{ display: "flex", gap: 14, fontSize: 13 }}>
            <Link href="/" style={{ color: "var(--muted)", textDecoration: "none" }}>
              Home
            </Link>
            <Link href="/real-wages" style={{ color: "var(--muted)", textDecoration: "none" }}>
              Real Wages
            </Link>
            <Link
              href="/methodology"
              style={{ color: "var(--muted)", textDecoration: "none" }}
            >
              Methodology
            </Link>
          </nav>
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <span
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              border: "1px solid rgba(52, 211, 153, 0.35)",
              background: "rgba(52, 211, 153, 0.1)",
              borderRadius: 999,
              padding: "3px 12px",
              fontSize: 12,
              fontWeight: 600,
              letterSpacing: "0.06em",
              color: "var(--accent-emerald)",
              whiteSpace: "nowrap",
            }}
          >
            <span
              style={{
                width: 7,
                height: 7,
                borderRadius: 999,
                background: "var(--accent-emerald)",
              }}
            />
            MACROGAUGE {fmtPct(pulse.gauge.yoy_pct)}
          </span>
          <StatusPill
            ok={qa.passed === qa.total}
            label={`Self-test ${qa.passed}/${qa.total}`}
          />
        </div>
      </header>
      {children}
    </main>
  );
}
