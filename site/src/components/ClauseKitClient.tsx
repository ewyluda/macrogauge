"use client";
import { useMemo, useState } from "react";
import { clauseText, settle, type ClauseSeries, type ClauseTerms, type Vintage } from "@/lib/clause";
import { fmtUsd } from "@/lib/format";
import { KpiCard } from "./KpiCard";

const input = { background: "var(--card)", color: "var(--fg)", border: "1px solid var(--border)", borderRadius: 6, padding: "6px 8px" } as const;
const num = (v: string) => (v.trim() === "" ? null : Number(v));

export function ClauseKitClient({ series }: { series: ClauseSeries[] }) {
  const [code, setCode] = useState(series.find((s) => s.code === "switchgear")?.code ?? series[0].code);
  const s = series.find((x) => x.code === code) ?? series[0];
  const lastPrinted = s.months[s.months.length - 1];
  const [baseMonth, setBase] = useState(s.months[Math.max(0, s.months.length - 13)]);
  const [adjMonth, setAdj] = useState(lastPrinted);
  const [vintage, setVintage] = useState<Vintage>("first_print");
  const [band, setBand] = useState("5");
  const [bandMode, setBandMode] = useState<"excess" | "full">("excess");
  const [share, setShare] = useState("100");
  const [cap, setCap] = useState("15");
  const [floor, setFloor] = useState("");
  const [value, setValue] = useState("10000000");
  const [escalable, setEscalable] = useState("60");
  const [copied, setCopied] = useState(false);

  const terms: ClauseTerms = {
    baseMonth, adjMonth, vintage, bandPct: num(band) ?? 0, bandMode, sharePct: num(share) ?? 100,
    capPct: num(cap), floorPct: num(floor), contractValue: num(value) ?? 0, escalablePct: num(escalable) ?? 100,
  };
  const r = useMemo(() => settle(s, terms), [s, terms.baseMonth, terms.adjMonth, terms.vintage, terms.bandPct, terms.bandMode, terms.sharePct, terms.capPct, terms.floorPct, terms.contractValue, terms.escalablePct]); // eslint-disable-line react-hooks/exhaustive-deps
  const text = clauseText(s, terms);
  const field = (label: string, el: React.ReactNode) => (
    <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 12, color: "var(--muted)" }}>{label}{el}</label>
  );
  return (
    <div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))", gap: 12, marginBottom: 16 }}>
        {field("Index (official series)", <select value={code} onChange={(e) => setCode(e.target.value)} style={input}>
          {series.map((x) => <option key={x.code} value={x.code}>{`${x.label} — ${x.source_id}`}</option>)}
        </select>)}
        {field("Base month", <input type="month" value={baseMonth} min={s.months[0]} max={lastPrinted} onChange={(e) => setBase(e.target.value)} style={input} />)}
        {field("Adjustment month", <input type="month" value={adjMonth} min={s.months[0]} max={lastPrinted} onChange={(e) => setAdj(e.target.value)} style={input} />)}
        {field("Vintage", <select value={vintage} onChange={(e) => setVintage(e.target.value as Vintage)} style={input}>
          <option value="first_print">First print (as first published)</option>
          <option value="latest">Latest (revised)</option>
        </select>)}
        {field("Deadband ±%", <input inputMode="decimal" value={band} onChange={(e) => setBand(e.target.value)} style={input} />)}
        {field("Deadband rule", <select value={bandMode} onChange={(e) => setBandMode(e.target.value as "excess" | "full")} style={input}>
          <option value="excess">Only the excess beyond the band</option>
          <option value="full">Full change once exceeded</option>
        </select>)}
        {field("Buyer's share %", <input inputMode="decimal" value={share} onChange={(e) => setShare(e.target.value)} style={input} />)}
        {field("Cap % (blank = none)", <input inputMode="decimal" value={cap} onChange={(e) => setCap(e.target.value)} style={input} />)}
        {field("Floor % (blank = none)", <input inputMode="decimal" value={floor} onChange={(e) => setFloor(e.target.value)} style={input} />)}
        {field("Contract value ($)", <input inputMode="numeric" value={value} onChange={(e) => setValue(e.target.value)} style={input} />)}
        {field("Escalable share %", <input inputMode="decimal" value={escalable} onChange={(e) => setEscalable(e.target.value)} style={input} />)}
      </div>
      {!r.ok ? (
        <p className="method" role="alert" style={{ color: "var(--accent-red)" }}>{r.error}</p>
      ) : (
        <div className="kpi-row" data-testid="clause-result">
          <KpiCard label="Index change" value={`${r.changePct >= 0 ? "+" : ""}${r.changePct.toFixed(2)}%`}
            context={`${r.baseIndex.toFixed(3)} → ${r.adjIndex.toFixed(3)}${r.adjRelease ? ` · printed ${r.adjRelease}` : ""}`} accent="sky" />
          <KpiCard label="Adjustment" value={`${r.adjustedPct >= 0 ? "+" : ""}${r.adjustedPct.toFixed(2)}%`}
            context={r.capped ? `hit the ${r.capped}` : `after deadband & ${terms.sharePct}% share`} accent="violet" />
          <KpiCard label="Price change" value={fmtUsd(r.dollars)} context={`on ${terms.escalablePct}% escalable of ${fmtUsd(terms.contractValue)}`} accent={r.dollars >= 0 ? "red" : "emerald"} />
        </div>
      )}
      <div className="table-card" style={{ padding: 16, marginTop: 12 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
          <strong>Clause text</strong>
          <button type="button" className="chip" onClick={async () => { try { await navigator.clipboard.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch { /* clipboard blocked */ } }}>
            {copied ? "Copied" : "Copy"}
          </button>
        </div>
        <p data-testid="clause-text" style={{ lineHeight: 1.6, marginTop: 8 }}>{text}</p>
      </div>
    </div>
  );
}
