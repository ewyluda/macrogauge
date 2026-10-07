"use client";
import { useState } from "react";
import type { CapacityCompany } from "@/lib/types";
import { BUSINESS, businessOf, type Business } from "@/lib/capacityCohort";

const fmtMW = (mw: number) =>
  mw >= 1000 ? `${(mw / 1000).toFixed(1)} GW` : `${Math.round(mw).toLocaleString("en-US")} MW`;
const money = (b: number | null | undefined) =>
  b == null ? "—" : Math.abs(b) >= 1000 ? `$${(b / 1000).toFixed(2)}T` : `$${b.toFixed(Math.abs(b) < 10 ? 2 : 1)}B`;

const ROLE: Record<CapacityCompany["role"], string> = {
  neocloud: "Neocloud",
  landlord: "Powered-shell landlord",
  operator: "AI cloud operator",
  hyperscaler: "Hyperscaler",
  exploratory: "Exploring AI hosting",
};

// econ keys are curator shorthand; the page names them for readers.
const ECON: [string, string][] = [
  ["backlog", "Backlog"],
  ["anchor", "Anchor customers"],
  ["contract", "Contract terms"],
  ["revmw", "Revenue per MW"],
  ["capexmw", "Capex per MW"],
  ["margin", "Margins"],
  ["power", "Power"],
  ["pricing", "Pricing"],
];
const econLabel = (k: string) =>
  ECON.find(([key]) => key === k)?.[1] ?? k.charAt(0).toUpperCase() + k.slice(1);
const econOrder = (k: string) => {
  const i = ECON.findIndex(([key]) => key === k);
  return i < 0 ? ECON.length : i;
};

const SITE_STATUS: Record<string, string> = {
  o: "Operational", c: "Construction", p: "Planned", s: "Secured",
};

type Seg = "op" | "con" | "plan";
const SEG_LABEL: Record<Seg, string> = { op: "Operational", con: "Under construction", plan: "Planned" };

function Bar({ c, max }: { c: CapacityCompany; max: number }) {
  const total = c.op + c.con + c.plan;
  return (
    <div className="cap-bar" role="img"
      aria-label={`${fmtMW(c.op)} operational, ${fmtMW(c.con)} under construction, ${fmtMW(c.plan)} planned`}>
      {(["op", "con", "plan"] as Seg[]).map((k) => {
        const pct = (c[k] / max) * 100;
        if (c[k] <= 0) return null;
        // Inline labels only where the segment is wide enough to hold one;
        // the dossier always carries the exact figures.
        return (
          <span key={k} className={`cap-seg cap-seg-${k}`} style={{ width: `${pct}%` }}>
            {pct >= 11 && c[k] / total >= 0.12 && <span className="cap-seg-label">{fmtMW(c[k])}</span>}
          </span>
        );
      })}
    </div>
  );
}

function Stat({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div className="cap-stat">
      <dt>{label}</dt>
      <dd>
        {value}
        {note && <small>{note}</small>}
      </dd>
    </div>
  );
}

