import { ImageResponse } from "next/og";
import pulse from "../../public/data/pulse.json";
import dc from "../../public/data/datacenter.json";
import { fmtPct, fmtSigned } from "@/lib/format";

export const dynamic = "force-static";
export const alt = "MacroGauge — daily US inflation gauge vs official CPI";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

/** Social preview card, rendered at build from the same pulse.json the
 *  homepage KPIs read. Colours mirror globals.css tokens. */
export default function Image() {
  const tile = (label: string, value: string, color: string, ctx: string) => (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        background: "#11161C",
        border: "1px solid #232B35",
        borderRadius: 16,
        padding: "22px 28px",
        flex: 1,
      }}
    >
      <div style={{ fontSize: 18, letterSpacing: 2, color: "#8B98A5", textTransform: "uppercase" }}>{label}</div>
      <div style={{ fontSize: 72, fontWeight: 700, color, lineHeight: 1.1 }}>{value}</div>
      <div style={{ fontSize: 18, color: "#8B98A5" }}>{ctx}</div>
    </div>
  );
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          background: "#0B0F14",
          color: "#E6EDF3",
          padding: 56,
          fontFamily: "sans-serif",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div style={{ fontSize: 34, fontWeight: 800, letterSpacing: 6 }}>MACROGAUGE</div>
          <div style={{ fontSize: 20, color: "#8B98A5" }}>{`published ${pulse.published_at.slice(0, 10)}`}</div>
        </div>
        <div style={{ fontSize: 30, lineHeight: 1.3, marginTop: 28, maxWidth: 1000 }}>
          An independent daily gauge that re-prices the CPI basket from live market data — graded against every official print.
        </div>
        <div style={{ display: "flex", gap: 20, marginTop: 40 }}>
          {tile("Macrogauge · YoY", fmtPct(pulse.gauge.yoy_pct), "#38BDF8", `as of ${pulse.gauge.as_of}`)}
          {tile("Official CPI · YoY", fmtPct(pulse.official.yoy_pct), "#F59E0B", `${pulse.official.month.slice(0, 7)} print`)}
          {tile("DC Build · YoY", fmtSigned(dc.indexes.build.headline_yoy_pct), "#A78BFA", `as of ${dc.indexes.build.as_of}`)}
        </div>
      </div>
    ),
    { ...size },
  );
}
