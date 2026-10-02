"use client";
import type { Capacity } from "@/lib/types";
import { GEOBASE, type GeoPanel } from "./geobase";
import { useChartTip } from "./ChartTip";

type ChartTip = ReturnType<typeof useChartTip>;

type Site = Capacity["geo"][number];
const STATUS: Record<string, string> = { o: "Operational", c: "Construction", p: "Planned", s: "Secured" };
const R = (mw: number) => 3 + Math.sqrt(mw) * 0.52;
const fmtMW = (mw: number | null) =>
  mw == null ? "MW undisclosed" : mw >= 1000 ? `${(mw / 1000).toFixed(1)} GW` : `${Math.round(mw).toLocaleString("en-US")} MW`;
const PANEL_NAME: Record<string, string> = { na: "North America", eu: "Europe" };
// The North America base panel spans most of Canada; every mapped site sits in
// the lower 48 or southern Canada, so the view crops to that band.
const CROP: Record<string, [number, number, number, number]> = { na: [20, 40, 905, 520] };

function proj(p: GeoPanel, lon: number, lat: number): [number, number] {
  return [p.pad + (lon - p.lon0) * p.cosm * p.k, p.pad + (p.lat1 - lat) * p.k];
}
function inPanel(p: GeoPanel, lon: number, lat: number): boolean {
  const [x, y] = proj(p, lon, lat);
  return x >= 0 && x <= p.W && y >= 0 && y <= p.H;
}

function Panel({ id, p, sites, names, show, hide }: {
  id: string; p: GeoPanel; sites: Site[]; names: Map<string, string>;
  show: ChartTip["show"]; hide: () => void;
}) {
  const tip = (s: Site) => (
    <>
      <strong>{s.site}</strong>
      <span>{names.get(s.t) ?? s.t} · {STATUS[s.st] ?? s.st}</span>
      <dl>
        <dt>Critical IT</dt><dd>{fmtMW(s.mw)}</dd>
        {s.when && <><dt>Timing</dt><dd>{s.when}</dd></>}
      </dl>
      {s.approx && <p>Location is approximate (state or country level).</p>}
    </>
  );
  return (
    <svg viewBox={(CROP[id] ?? [0, 0, p.W, p.H]).join(" ")} role="img"
      aria-label={`${PANEL_NAME[id] ?? id}: ${sites.length} sites. Largest listed beside the map.`}>
      <path d={p.d} className="cap-land" />
      {[...sites].sort((a, b) => (b.mw ?? -1) - (a.mw ?? -1)).map((s, i) => {
        const [cx, cy] = proj(p, s.lng, s.lat);
        // Null MW = undisclosed: a fixed ring, never a tiny filled dot that
        // would read as a small disclosed site.
        const nd = s.mw == null, hollow = nd || s.st === "s";
        return (
          <circle key={i} cx={cx} cy={cy} r={nd ? 4.5 : R(s.mw as number)}
            className={`cap-site cap-site-${s.st}${hollow ? " is-hollow" : ""}${s.approx ? " is-approx" : ""}`}
            tabIndex={0} aria-label={`${s.site}, ${names.get(s.t) ?? s.t}: ${fmtMW(s.mw)}, ${STATUS[s.st]}`}
            onPointerMove={(e) => show(e, tip(s))} onPointerLeave={hide}
            onFocus={(e) => show(e, tip(s))} onBlur={hide} />
        );
      })}
    </svg>
  );
}

