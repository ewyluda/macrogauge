"use client";
import type { Capacity } from "@/lib/types";
import { GEOBASE, type GeoPanel } from "./geobase";

const ST: Record<string, string> = { o: "var(--accent-amber, #f4c64a)", c: "var(--accent-sky, #5eb0ef)", p: "var(--muted)", s: "var(--muted)" };
const STLABEL: Record<string, string> = { o: "operational", c: "construction", p: "planned", s: "secured" };
const R = (mw: number) => Math.max(4, Math.sqrt(mw) * 1.15);

function inPanel(p: GeoPanel, lon: number, lat: number): boolean {
  const [x, y] = proj(p, lon, lat);
  return x >= 0 && x <= p.W && y >= 0 && y <= p.H;
}
function proj(p: GeoPanel, lon: number, lat: number): [number, number] {
  return [p.pad + (lon - p.lon0) * p.cosm * p.k, p.pad + (p.lat1 - lat) * p.k];
}

export function GeoMap({ data, visible }: { data: Capacity; visible: Set<string> }) {
  const sites = data.geo.filter((s) => visible.has(s.t));
  const unmapped = data.geo_unmapped.filter((s) => visible.has(s.t));
  return (
    <div>
      <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
        {Object.entries(GEOBASE).map(([key, p]) => {
          const here = sites.filter((s) => inPanel(p, s.lng, s.lat));
          if (!here.length) return null;
          return (
            <div key={key} className="dashboard-panel" style={{ flex: "1 1 420px", minWidth: 0 }}>
              <svg viewBox={`0 0 ${p.W} ${p.H}`} role="img" aria-label={`Site map — ${key}`}>
                <path d={p.d} fill="var(--chip-bg)" stroke="var(--border)" strokeWidth="0.7" />
                {here.sort((a, b) => (b.mw ?? -1) - (a.mw ?? -1)).map((s, i) => {
                  const [cx, cy] = proj(p, s.lng, s.lat);
                  // Null MW = undisclosed: a fixed hollow marker, never a
                  // quantitative dot that reads as a tiny disclosed site.
                  return (
                    <circle key={i} cx={cx} cy={cy} r={s.mw == null ? 4 : R(s.mw)}
                      fill={ST[s.st]} fillOpacity={s.mw == null ? 0 : s.st === "o" ? 0.4 : 0.2}
                      stroke={ST[s.st]} strokeWidth="1.5" strokeDasharray={s.approx ? "5 3" : undefined}>
                      <title>{`${s.t} — ${s.site}\n${s.mw == null ? "MW undisclosed" : `${Math.round(s.mw)} MW`} · ${STLABEL[s.st] ?? s.st}${s.when ? ` · ${s.when}` : ""}${s.approx ? " · approx location" : ""}`}</title>
                    </circle>
                  );
                })}
              </svg>
            </div>
          );
        })}
      </div>
      <p style={{ fontSize: 11.5, color: "var(--muted)", margin: "8px 2px" }}>{data.geo_note} Dashed = approximate location. Hollow = MW undisclosed.</p>
      {unmapped.length > 0 && (
        <div className="dashboard-panel" style={{ marginTop: 8 }}>
          <div style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: ".1em", color: "var(--muted)", marginBottom: 6 }}>
            Not mappable (location undisclosed)
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
            {unmapped.map((s, i) => (
              <span key={i} title={s.why} style={{ fontSize: 11, border: "1px solid var(--border)", borderRadius: 6, padding: "2px 8px", color: "var(--muted)" }}>
                <b style={{ color: "var(--text)" }}>{s.t}</b> {s.site} · {s.mw == null ? "MW undisclosed" : `${Math.round(s.mw)} MW`}
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
