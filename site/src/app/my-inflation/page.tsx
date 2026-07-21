import type { Metadata } from "next";
import compare from "../../../public/data/compare.json";
import pulse from "../../../public/data/pulse.json";
import geoJson from "../../../public/data/geo.json";
import type { Geo } from "@/lib/types";
import { MyInflationClient } from "@/components/MyInflationClient";

export const metadata: Metadata = {
  title: "My Inflation",
  description: "The official basket isn't your basket — reweight the gauge to your life.",
};

export default function MyInflation() {
  return (
    <div>
      <h1 style={{ fontSize: 26, fontWeight: 700, margin: "24px 0 0" }}>
        My Inflation{" "}
        <span style={{ color: "var(--muted)", fontWeight: 400, fontSize: 16 }}>
          the official basket isn&apos;t your basket — reweight it to your life
        </span>
      </h1>
      <div style={{ marginTop: 24 }}>
        <MyInflationClient
          compareMonths={compare.months}
          compareGauge={compare.gauge_yoy_pct}
          gaugeYoy={pulse.gauge.yoy_pct}
          gaugeAsOf={pulse.gauge.as_of}
          states={(geoJson as Geo).states.map((s) => ({
            state: s.state, name: s.name,
            gas_regular: { yoy_pct: s.gas_regular.yoy_pct },
            elec_res_cents: { yoy_pct: s.elec_res_cents.yoy_pct },
          }))}
        />
      </div>
    </div>
  );
}
