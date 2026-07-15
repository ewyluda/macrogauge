import type { Metadata } from "next";
import methodology from "../../../public/data/methodology.json";
import { Section } from "@/components/Section";
import { MethodologyInventory } from "@/components/MethodologyInventory";
import { fmtSigned } from "@/lib/format";

export const metadata: Metadata = {
  title: "Methodology",
  description: "How the gauge is built — five pure stages, every series inventoried, generated from config and live validation.",
};

const statChip: React.CSSProperties = {
  background: "var(--card)",
  border: "1px solid var(--border)",
  borderRadius: 10,
  padding: "10px 16px",
  minWidth: 130,
};
const td: React.CSSProperties = {
  padding: "8px 12px",
  fontSize: 13,
  borderBottom: "1px solid var(--border)",
  fontVariantNumeric: "tabular-nums",
};

export default function Methodology() {
  const s = methodology.stats;
  const v = methodology.validation;
  const stats: [string, string][] = [
    ["Series", String(s.series_count)],
    ["Observations", s.obs_count.toLocaleString("en-US")],
    ["Sources", String(s.source_count)],
    ["Tracker corr", s.tracker_corr === null ? "—" : String(s.tracker_corr)],
    ["Live coverage", `${s.live_coverage_pct.toFixed(1)}%`],
    ["Engine", `v${s.engine_version} · ${s.rebase}`],
  ];
  return (
    <div>
      <h1 style={{ fontSize: 26, fontWeight: 700, margin: "24px 0 0" }}>
        Methodology{" "}
        <span style={{ color: "var(--muted)", fontWeight: 400, fontSize: 16 }}>
          generated from config + live validation — never hand-written
        </span>
      </h1>

      <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginTop: 20 }}>
        {stats.map(([label, value]) => (
          <div key={label} style={statChip}>
            <div
              style={{
                fontSize: 11,
                letterSpacing: "0.08em",
                textTransform: "uppercase",
                color: "var(--muted)",
              }}
            >
              {label}
            </div>
            <div style={{ fontSize: 20, fontWeight: 700, fontVariantNumeric: "tabular-nums" }}>
              {value}
            </div>
          </div>
        ))}
      </div>

      <Section title="How the gauge is built — five stages">
        <div style={{ display: "grid", gap: 12, gridTemplateColumns: "repeat(auto-fit, minmax(210px, 1fr))" }}>
          {methodology.stages.map((st) => (
            <div key={st.n} style={statChip}>
              <div style={{ color: "var(--accent-sky)", fontWeight: 700 }}>
                {st.n}. {st.name}
              </div>
              <div style={{ fontSize: 13, color: "var(--muted)", marginTop: 4 }}>
                {st.description}
              </div>
              {st.formula ? (
                <div
                  style={{
                    fontFamily: "ui-monospace, monospace",
                    fontSize: 12,
                    marginTop: 8,
                    color: "var(--accent-amber)",
                  }}
                >
                  {st.formula}
                </div>
              ) : null}
            </div>
          ))}
        </div>
      </Section>

      <Section title="The basket — 14 components">
        <div
          style={{
            background: "var(--card)",
            border: "1px solid var(--border)",
            borderRadius: 10,
            overflow: "hidden",
          }}
        >
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <tbody>
              {methodology.basket.map((b) => (
                <tr key={b.code}>
                  <td style={{ ...td, width: "30%" }}>{b.label}</td>
                  <td style={{ ...td, width: "25%" }}>
                    <div
                      style={{
                        background: "var(--accent-sky)",
                        opacity: 0.75,
                        height: 8,
                        borderRadius: 4,
                        width: `${Math.max(2, b.weight * 300)}px`,
                      }}
                    />
                  </td>
                  <td style={{ ...td, textAlign: "right" }}>
                    {(b.weight * 100).toFixed(1)}%
                  </td>
                  <td style={{ ...td, textAlign: "center" }}>
                    <span
                      style={{
                        fontSize: 10,
                        letterSpacing: "0.08em",
                        padding: "1px 8px",
                        borderRadius: 999,
                        border: "1px solid var(--border)",
                        color: b.mode === "live" ? "var(--accent-emerald)" : "var(--muted)",
                      }}
                    >
                      {b.mode === "live" ? "LIVE" : "BLS-CF"}
                    </span>
                  </td>
                  <td style={{ ...td, color: "var(--muted)", fontSize: 12 }}>
                    {b.live_sources.length
                      ? b.live_sources
                          .map((s) =>
                            (b.live_active as string[]).includes(s) ? s : `${s} (phase-in)`
                          )
                          .join(" + ")
                      : b.official_series}
                  </td>
                  <td style={{ ...td, textAlign: "right" }}>{fmtSigned(b.yoy_pct)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>

      <Section title="Feed freshness">
        <div
          style={{
            background: "rgba(52, 211, 153, 0.08)",
            border: "1px solid rgba(52, 211, 153, 0.3)",
            borderRadius: 10,
            padding: "10px 16px",
            fontSize: 14,
          }}
        >
          <span style={{ color: "var(--accent-emerald)", fontWeight: 700 }}>
            {methodology.freshness.fresh_count} of {methodology.freshness.total}
          </span>{" "}
          series fresh within their staleness windows (
          {((methodology.freshness.fresh_count / methodology.freshness.total) * 100).toFixed(1)}
          %)
        </div>
      </Section>

      <Section title="Series inventory">
        <MethodologyInventory rows={methodology.inventory} />
      </Section>

      <Section title="Validation vs official">
        <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
          {(["gauge", "col", "tracker", "supercore", "pce"] as const).map((name) => (
            <div key={name} style={statChip}>
              <div
                style={{
                  fontSize: 11,
                  letterSpacing: "0.08em",
                  textTransform: "uppercase",
                  color: "var(--muted)",
                }}
              >
                {name} · {v[name].window ?? ""}
              </div>
              <div style={{ fontSize: 15, marginTop: 4 }}>
                corr <b>{v[name].corr ?? "—"}</b> · mean abs gap{" "}
                <b>{v[name].mean_abs_gap_pp ?? "—"}pp</b>
              </div>
            </div>
          ))}
          {"lead_lag" in v.gauge && v.gauge.lead_lag ? (
            <div style={statChip}>
              <div style={{ fontSize: 11, letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--muted)" }}>
                lead vs print
              </div>
              <div style={{ fontSize: 15, marginTop: 4 }}>
                best corr <b>{v.gauge.lead_lag.corr}</b> at{" "}
                <b>{v.gauge.lead_lag.best_shift_months}mo</b> ahead
              </div>
            </div>
          ) : null}
          <div style={statChip}>
            <div
              style={{
                fontSize: 11,
                letterSpacing: "0.08em",
                textTransform: "uppercase",
                color: "var(--muted)",
              }}
            >
              BLS reconstruction check
            </div>
            <div style={{ fontSize: 15, marginTop: 4 }}>
              Σ wᵢ × BLS YoYᵢ = <b>{v.bls_reconstruction.weighted_bls_yoy_pct}%</b> vs
              official <b>{v.bls_reconstruction.official_yoy_pct}%</b>
            </div>
          </div>
        </div>
      </Section>

      <Section title="Variants">
        <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
          {Object.entries(methodology.variants).map(([name, desc]) => (
            <div key={name} style={{ ...statChip, flex: "1 1 300px" }}>
              <div style={{ fontWeight: 700, textTransform: "capitalize" }}>{name}</div>
              <div style={{ fontSize: 13, color: "var(--muted)", marginTop: 4 }}>{desc}</div>
            </div>
          ))}
        </div>
      </Section>

      <Section title="Limitations — read these">
        <ul style={{ margin: 0, paddingLeft: 20, color: "var(--muted)", fontSize: 14 }}>
          {methodology.limitations.map((l, i) => (
            <li key={i} style={{ marginBottom: 8 }}>
              {l}
            </li>
          ))}
        </ul>
      </Section>
    </div>
  );
}
