"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { EChart } from "./EChart";
import { C } from "@/lib/chartTheme";

type Replay = {
  rebase: string;
  dates: string[];
  components: {
    code: string;
    label: string;
    weight: number;
    mode: string;
    index: number[];
    bls_index: number[];
  }[];
};

const MODES = [
  { key: "yoy", label: "YoY", domain: [-2, 6] },
  { key: "mom_ann", label: "MoM ann.", domain: [-2, 6] },
  { key: "vs_bls", label: "vs BLS", domain: [-3, 3] },
  { key: "d1", label: "1-Day Δ", domain: [-0.5, 0.5] },
  { key: "wow", label: "WoW Δ", domain: [-1, 1] },
] as const;
type ModeKey = (typeof MODES)[number]["key"];

// blue → slate → amber → red, nowflation's -2%→6% ramp normalized to t∈[0,1]
const STOPS: [number, [number, number, number]][] = [
  [0.0, [37, 99, 235]],   // blue
  [0.25, [71, 85, 105]],  // slate ≈ 0
  [0.62, [217, 119, 6]],  // amber
  [1.0, [220, 38, 38]],   // red
];

function ramp(t: number): string {
  const x = Math.max(0, Math.min(1, t));
  for (let i = 1; i < STOPS.length; i++) {
    if (x <= STOPS[i][0]) {
      const [t0, c0] = STOPS[i - 1];
      const [t1, c1] = STOPS[i];
      const f = (x - t0) / (t1 - t0);
      const c = c0.map((v, j) => Math.round(v + (c1[j] - v) * f));
      return `rgb(${c[0]},${c[1]},${c[2]})`;
    }
  }
  return `rgb(220,38,38)`;
}

const pct = (a: number, b: number) => (a / b - 1) * 100;

/** mode value for component c at daily position i (arrays are a contiguous
 *  daily grid, so offsets are positions, not date math) */
function modeValue(
  c: Replay["components"][number],
  i: number,
  mode: ModeKey
): number | null {
  const ix = c.index;
  switch (mode) {
    case "yoy":
      return i >= 365 ? pct(ix[i], ix[i - 365]) : null;
    case "mom_ann":
      return i >= 30 ? (Math.pow(ix[i] / ix[i - 30], 12) - 1) * 100 : null;
    case "vs_bls": {
      if (i < 365) return null;
      return pct(ix[i], ix[i - 365]) - pct(c.bls_index[i], c.bls_index[i - 365]);
    }
    case "d1":
      return i >= 1 ? pct(ix[i], ix[i - 1]) : null;
    case "wow":
      return i >= 7 ? pct(ix[i], ix[i - 7]) : null;
  }
}

