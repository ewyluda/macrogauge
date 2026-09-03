"use client";
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { KpiCard } from "./KpiCard";
import { CopyLink } from "./CopyLink";
import { DownloadData } from "./DownloadData";
import { CarryTable } from "./CarryTable";
import { lastCompleteMonth, MAX_HORIZON_MONTHS } from "@/lib/dcContingency";
import type { EscalationData } from "@/lib/escalationData";
import { fmtPp, fmtSigned, fmtUsd } from "@/lib/format";
import {
  DEFAULT_BASIS, decodeProjects, driversAcross, encodeProjects, evaluateAll, newId, totals, type Project,
} from "@/lib/portfolio";
import { codecs } from "@/lib/urlState";
import { useUrlState } from "@/lib/useUrlState";

const STORAGE_KEY = "macrogauge.portfolio.v1";
const SAMPLE: Project[] = [
  { id: "s1", name: "Campus A — Phase 1", market: "nova", mw: 120, baseCost: 1_200_000_000, baseMonth: "2024-06", deliveryMonth: "", basis: DEFAULT_BASIS },
  { id: "s2", name: "Campus B", market: "dfw", mw: 200, baseCost: 1_900_000_000, baseMonth: "2025-03", deliveryMonth: "", basis: DEFAULT_BASIS },
];

const input: React.CSSProperties = {
  background: "var(--bg)", color: "var(--text)", border: "1px solid var(--border)", borderRadius: 6,
  padding: "6px 8px", fontVariantNumeric: "tabular-nums", font: "inherit", fontSize: 13,
};

/** The program view (register P6): a reader's projects, escalated to date
 *  and carried to delivery by a basis THEY chose, aggregated in dollars.
 *  State lives in the URL (?p=) and localStorage — no login, nothing
 *  leaves the browser. */
