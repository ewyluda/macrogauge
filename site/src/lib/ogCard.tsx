import { ImageResponse } from "next/og";

/** Shared 1200×630 social card, rendered at build time (static export).
 *  Colours mirror globals.css tokens. satori rule: a div whose children mix
 *  text and {expressions} is rejected — pass every text as one string. */
export const OG_SIZE = { width: 1200, height: 630 };

export type OgTile = { label: string; value: string; color: string; ctx: string };

export function ogCard({ kicker, headline, tiles, stamp }: {
  kicker: string; headline: string; tiles: OgTile[]; stamp: string;
}): ImageResponse {
  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column",
        background: "#0B0F14", color: "#E6EDF3", padding: 56, fontFamily: "sans-serif" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div style={{ fontSize: 34, fontWeight: 800, letterSpacing: 6 }}>{`MACROGAUGE · ${kicker}`}</div>
          <div style={{ fontSize: 20, color: "#8B98A5" }}>{stamp}</div>
        </div>
        <div style={{ fontSize: 34, lineHeight: 1.3, marginTop: 28, maxWidth: 1060 }}>{headline}</div>
        <div style={{ display: "flex", gap: 20, marginTop: 40 }}>
          {tiles.map((t) => (
            <div key={t.label} style={{ display: "flex", flexDirection: "column", background: "#11161C",
              border: "1px solid #232B35", borderRadius: 16, padding: "22px 28px", flex: 1 }}>
              <div style={{ fontSize: 18, letterSpacing: 2, color: "#8B98A5", textTransform: "uppercase" }}>{t.label}</div>
              <div style={{ fontSize: 68, fontWeight: 700, color: t.color, lineHeight: 1.1 }}>{t.value}</div>
              <div style={{ fontSize: 18, color: "#8B98A5" }}>{t.ctx}</div>
            </div>
          ))}
        </div>
      </div>
    ),
    { ...OG_SIZE },
  );
}

export const C = { sky: "#38BDF8", amber: "#F59E0B", violet: "#A78BFA", emerald: "#34D399", red: "#F87171" };