export function Treemap() {
  const [data, setData] = useState<Replay | null>(null);
  const [mode, setMode] = useState<ModeKey>("yoy");
  const [pos, setPos] = useState(-1); // month index; -1 = latest (set on load)
  const [playing, setPlaying] = useState(false);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    fetch("/data/replay.json")
      .then((r) => r.json())
      .then((d: Replay) => setData(d))
      .catch(() => setData(null));
  }, []);

  // last daily position of each month — the scrubber steps months
  const monthEnds = useMemo(() => {
    if (!data) return [] as { month: string; i: number }[];
    const out: { month: string; i: number }[] = [];
    data.dates.forEach((d, i) => {
      const m = d.slice(0, 7);
      if (out.length && out[out.length - 1].month === m) out[out.length - 1].i = i;
      else out.push({ month: m, i });
    });
    return out;
  }, [data]);

  const at = pos === -1 ? monthEnds.length - 1 : pos;

  useEffect(() => {
    if (!playing) {
      if (timer.current) clearInterval(timer.current);
      return;
    }
    timer.current = setInterval(() => {
      setPos((p) => {
        const cur = p === -1 ? 0 : p;
        const next = cur + 1;
        if (next >= monthEnds.length - 1) {
          setPlaying(false);
          return monthEnds.length - 1;
        }
        return next;
      });
    }, 250);
    return () => {
      if (timer.current) clearInterval(timer.current);
    };
  }, [playing, monthEnds.length]);

  // The ECharts option is rebuilt every frame during playback — that's the
  // point — but it must NOT rebuild on unrelated re-renders (EChart calls
  // setOption whenever the option identity changes). Guard the body against
  // data/monthEnds not being ready yet so this hook can run unconditionally
  // (before the loading early-return below), keyed only on what actually
  // changes the rendered treemap: data, mode, at.
  const option = useMemo(() => {
    const domain = MODES.find((m) => m.key === mode)!.domain;
    const frame = monthEnds.length ? monthEnds[at] : null;
    const values =
      data && frame
        ? data.components.map((c) => ({ c, v: modeValue(c, frame.i, mode) }))
        : [];
    return {
      tooltip: {
        backgroundColor: C.card,
        borderColor: C.border,
        textStyle: { color: C.text, fontSize: 12 },
      },
      series: [
        {
          type: "treemap",
          roam: false,
          nodeClick: false as const,
          breadcrumb: { show: false },
          itemStyle: { borderColor: C.bg, borderWidth: 2, gapWidth: 2 },
          label: {
            color: "#fff",
            fontSize: 12,
            formatter: (p: { name: string }) => p.name,
          },
          data: values.map(({ c, v }) => ({
            name: `${c.label}\n${v === null ? "—" : `${v.toFixed(1)}%`}`,
            value: c.weight,
            itemStyle: {
              color:
                v === null
                  ? "#2a3542"
                  : ramp((v - domain[0]) / (domain[1] - domain[0])),
            },
          })),
        },
      ],
    };
    // monthEnds is derived solely from `data` (memoized on [data]), so it
    // changes in lockstep and doesn't need its own dependency entry here.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, mode, at]);

  if (!data || !monthEnds.length) {
    return (
      <div style={{ color: "var(--muted)", fontSize: 13, padding: 24 }}>
        loading basket replay…
      </div>
    );
  }

  const frame = monthEnds[at];
  const values = data.components.map((c) => ({
    c,
    v: modeValue(c, frame.i, mode),
  }));
  const oursHeadline = values.every((x) => x.v !== null && mode === "yoy")
    ? values.reduce((s, x) => s + x.c.weight * (x.v as number), 0)
    : null;
  const blsHeadline =
    mode === "yoy" && frame.i >= 365
      ? data.components.reduce(
          (s, c) => s + c.weight * pct(c.bls_index[frame.i], c.bls_index[frame.i - 365]),
          0
        )
      : null;

  const chip = (active: boolean): React.CSSProperties => ({
    border: `1px solid ${active ? "rgba(56,189,248,0.5)" : "var(--border)"}`,
    background: active ? "rgba(56,189,248,0.12)" : "var(--chip-bg)",
    color: active ? "var(--accent-sky)" : "var(--muted)",
    borderRadius: 999,
    padding: "2px 10px",
    fontSize: 12,
    cursor: "pointer",
  });

  return (
    <div
      style={{
        background: "var(--card)",
        border: "1px solid var(--border)",
        borderRadius: 10,
        padding: 12,
      }}
    >
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 10 }}>
        {MODES.map((m) => (
          <button
            key={m.key}
            style={chip(mode === m.key)}
            onClick={() => setMode(m.key)}
          >
            {m.label}
          </button>
        ))}
      </div>
      <EChart option={option} height={420} />
      <div style={{ display: "flex", gap: 12, alignItems: "center", marginTop: 10 }}>
        <button
          style={chip(playing)}
          onClick={() => {
            if (!playing && (pos === -1 || at >= monthEnds.length - 1)) setPos(0);
            setPlaying(!playing);
          }}
        >
          {playing ? "❚❚ Pause" : "▶ Play"}
        </button>
        <input
          type="range"
          min={0}
          max={monthEnds.length - 1}
          value={at}
          onChange={(e) => {
            setPlaying(false);
            setPos(Number(e.target.value));
          }}
          style={{ flex: 1, accentColor: "#38BDF8" }}
        />
        <span
          style={{
            color: "var(--accent-sky)",
            fontWeight: 700,
            fontVariantNumeric: "tabular-nums",
          }}
        >
          {frame.month}
        </span>
      </div>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          fontSize: 11,
          color: "var(--muted)",
          marginTop: 6,
        }}
      >
        <span>tile area = basket weight · drag to replay 2018 → now</span>
        <span>
          Ours {oursHeadline === null ? "—" : `${oursHeadline.toFixed(2)}%`} · BLS{" "}
          {blsHeadline === null ? "—" : `${blsHeadline.toFixed(2)}%`}
        </span>
      </div>
    </div>
  );
}