export function PortfolioClient({ data, markets }: { data: EscalationData; markets: { key: string; name: string }[] }) {
  const [encoded, setEncoded] = useUrlState("p", "", codecs.str(4000));
  const [projects, setProjects] = useState<Project[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [pasteOpen, setPasteOpen] = useState(false);
  const [pasteText, setPasteText] = useState("");
  const [pasteError, setPasteError] = useState<string | null>(null);

  // hydrate: URL wins, then localStorage, then the sample
  useEffect(() => {
    if (loaded) return;
    const fromUrl = encoded ? decodeProjects(encoded) : null;
    if (fromUrl && fromUrl.length) { setProjects(fromUrl); setLoaded(true); return; }
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      const fromLocal = raw ? decodeProjects(raw) : null;
      setProjects(fromLocal && fromLocal.length ? fromLocal : SAMPLE);
    } catch {
      setProjects(SAMPLE);
    }
    setLoaded(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [encoded, loaded]);

  // persist: both channels, every change
  useEffect(() => {
    if (!loaded) return;
    const s = encodeProjects(projects);
    setEncoded(projects.length ? s : "");
    try { window.localStorage.setItem(STORAGE_KEY, s); } catch { /* storage unavailable: URL still carries it */ }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projects, loaded]);

  const anchor = lastCompleteMonth(data.months, data.componentLastObs) ?? data.months[data.months.length - 1];
  const lastMonth = data.months[data.months.length - 1];
  const { evals, basisRows } = useMemo(() => evaluateAll(projects, data.months, data.index, anchor), [projects, data, anchor]);
  const t = useMemo(() => totals(evals), [evals]);
  const drivers = useMemo(() => driversAcross(evals, data.months, data.componentIndex, data.components), [evals, data]);
  const firstBand = evals.find((e) => e.band)?.band ?? null;
  const firstBanded = evals.find((e) => e.band);

  const update = (id: string, patch: Partial<Project>) => setProjects((ps) => ps.map((p) => (p.id === id ? { ...p, ...patch } : p)));
  const remove = (id: string) => setProjects((ps) => ps.filter((p) => p.id !== id));
  const add = () => setProjects((ps) => [...ps, { id: newId(), name: `Project ${ps.length + 1}`, market: markets[0]?.key ?? "", mw: 100, baseCost: 1_000_000_000, baseMonth: data.months[Math.max(0, data.months.length - 13)], deliveryMonth: "", basis: DEFAULT_BASIS }]);
  const applyPaste = () => {
    const parsed = decodeProjects(pasteText.trim());
    if (!parsed) { setPasteError("That is not a project list this page exported — expected a JSON array of projects."); return; }
    setProjects(parsed); setPasteOpen(false); setPasteText(""); setPasteError(null);
  };

  const csvRows = evals.map((e) => ({
    name: e.project.name, market: e.project.market, mw: e.project.mw, base_estimate: e.project.baseCost, base_month: e.project.baseMonth,
    delivery_month: e.project.deliveryMonth || null, basis: e.chosen?.key ?? null, basis_annualized_pct: e.chosen?.annualizedPct ?? null,
    escalated_to_date: e.toDate == null ? null : Math.round(e.toDate), escalation_to_date_pct: e.result?.pct ?? null,
    at_delivery: e.atDelivery == null ? null : Math.round(e.atDelivery), at_delivery_p10: e.atDeliveryP10 == null ? null : Math.round(e.atDeliveryP10),
    at_delivery_p90: e.atDeliveryP90 == null ? null : Math.round(e.atDeliveryP90), per_mw_at_delivery: e.perMwAtDelivery == null ? null : Math.round(e.perMwAtDelivery),
    errors: e.errors.join("; ") || null,
  }));

  if (!loaded) return <div style={{ color: "var(--muted)", fontSize: 13, padding: 24 }}>loading your projects…</div>;

  return (
    <div>
      <div className="kpi-row">
        <KpiCard label="Capital at base" value={fmtUsd(t.capital)} context={`${t.valid} of ${t.projects} projects priced · ${t.mw.toLocaleString("en-US")} MW`} accent="sky" />
        <KpiCard label={`Escalated to ${lastMonth}`} value={fmtUsd(t.toDate)} context={`${fmtSigned(t.weightedToDatePct)} dollar-weighted · ${fmtUsd(t.exposureToDate)} exposure to date`} accent={(t.exposureToDate ?? 0) >= 0 ? "red" : "emerald"} />
        <KpiCard label="At delivery, carried" value={fmtUsd(t.atDelivery)} context={`${fmtSigned(t.weightedAtDeliveryPct)} vs base · carry ${fmtUsd(t.exposureCarry)} at each project's chosen basis`} accent="violet" />
        <KpiCard label="Realized band at delivery" value={t.atDeliveryP10 == null ? "—" : `${fmtUsd(t.atDeliveryP10)} – ${fmtUsd(t.atDeliveryP90)}`}
          context={t.banded ? `p10–p90 of like-length history on ${t.banded} project${t.banded === 1 ? "" : "s"} · not a probability` : "set delivery months ≥12 months out for a band"} accent="amber" />
      </div>

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", margin: "12px 0" }}>
        <button type="button" className="tool-btn" onClick={add}>+ Add project</button>
        <button type="button" className="tool-btn" onClick={() => setPasteOpen((v) => !v)}>{pasteOpen ? "Close" : "Import / export JSON"}</button>
        <button type="button" className="tool-btn" onClick={() => setProjects(SAMPLE)}>Reset to sample</button>
        <CopyLink label="Copy link to this portfolio" />
        <DownloadData rows={csvRows} filename="macrogauge-portfolio" citation={`MacroGauge portfolio escalation, DC Build index ${data.rebase}, measured to ${anchor}`} />
      </div>
      {pasteOpen && (
        <div className="table-card" style={{ padding: 12, marginBottom: 12 }}>
          <div style={{ fontSize: 12, color: "var(--muted)", marginBottom: 6 }}>
            Your project list as JSON — copy it to move between machines, or paste one in and apply. Nothing is sent anywhere.
          </div>
          <textarea value={pasteText || encodeProjects(projects)} onChange={(e) => { setPasteText(e.target.value); setPasteError(null); }}
            rows={5} style={{ ...input, width: "100%", fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace", fontSize: 11 }} />
          {pasteError && <div style={{ color: "var(--accent-amber)", fontSize: 12, marginTop: 6 }}>{pasteError}</div>}
          <div style={{ marginTop: 8 }}><button type="button" className="tool-btn" onClick={applyPaste}>Apply pasted list</button></div>
        </div>
      )}

      <div className="table-card">
        <table className="data-table">
          <thead>
            <tr>
              <th style={{ textAlign: "left" }}>Project</th><th>Market</th><th>MW</th><th>Base estimate</th><th>Base month</th><th>Deliver by</th><th>Carry basis</th>
              <th>To {lastMonth}</th><th>At delivery</th><th>$/MW at delivery</th><th></th>
            </tr>
          </thead>
          <tbody>
            {evals.map((e) => {
              const p = e.project;
              return (
                <tr key={p.id} data-testid="portfolio-row">
                  <td style={{ textAlign: "left" }}>
                    <input value={p.name} onChange={(ev) => update(p.id, { name: ev.target.value })} style={{ ...input, width: 160 }} aria-label="Project name" />
                    {e.errors.length > 0 && <div style={{ color: "var(--accent-amber)", fontSize: 11, marginTop: 4, maxWidth: 260 }}>{e.errors.join(" ")}</div>}
                  </td>
                  <td>
                    <select value={p.market} onChange={(ev) => update(p.id, { market: ev.target.value })} style={input} aria-label="Market">
                      {markets.map((m) => <option key={m.key} value={m.key}>{m.name}</option>)}
                    </select>
                  </td>
                  <td><input type="number" min={0} step={10} value={p.mw} onChange={(ev) => update(p.id, { mw: Number(ev.target.value) || 0 })} style={{ ...input, width: 70 }} aria-label="MW" /></td>
                  <td><input type="number" min={0} step={1_000_000} value={p.baseCost} onChange={(ev) => update(p.id, { baseCost: Number(ev.target.value) || 0 })} style={{ ...input, width: 150 }} aria-label="Base estimate" /></td>
                  <td><input type="month" min={data.months[0]} max={anchor} value={p.baseMonth} onChange={(ev) => update(p.id, { baseMonth: ev.target.value })} style={{ ...input, width: 120 }} aria-label="Base month" /></td>
                  <td><input type="month" min={lastMonth} value={p.deliveryMonth} onChange={(ev) => update(p.id, { deliveryMonth: ev.target.value })} style={{ ...input, width: 120 }} aria-label="Delivery month" /></td>
                  <td>
                    <select value={e.chosen?.key ?? DEFAULT_BASIS} onChange={(ev) => update(p.id, { basis: ev.target.value })} style={input} aria-label="Carry basis" disabled={!p.deliveryMonth}>
                      {basisRows.map((b) => <option key={b.key} value={b.key}>{b.label} · {fmtSigned(b.annualizedPct)}/yr</option>)}
                    </select>
                  </td>
                  <td>{e.toDate == null ? "—" : <>{fmtUsd(e.toDate)}<div style={{ fontSize: 11, color: "var(--muted)" }}>{fmtSigned(e.result?.pct ?? null)}</div></>}</td>
                  <td>{e.atDelivery == null ? "—" : <>{fmtUsd(e.atDelivery)}<div style={{ fontSize: 11, color: "var(--muted)" }}>{e.horizon > 0 ? `${e.horizon}mo carried` : "no carry"}{e.atDeliveryP10 != null ? ` · ${fmtUsd(e.atDeliveryP10)}–${fmtUsd(e.atDeliveryP90)}` : ""}</div></>}</td>
                  <td>{e.perMwAtDelivery == null ? "—" : fmtUsd(e.perMwAtDelivery)}</td>
                  <td><button type="button" className="tool-btn" onClick={() => remove(p.id)} aria-label={`Remove ${p.name}`}>✕</button></td>
                </tr>
              );
            })}
            {evals.length === 0 && <tr><td colSpan={11} style={{ color: "var(--muted)", textAlign: "left" }}>No projects yet — add one, or paste a list.</td></tr>}
          </tbody>
        </table>
        <div style={{ fontSize: 12, color: "var(--muted)", padding: "8px 12px" }}>
          To-date escalation is the DC Build index ratio from each base month to {lastMonth} (the same arithmetic as the{" "}
          <Link href="/escalation">calculator</Link>). The carry is the basis you chose per project, applied from {lastMonth} to delivery —
          a realized historical regime, not a forecast; the carry cap is {MAX_HORIZON_MONTHS} months. The band is the p10–p90 of every
          like-length window in the sample, applied to the to-date figure. Market is a label for your own reporting: escalation is
          national, and the market panel&apos;s labor tightness is on <Link href="/markets">/markets</Link>.
        </div>
      </div>

      {drivers.length > 0 && t.valid > 0 && (
        <div className="table-card" style={{ marginTop: 16 }}>
          <h2>What drove the exposure to date <span className="subtitle">component contributions summed across projects, dollars</span></h2>
          <table className="data-table">
            <thead><tr><th style={{ textAlign: "left" }}>Component</th><th>Group</th><th>Dollars</th><th>Share of exposure</th></tr></thead>
            <tbody>
              {drivers.map((d) => (
                <tr key={d.code}>
                  <td style={{ textAlign: "left" }}>{d.label}</td>
                  <td><span className="badge badge-muted">{d.group}</span></td>
                  <td style={{ color: d.contributionCost >= 0 ? "var(--accent-red)" : "var(--accent-emerald)", fontWeight: 600 }}>{fmtUsd(d.contributionCost)}</td>
                  <td>{t.exposureToDate ? fmtPp((d.contributionCost / t.exposureToDate) * 100).replace("pp", "%") : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <CarryTable basisRows={basisRows} chosenKey={null} deliveryValid={!!firstBanded} horizon={firstBanded?.horizon ?? 0} bandRow={firstBand} anchor={anchor} />
    </div>
  );
}
