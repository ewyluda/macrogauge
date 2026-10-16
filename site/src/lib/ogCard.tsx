import { ImageResponse } from "next/og";
import { fmtMonth } from "./format";

/** Shared 1200×630 social card, rendered at build time (static export), in the
 *  site's light theme: colours mirror the globals.css tokens. satori rule: a div
 *  whose children mix text and {expressions} is rejected — pass every text as
 *  one string. */
export const OG_SIZE = { width: 1200, height: 630 };

export type OgTile = { label: string; value: string; color: string; ctx: string };
/** The page's own series under the tiles: `label` names it, `range` dates it;
 *  gaps (null) are dropped. */
export type OgSpark = { values: (number | null)[]; label: string; range: string; color?: string };

const T = { bg: "#F6F7F9", card: "#FFFFFF", border: "#DEE3E9", text: "#17212B", muted: "#526170" };
export const C = { sky: "#2763C4", amber: "#9A6210", violet: "#7356A8", emerald: "#147A63", red: "#BB4545" };

/** "Oct 2021 – Oct 2026" from two YYYY-MM[-DD] dates */
export const monthSpan = (from: string, to: string) => `${fmtMonth(from)} – ${fmtMonth(to)}`;

const SPARK_W = 760;
const SPARK_H = 84;

/** polyline points for a series, at most ~160 of them (the last one kept) */
export function sparkPoints(values: number[], w = SPARK_W, h = SPARK_H, pad = 6): string {
  const step = Math.max(1, Math.ceil(values.length / 160));
  const vs = values.filter((_, i) => i % step === 0 || i === values.length - 1);
  const lo = Math.min(...vs);
  const hi = Math.max(...vs);
  const span = hi - lo || 1;
  return vs
    .map((v, i) => `${(pad + (i / Math.max(1, vs.length - 1)) * (w - 2 * pad)).toFixed(1)},${(pad + (1 - (v - lo) / span) * (h - 2 * pad)).toFixed(1)}`)
    .join(" ");
}

/** a long tile value (a market name, a dollar figure) steps down so it fits a third of the card */
const valueSize = (v: string) => (v.length <= 8 ? 56 : v.length <= 12 ? 44 : 34);

export function ogCard({ kicker, headline, tiles, stamp, spark, takeaway }: {
  kicker: string; headline: string; tiles: OgTile[]; stamp: string;
  /** the band under the tiles: a sparkline, else a one-line takeaway */
  spark?: OgSpark | null; takeaway?: string | null;
}): ImageResponse {
  const values = spark?.values.filter((v): v is number => v != null) ?? [];
  const points = values.length > 1 ? sparkPoints(values) : null;
  const end = points?.split(" ").at(-1)?.split(",").map(Number);
  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column",
        background: T.bg, color: T.text, padding: "48px 56px", fontFamily: "sans-serif" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
            <svg width="29" height="29" viewBox="0 0 18 18">
              <rect x="0" y="10" width="4" height="8" fill={C.sky} />
              <rect x="7" y="5" width="4" height="13" fill={C.sky} />
              <rect x="14" y="0" width="4" height="18" fill={C.sky} />
            </svg>
            <div style={{ fontSize: 30, fontWeight: 800, letterSpacing: 5 }}>MACROGAUGE</div>
          </div>
          <div style={{ fontSize: 20, color: T.muted }}>{stamp}</div>
        </div>
        <div style={{ fontSize: 20, fontWeight: 700, letterSpacing: 3, color: C.sky, marginTop: 30 }}>{kicker}</div>
        <div style={{ fontSize: headline.length > 110 ? 30 : 36, fontWeight: 600, lineHeight: 1.25, letterSpacing: -0.5,
          marginTop: 10, maxWidth: 1088 }}>{headline}</div>
        <div style={{ display: "flex", gap: 18, marginTop: 26 }}>
          {tiles.map((t) => (
            <div key={t.label} style={{ display: "flex", flexDirection: "column", background: T.card,
              border: `1px solid ${T.border}`, borderRadius: 14, padding: "18px 24px", flex: 1 }}>
              <div style={{ fontSize: 17, letterSpacing: 1.5, color: T.muted, textTransform: "uppercase" }}>{t.label}</div>
              <div style={{ fontSize: valueSize(t.value), fontWeight: 700, color: t.color, lineHeight: 1.1, marginTop: 6 }}>{t.value}</div>
              <div style={{ fontSize: 17, color: T.muted, marginTop: 4 }}>{t.ctx}</div>
            </div>
          ))}
        </div>
        {points ? (
          <div style={{ display: "flex", alignItems: "center", gap: 28, marginTop: "auto",
            paddingTop: 20, borderTop: `1px solid ${T.border}` }}>
            <div style={{ display: "flex", flexDirection: "column", width: 300 }}>
              <div style={{ fontSize: 16, letterSpacing: 1.5, color: T.muted, textTransform: "uppercase" }}>{spark!.label}</div>
              <div style={{ fontSize: 20, fontWeight: 600, marginTop: 4 }}>{spark!.range}</div>
            </div>
            <svg width={SPARK_W} height={SPARK_H} viewBox={`0 0 ${SPARK_W} ${SPARK_H}`}>
              <polyline points={points} fill="none" stroke={spark!.color ?? C.sky} strokeWidth="3"
                strokeLinejoin="round" strokeLinecap="round" />
              {end && <circle cx={end[0]} cy={end[1]} r="5" fill={spark!.color ?? C.sky} />}
            </svg>
          </div>
        ) : takeaway ? (
          <div style={{ display: "flex", marginTop: "auto", paddingTop: 20, borderTop: `1px solid ${T.border}` }}>
            <div style={{ fontSize: takeaway.length > 120 ? 21 : 24, lineHeight: 1.35, borderLeft: `4px solid ${C.sky}`,
              paddingLeft: 16, maxWidth: 1088 }}>{takeaway}</div>
          </div>
        ) : null}
      </div>
    ),
    { ...OG_SIZE },
  );
}
