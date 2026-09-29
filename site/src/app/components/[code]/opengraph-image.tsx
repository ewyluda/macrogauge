import { C, ogCard } from "@/lib/ogCard";
import replayJson from "../../../../public/data/replay.json";
import { COMPONENTS, COMPONENT_BY_CODE } from "@/lib/components";
import { fmtSigned } from "@/lib/format";

export const dynamic = "force-static";
export const alt = "MacroGauge component — live re-price vs the official BLS index";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export function generateStaticParams() {
  return COMPONENTS.map((c) => ({ code: c.code }));
}

type RC = { code: string; label: string; weight: number; mode: string; last_obs?: string;
  yoy: (number | null)[]; bls_yoy: (number | null)[] };
const replay = replayJson as unknown as { dates: string[]; components: RC[] };
const last = (xs: (number | null)[]) => [...xs].reverse().find((v) => v != null) ?? null;

export default async function Image({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const c = replay.components.find((x) => x.code === code);
  const label = COMPONENT_BY_CODE[code]?.label ?? code;
  const ours = c ? last(c.yoy) : null;
  const bls = c ? last(c.bls_yoy) : null;
  return ogCard({
    kicker: "COMPONENT",
    stamp: `as of ${replay.dates.at(-1) ?? ""}`,
    headline: `${label} — ${c?.mode === "live" ? "re-priced from live data" : "official BLS carry-forward"}, ${((c?.weight ?? 0) * 100).toFixed(1)}% of the basket.`,
    tiles: [
      { label: "Macrogauge · YoY", value: ours == null ? "—" : fmtSigned(ours), color: C.sky, ctx: c?.last_obs ? `own last obs ${c.last_obs}` : "own last obs" },
      { label: "Official BLS · YoY", value: bls == null ? "—" : fmtSigned(bls), color: C.amber, ctx: "latest print" },
    ],
  });
}
