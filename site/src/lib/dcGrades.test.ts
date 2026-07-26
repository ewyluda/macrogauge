import { describe, expect, it } from "vitest";
import {
  formatPairedVerdict,
  horizonKey,
  nearestHorizon,
  pairedShortfall,
  WITHHELD_REASON,
} from "./dcGrades";
import type { DcGrades, GradeStat } from "./types";

function stat(shortfall: number): GradeStat {
  return {
    n: 100,
    independent_draws: 8.3,
    shortfall_rate_pct: shortfall,
    mean_shortfall_pp: 4,
    worst_shortfall_pp: 12,
    bias_pp: -1,
    mae_pp: 3,
  };
}

// Real shortfall rates from site/public/data/dc_grades.json (2026-07-26
// publish, spec §2.1a's corrected sample). The strict leg publishes only
// h12/h24 -- published_horizons is the authoritative source for that, not
// the presence/absence of a key under `grades`.
const data = {
  published_at: "2026-07-26T21:54:03Z",
  as_of: "2026-06",
  revision_disclosure_pp: 0.27,
  paired_legs_note: "Two legs, always shown together.",
  anchors: [],
  scenarios: [],
  leadlag: null,
  power_nowcast: null,
  legs: {
    strict: {
      provenance: "vintage-true (ALFRED as-of)",
      span: ["2018-01", "2026-06"],
      anchors_n: 99,
      contains_downturn: false,
      published_horizons: [12, 24],
      grades: {
        long_run: { h12: stat(61.4), h24: stat(75.0) },
        trailing_3yr: { h12: stat(39.8), h24: stat(44.7) },
        current_momentum: { h12: stat(48.9), h24: stat(50.0) },
      },
    },
    extended: {
      provenance: "final-revision throughout",
      span: ["2010-12", "2026-06"],
      anchors_n: 187,
      contains_downturn: true,
      published_horizons: [12, 24, 36, 48],
      grades: {
        long_run: { h12: stat(46.3), h24: stat(53.4), h36: stat(64.2), h48: stat(64.7) },
        trailing_3yr: { h12: stat(40.6), h24: stat(42.9), h36: stat(56.3), h48: stat(66.9) },
        current_momentum: { h12: stat(53.7), h24: stat(53.4), h36: stat(55.0), h48: stat(71.2) },
      },
    },
  },
} as unknown as DcGrades;

describe("horizonKey", () => {
  it("maps months onto the published horizon buckets", () => {
    expect(horizonKey(12)).toBe("h12");
    expect(horizonKey(48)).toBe("h48");
  });
});

describe("nearestHorizon", () => {
  it("snaps an arbitrary delivery window to the nearest graded horizon", () => {
    expect(nearestHorizon(1)).toBe(12);
    expect(nearestHorizon(17)).toBe(12);
    expect(nearestHorizon(19)).toBe(24);
    expect(nearestHorizon(40)).toBe(36);
    expect(nearestHorizon(60)).toBe(48);
  });

  // Correction 2: ties round DOWN -- claiming a longer horizon's grade for a
  // shorter delivery window would borrow a thinner sample than the reader
  // actually faces. Pinned at every exact midpoint between adjacent
  // published horizons, not just one, since the tie-break is coded
  // explicitly rather than relying on scan order.
  it("rounds every exact midpoint down to the shorter horizon", () => {
    expect(nearestHorizon(18)).toBe(12); // midpoint of 12/24
    expect(nearestHorizon(30)).toBe(24); // midpoint of 24/36
    expect(nearestHorizon(42)).toBe(36); // midpoint of 36/48
  });
});

describe("pairedShortfall", () => {
  it("always returns both legs, never one, when both are graded", () => {
    const p = pairedShortfall(data, "long_run", 24);
    expect(p).toEqual({
      strict: { status: "graded", shortfallPct: 75.0 },
      extended: { status: "graded", shortfallPct: 53.4 },
    });
  });

  // Correction 1: the strict leg does not publish h36/h48 at all. That is a
  // deliberate editorial withholding, not an absent measurement, and must
  // render as an explanation -- never collapse into the same shape as
  // "not_gradeable".
  it("marks the strict leg withheld at h36, distinct from not-gradeable", () => {
    const p = pairedShortfall(data, "long_run", 36);
    expect(p.strict).toEqual({ status: "withheld", reason: WITHHELD_REASON });
    expect(p.extended).toEqual({ status: "graded", shortfallPct: 64.2 });
  });

  it("marks the strict leg withheld at h48 too", () => {
    const p = pairedShortfall(data, "trailing_3yr", 48);
    expect(p.strict).toEqual({ status: "withheld", reason: WITHHELD_REASON });
    expect(p.extended).toEqual({ status: "graded", shortfallPct: 66.9 });
  });

  it("returns not_gradeable rather than throwing when a leg is missing entirely", () => {
    const bare = { ...data, legs: {} } as unknown as DcGrades;
    expect(pairedShortfall(bare, "long_run", 24)).toEqual({
      strict: { status: "not_gradeable" },
      extended: { status: "not_gradeable" },
    });
  });

  // A horizon the leg claims to publish (it's in published_horizons) but for
  // which no anchors actually reached that far -- a true absence of
  // measurement, distinct from Correction 1's editorial withholding above.
  it("returns not_gradeable when a published horizon has no gradeable anchors", () => {
    const thin = {
      ...data,
      legs: {
        ...data.legs,
        extended: {
          ...data.legs.extended,
          grades: {
            ...data.legs.extended.grades,
            long_run: { ...data.legs.extended.grades.long_run, h48: null },
          },
        },
      },
    } as unknown as DcGrades;
    const p = pairedShortfall(thin, "long_run", 48);
    expect(p.extended).toEqual({ status: "not_gradeable" });
    // published_horizons still lists 48 for this leg -- confirms this path
    // is reached via a null stat, not via the withheld check.
    expect(thin.legs.extended.published_horizons).toContain(48);
  });
});

describe("formatPairedVerdict", () => {
  it("names both legs and the horizon in one sentence", () => {
    const s = formatPairedVerdict("long_run", 24, {
      strict: { status: "graded", shortfallPct: 75.0 },
      extended: { status: "graded", shortfallPct: 53.4 },
    });
    expect(s).toContain("75.0%");
    expect(s).toContain("53.4%");
    expect(s).toContain("24-month");
  });

  it("says so plainly when neither leg can be graded", () => {
    const s = formatPairedVerdict("long_run", 36, {
      strict: { status: "not_gradeable" },
      extended: { status: "not_gradeable" },
    });
    expect(s).toBe("Not gradeable at a 36-month horizon on either sample.");
  });

  it("never renders one leg alone: not_gradeable leg reads as absence", () => {
    const s = formatPairedVerdict("long_run", 24, {
      strict: { status: "graded", shortfallPct: 75.0 },
      extended: { status: "not_gradeable" },
    });
    expect(s).toContain("75.0%");
    expect(s).toContain("not gradeable");
  });

  // The load-bearing distinction from Correction 1: a withheld leg must NOT
  // read as "not gradeable" -- it renders the editorial explanation instead,
  // and the other leg's real figure still appears alongside it.
  it("never renders one leg alone: withheld leg reads as an explanation, not an absence", () => {
    const s = formatPairedVerdict("long_run", 36, pairedShortfall(data, "long_run", 36));
    expect(s).toContain("64.2%");
    expect(s).toContain(WITHHELD_REASON);
    expect(s).not.toContain("not gradeable");
  });
});