function Dossier({ c }: { c: CapacityCompany }) {
  const evPerMw = c.ev_per_mw != null ? `$${c.ev_per_mw.toFixed(1)}M`
    : "n/a";
  const evPerMwNote = c.ev_per_mw != null ? "EV ÷ weighted MW"
    : c.private ? "private — no market EV"
    : c.ev_note ? `withheld: ${c.ev_note}`
    : c.role === "hyperscaler" ? "conglomerate EV, not meaningful per AI MW" : undefined;
  const capValue = c.private ? money(c.valuation_b) : money(c.cap);
  const capNote = c.private ? "last private mark"
    : c.stale && c.cap != null ? `stale — priced ${c.priced_date}` : c.priced_date ? `priced ${c.priced_date}` : undefined;
  const econ = Object.entries(c.econ ?? {}).sort(([a], [b]) => econOrder(a) - econOrder(b));

  return (
    <div className="cap-dossier">
      <section aria-label="Capacity" className="cap-ledger">
        {(["op", "con", "plan"] as Seg[]).map((k) => (
          <div key={k} className="cap-ledger-cell">
            <span className={`cap-swatch cap-seg-${k}`} aria-hidden />
            <span className="cap-ledger-label">{SEG_LABEL[k]}</span>
            <strong>{c[k].toLocaleString("en-US")} <small>MW</small></strong>
          </div>
        ))}
        <div className="cap-ledger-cell">
          <span className="cap-ledger-label">Energized</span>
          <strong>{c.pct_energized != null ? `${c.pct_energized}%` : "—"}</strong>
        </div>
        {c.pipe && (
          <p className="cap-ledger-pipe"><span>Long-run pipeline</span> {c.pipe}</p>
        )}
      </section>

      {c.flag && (
        <aside className="cap-note">
          <h4>{c.confidence === "estimate" ? "How this estimate is built" : "Curator’s note"}</h4>
          <p>{c.flag}</p>
        </aside>
      )}

      <section aria-label="Valuation">
        <h4 className="cap-h">Valuation</h4>
        <dl className="cap-stats">
          <Stat label={c.private ? "Valuation" : "Market cap"} value={capValue} note={capNote} />
          <Stat label="Enterprise value" value={money(c.ev)} />
          <Stat label={c.nd != null && c.nd < 0 ? "Net cash" : "Net debt"}
            value={c.nd != null ? money(Math.abs(c.nd)) : "—"} />
          <Stat label="EV per MW" value={evPerMw} note={evPerMwNote} />
          <Stat label="Contracted backlog" value={money(c.bk)} />
          <Stat label="Backlog ÷ EV" value={c.coverage != null ? `${c.coverage}×` : "—"} />
        </dl>
        {c.ndflag && <p className="cap-foot"><span>Net debt basis.</span> {c.ndflag}</p>}
      </section>

      <div className="cap-columns">
        {econ.length > 0 && (
          <section aria-label="Business economics">
            <h4 className="cap-h">Business economics</h4>
            <dl className="cap-econ">
              {econ.map(([k, v]) => (
                <div key={k}>
                  <dt>{econLabel(k)}</dt>
                  <dd>{v}</dd>
                </div>
              ))}
            </dl>
          </section>
        )}
        {c.sites.length > 0 && (
          <section aria-label="Sites">
            <h4 className="cap-h">Sites <small>{c.sites.length}</small></h4>
            <div className="capacity-site-table">
              <table className="cap-sites">
                <thead>
                  <tr><th scope="col">Site</th><th scope="col" className="num">MW</th><th scope="col">Status and timing</th></tr>
                </thead>
                <tbody>
                  {c.sites.map(([name, mw, st, when], i) => (
                    <tr key={i}>
                      <td>{name}</td>
                      <td className="num">{mw != null ? mw.toLocaleString("en-US") : "n/d"}</td>
                      <td>
                        <span className={`cap-status cap-status-${st}`}>{SITE_STATUS[st] ?? st}</span>
                        <span className="cap-when">{when}</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        )}
      </div>

      {c.src.length > 0 && (
        <section aria-label="Sources" className="cap-sources">
          <h4 className="cap-h">Sources</h4>
          <ul>
            {c.src.map(([label, url]) => (
              <li key={url}><a href={url} target="_blank" rel="noreferrer">{label}</a></li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

// One linear scale across hyperscalers and pure plays turned every neocloud
// and ex-miner into a sliver beside Amazon's 34 GW. The list splits by
// business (hyperscalers, GPU clouds, landlords), each group on its own scale
// stated in its header; a view holding only one business keeps one list.
const GROUPS: Business[] = ["hyperscaler", "cloud", "landlord"];

export function CapacityBars({ rows }: { rows: CapacityCompany[] }) {
  const [open, setOpen] = useState<string | null>(null);
  const total = (c: CapacityCompany) => c.op + c.con + c.plan;
  const present = GROUPS.filter((g) => rows.some((c) => businessOf(c) === g));
  const groups = present.length > 1
    ? present.map((g) => ({ key: g, label: BUSINESS[g].label, detail: BUSINESS[g].detail,
                            rows: rows.filter((c) => businessOf(c) === g) }))
    : [{ key: "all", label: "", detail: "", rows }];
  let rank = 0;
  return (
    <div>
      <div className="cap-legend">
        <span><i className="cap-swatch cap-seg-op" aria-hidden /> Operational</span>
        <span><i className="cap-swatch cap-seg-con" aria-hidden /> Under construction</span>
        <span><i className="cap-swatch cap-seg-plan" aria-hidden /> Planned</span>
        <span className="cap-legend-note">MW are verify-adjusted critical IT. Select a company to open its full record.</span>
      </div>
      {rows.length === 0 && <p className="cap-empty">No company matches that search. Clear it or switch the cohort to see the full list.</p>}
      <div className="cap-head" aria-hidden>
        <span /><span>Company</span><span>Critical-IT MW</span><span className="r">Total</span><span className="r">EV per MW</span><span />
      </div>
      {groups.map((g) => {
        const max = Math.max(...g.rows.map(total), 1);
        return (
      <section key={g.key} className="cap-group" aria-label={g.label || undefined}>
      {g.label && (
        <h3 className="cap-group-head">{g.label} <small>{g.detail} · {g.rows.length} · bars scaled to {fmtMW(max)}</small></h3>
      )}
      <ol className="cap-list" start={rank + 1}>
        {g.rows.map((c) => {
          const i = rank++;
          const isOpen = open === c.t;
          return (
            <li key={c.t} className={`dashboard-panel cap-row${isOpen ? " is-open" : ""}`}>
              <button className="capacity-company" type="button" onClick={() => setOpen(isOpen ? null : c.t)}
                aria-expanded={isOpen}>
                <span className="cap-rank" aria-hidden>{i + 1}</span>
                <span className="cap-id">
                  <span className="cap-name">{c.n}</span>
                  <span className="cap-meta">
                    <span className="cap-ticker">{c.private ? "Private" : c.t}</span>
                    <span>{ROLE[c.role] ?? c.role}</span>
                    {c.confidence === "estimate"
                      ? <span className="cap-badge cap-badge-est" title="MW footprint is a curated estimate, not filing-grade">Estimate</span>
                      : <span className="cap-badge" title="MW figures come from company filings">Filed</span>}
                  </span>
                </span>
                <span className="cap-track"><Bar c={c} max={max} /></span>
                <span className="cap-total">
                  <strong>{fmtMW(total(c))}</strong>
                  <small>{c.pct_energized != null ? `${Math.round(c.pct_energized)}% energized` : ""}</small>
                </span>
                <span className="cap-evmw">
                  {c.ev_per_mw != null
                    ? c.stale
                      ? <span title={`Stale quote — last priced ${c.priced_date}`}>${c.ev_per_mw.toFixed(0)}M*</span>
                      : `$${c.ev_per_mw.toFixed(0)}M`
                    : <span className="cap-na" title={c.private ? "Private — no market EV" : c.ev_note ?? "Conglomerate EV — not meaningful per AI MW"}>n/a</span>}
                </span>
                <span className="cap-chevron" aria-hidden />
              </button>
              {isOpen && <Dossier c={c} />}
            </li>
          );
        })}
      </ol>
      </section>
        );
      })}
    </div>
  );
}
