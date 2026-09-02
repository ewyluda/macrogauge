import Link from "next/link";
import pulse from "../../public/data/pulse.json";
import qa from "../../public/data/qa.json";
import datacenter from "../../public/data/datacenter.json";
import { NavBar } from "./NavBar";
import { SiteFooter } from "./SiteFooter";
import { StatusPill } from "./StatusPill";
import { fmtPct, fmtSigned } from "@/lib/format";

export function PageShell({ children }: { children: React.ReactNode }) {
  const failedChecks = qa.checks.filter((check) => !check.pass);
  const criticalFailures = failedChecks.filter((check) => check.critical).length;
  const advisoryFailures = failedChecks.length - criticalFailures;
  const selfTestTone = criticalFailures > 0
    ? "critical"
    : advisoryFailures > 0
      ? "advisory"
      : "ok";
  const selfTestLabel = criticalFailures > 0
    ? `${criticalFailures} critical`
    : advisoryFailures > 0
      ? `${advisoryFailures} advisor${advisoryFailures === 1 ? "y" : "ies"}`
      : `Self-test ${qa.passed}/${qa.total}`;

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
          <span className="header-metric-pill gauge-pill metric-pill-emerald">
            <span className="metric-pill-dot" />
            MACROGAUGE {fmtPct(pulse.gauge.yoy_pct)}
          </span>
          <span className="header-metric-pill dc-pill metric-pill-sky">
            <span className="metric-pill-dot" />
            DC BUILD {fmtSigned(datacenter.indexes.build.headline_yoy_pct)}
          </span>
          <Link href="/status" style={{ textDecoration: "none" }}>
            <StatusPill
              ok={qa.passed === qa.total}
              tone={selfTestTone}
              label={selfTestLabel}
            />
          </Link>
        </div>
      </header>
      {children}
      <SiteFooter />
    </main>
  );
}
