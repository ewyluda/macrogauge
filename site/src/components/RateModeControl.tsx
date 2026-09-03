"use client";
import { SegmentedControl } from "./SegmentedControl";
import { CopyLink } from "./CopyLink";
import { RATE_MODES, type RateMode } from "@/lib/momentum";
import { codecs } from "@/lib/urlState";
import { useUrlState } from "@/lib/useUrlState";

const RATE_CODEC = codecs.enumOf(RATE_MODES.map((m) => m.key));

/** Shared `?rate=` state for every chart that can show YoY or an
 *  annualized 3m/6m momentum: one key, so a link carries the same view
 *  across the hero, /vs-bls, /cost-of-living and /supercore. */
export function useRateMode(): [RateMode, (m: RateMode) => void] {
  return useUrlState<RateMode>("rate", "yoy", RATE_CODEC);
}

export function RateModeControl({
  value,
  onChange,
  note,
}: {
  value: RateMode;
  onChange: (m: RateMode) => void;
  note?: string;
}) {
  return (
    <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", margin: "4px 0 8px" }}>
      <SegmentedControl options={RATE_MODES} value={value} onChange={onChange} />
      <CopyLink />
      {value !== "yoy" && (
        <span style={{ fontSize: 11, color: "var(--muted)" }}>
          {note ?? "annualized off the daily index — amplifies noise (3m ≈ ×4); official prints shown as YoY only"}
        </span>
      )}
    </div>
  );
}
