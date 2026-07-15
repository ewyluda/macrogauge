import Link from "next/link";
import pulse from "../../public/data/pulse.json";
import qa from "../../public/data/qa.json";
import { NavBar } from "./NavBar";
import { SiteFooter } from "./SiteFooter";
import { StatusPill } from "./StatusPill";
import { fmtPct } from "@/lib/format";

export function PageShell({ children }: { children: React.ReactNode }) {
  return (
    <main className="page-shell">
      <header className="site-header">
        <div className="header-primary">
          <Link href="/" style={{ textDecoration: "none", color: "var(--text)" }}>
            <span className="wordmark">
              MACROGAUGE
            </span>
          </Link>
          <NavBar />
        </div>
        <div className="header-status">
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
          <Link href="/status" style={{ textDecoration: "none" }}>
            <StatusPill
              ok={qa.passed === qa.total}
              label={`Self-test ${qa.passed}/${qa.total}`}
            />
          </Link>
        </div>
      </header>
      {children}
      <SiteFooter />
    </main>
  );
}