export function GeoMap({ data, visible }: { data: Capacity; visible: Set<string> }) {
  const { wrap, show, hide, node } = useChartTip();
  const names = new Map(data.companies.map((c) => [c.t, c.n]));
  const sites = data.geo.filter((s) => visible.has(s.t));
  const panels = Object.entries(GEOBASE).map(([id, p]) => ({ id, p, here: sites.filter((s) => inPanel(p, s.lng, s.lat)) }));
  const na = panels.find((x) => x.id === "na");
  const others = panels.filter((x) => x.id !== "na" && x.here.length);
  // Sites with coordinates outside every drawn panel (e.g. China) are listed,
  // never silently dropped.
  const offMap = sites.filter((s) => !panels.some((x) => x.here.includes(s)));
  const unmapped = data.geo_unmapped.filter((s) => visible.has(s.t));
  const largest = [...sites].filter((s) => s.mw != null).sort((a, b) => (b.mw as number) - (a.mw as number)).slice(0, 10);
  const maxMW = largest[0]?.mw ?? 1;
  const elsewhere = [
    ...offMap.map((s) => ({ t: s.t, site: s.site, mw: s.mw, st: s.st, why: "outside the mapped regions" })),
    ...unmapped,
  ].sort((a, b) => (b.mw ?? -1) - (a.mw ?? -1));

  return (
    <div className="cap-viz" ref={wrap}>
      <div className="cap-viz-head">
        <div>
          <h3>Where the AI campuses are</h3>
          <p>Campus-level sites sized by critical-IT MW. Positions are town or county centroids, not parcels.</p>
        </div>
        <ul className="cap-key">
          {(["o", "c", "p", "s"] as const).map((st) => (
            <li key={st}><i className={`cap-site-key cap-site-${st}${st === "s" ? " is-hollow" : ""}`} aria-hidden />{STATUS[st]}</li>
          ))}
          <li><i className="cap-site-key is-approx-key" aria-hidden />Approximate location</li>
          <li className="cap-size-item">
            {[100, 500, 1500].map((mw) => {
              const d = R(mw) * 2;
              return (
                <span key={mw}>
                  <svg width={d + 2} height={d + 2} aria-hidden className="cap-size-key"><circle cx={d / 2 + 1} cy={d / 2 + 1} r={d / 2} /></svg>
                  {fmtMW(mw)}
                </span>
              );
            })}
          </li>
        </ul>
      </div>
      {na && na.here.length > 0 && (
        <div className="dashboard-panel cap-chart cap-map">
          <Panel id="na" p={na.p} sites={na.here} names={names} show={show} hide={hide} />
        </div>
      )}
      <div className="cap-geo-row">
        {others.map((x) => (
          <div key={x.id} className="dashboard-panel cap-chart cap-map cap-map-inset">
            <span className="cap-map-name">{PANEL_NAME[x.id] ?? x.id}</span>
            <Panel id={x.id} p={x.p} sites={x.here} names={names} show={show} hide={hide} />
          </div>
        ))}
        {largest.length > 0 && (
          <section className="cap-largest" aria-label="Largest mapped campuses">
            <h4 className="cap-h">Largest campuses</h4>
            <ol>
              {largest.map((s, i) => (
                <li key={i}>
                  <span className={`cap-status cap-status-${s.st}`} aria-label={STATUS[s.st]} />
                  <span className="cap-largest-name">{s.site}<small>{names.get(s.t) ?? s.t}</small></span>
                  <span className="num">{fmtMW(s.mw)}</span>
                  <i className="cap-minibar" style={{ width: `${((s.mw as number) / maxMW) * 100}%` }} aria-hidden />
                </li>
              ))}
            </ol>
          </section>
        )}
      </div>
      {node}
      {elsewhere.length > 0 && (
        <section className="cap-elsewhere" aria-label="Sites not on the map">
          <h4 className="cap-h">Not on the map <small>{elsewhere.length}</small></h4>
          <div className="capacity-site-table">
            <table className="cap-table">
              <thead>
                <tr><th scope="col">Site</th><th scope="col">Company</th><th scope="col" className="num">MW</th><th scope="col">Status</th><th scope="col">Why it isn&apos;t mapped</th></tr>
              </thead>
              <tbody>
                {elsewhere.map((s, i) => (
                  <tr key={i}>
                    <td>{s.site}</td>
                    <td>{names.get(s.t) ?? s.t}</td>
                    <td className="num">{s.mw != null ? Math.round(s.mw).toLocaleString("en-US") : "n/d"}</td>
                    <td><span className={`cap-status cap-status-${s.st}`}>{STATUS[s.st] ?? s.st}</span></td>
                    <td className="cap-muted">{s.why}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
      <p className="cap-viz-note">{data.geo_note}</p>
    </div>
  );
}
