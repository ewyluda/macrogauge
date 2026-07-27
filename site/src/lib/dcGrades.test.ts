import { describe, expect, it } from "vitest";
import {
  escalationGradeSlice,
  formatHorizonList,
  formatPairedVerdict,
  horizonKey,
  nearestHorizon,
  pairedBasisMeans,
  pairedShortfall,
  pickBestMae,
  pickWorstShortfall,
  sharedHorizons,
  WITHHELD_REASON,
  type LegPick,
  type PairedBasisMeans,
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

// ---------------------------------------------------------------------------
// Cross-horizon means -- the paired-legs rule applied to AGGREGATES
// ---------------------------------------------------------------------------

function statMS(shortfall: number, mae: number): GradeStat {
  return { ...stat(shortfall), mae_pp: mae };
}

describe("sharedHorizons", () => {
  it("intersects published_horizons rather than assuming the strict pair", () => {
    expect(sharedHorizons([data.legs.strict, data.legs.extended])).toEqual([12, 24]);
    // computed, not hardcoded: widen the strict leg and the shared set widens
    const wide = { ...data.legs.strict, published_horizons: [12, 24, 36, 48] };
    expect(sharedHorizons([wide, data.legs.extended])).toEqual([12, 24, 36, 48]);
  });

  it("falls back to the single leg's own horizons when only one is present", () => {
    expect(sharedHorizons([data.legs.extended])).toEqual([12, 24, 36, 48]);
    expect(sharedHorizons([])).toEqual([]);
  });
});

describe("pairedBasisMeans", () => {
  // The defect this exists to prevent: the strict leg averaged over h12/h24
  // while the extended leg averaged over h12/h24/h36/h48, printed side by
  // side as though comparable. Constructed so the two disagree loudly --
  // extended h36/h48 are far below its h12/h24 -- so a regression cannot
  // hide inside rounding.
  const legs = {
    strict: {
      ...data.legs.strict,
      grades: { long_run: { h12: statMS(60, 4), h24: statMS(80, 6) } },
    },
    extended: {
      ...data.legs.extended,
      grades: {
        long_run: {
          h12: statMS(40, 3),
          h24: statMS(60, 5),
          h36: statMS(0, 1),
          h48: statMS(0, 1),
        },
      },
    },
  };
  const paired = { legs } as unknown as DcGrades;

  it("averages BOTH legs over the intersection of their published horizons", () => {
    const [row] = pairedBasisMeans(paired);
    expect(row.horizons).toEqual([12, 24]);
    expect(row.strict).toEqual({ meanShortfall: 70, meanMae: 5 });
    // 50, not (40+60+0+0)/4 = 25: the extended leg's h36/h48 are excluded
    // because the strict leg has no counterpart there.
    expect(row.extended).toEqual({ meanShortfall: 50, meanMae: 4 });
  });

  it("drops a horizon where either leg has no stat, on both sides at once", () => {
    const holed = {
      legs: {
        strict: legs.strict,
        extended: {
          ...legs.extended,
          grades: { long_run: { ...legs.extended.grades.long_run, h24: null } },
        },
      },
    } as unknown as DcGrades;
    const [row] = pairedBasisMeans(holed);
    expect(row.horizons).toEqual([12]);
    expect(row.strict).toEqual({ meanShortfall: 60, meanMae: 4 });
    expect(row.extended).toEqual({ meanShortfall: 40, meanMae: 3 });
  });

  it("reports the single present leg, and nulls the absent one", () => {
    const only = { legs: { extended: legs.extended } } as unknown as DcGrades;
    const [row] = pairedBasisMeans(only);
    expect(row.horizons).toEqual([12, 24, 36, 48]);
    expect(row.strict).toBeNull();
    expect(row.extended?.meanShortfall).toBe(25);
  });

  it("returns nothing rather than throwing on a degraded artifact", () => {
    expect(pairedBasisMeans({ legs: {} } as unknown as DcGrades)).toEqual([]);
  });

  it("agrees with the real fixture's h12/h24 figures for every basis", () => {
    const rows = pairedBasisMeans(data);
    expect(rows.map((r) => r.basis)).toEqual([
      "long_run",
      "trailing_3yr",
      "current_momentum",
    ]);
    const longRun = rows[0];
    expect(longRun.horizons).toEqual([12, 24]);
    expect(longRun.strict?.meanShortfall).toBeCloseTo((61.4 + 75.0) / 2, 6);
    expect(longRun.extended?.meanShortfall).toBeCloseTo((46.3 + 53.4) / 2, 6);
  });
});

describe("formatHorizonList", () => {
  it("spells out the horizon set a mean covers", () => {
    expect(formatHorizonList([12, 24])).toBe("12- and 24-month");
    expect(formatHorizonList([12])).toBe("12-month");
    expect(formatHorizonList([12, 24, 36, 48])).toBe("12-, 24-, 36- and 48-month");
  });
});

describe("escalationGradeSlice", () => {
  // /escalation is a static page: whatever crosses into its client component
  // is serialized into escalation.html. The slice must carry the legs and
  // NOTHING else -- notably not the 286-row anchors array.
  it("carries the legs and drops everything else", () => {
    const slice = escalationGradeSlice({
      ...data,
      anchors: [{ m: "2026-06", leg: "extended", bases: {}, realized: {} }],
    } as unknown as DcGrades);
    expect(Object.keys(slice)).toEqual(["legs"]);
    expect(slice.legs).toBe(data.legs);
  });

  it("still satisfies pairedShortfall, the only accessor it feeds", () => {
    const slice = escalationGradeSlice(data);
    expect(pairedShortfall(slice, "long_run", 24)).toEqual({
      strict: { status: "graded", shortfallPct: 75.0 },
      extended: { status: "graded", shortfallPct: 53.4 },
    });
  });
});

describe("pickBestMae / pickWorstShortfall", () => {
  // Rankings are PER LEG: the two legs can crown different bases, and a
  // "both samples" claim is only honest when both legs' own picks agree.
  // The inversion section once derived exactly that claim from the strict
  // leg's pick alone -- true on the day's data, computed on neither.
  const rows: PairedBasisMeans[] = [
    {
      basis: "long_run",
      horizons: [12, 24],
      strict: { meanMae: 1.0, meanShortfall: 70 },
      extended: { meanMae: 3.0, meanShortfall: 50 },
    },
    {
      basis: "trailing_3yr",
      horizons: [12, 24],
      strict: { meanMae: 2.0, meanShortfall: 40 },
      extended: { meanMae: 2.5, meanShortfall: 60 },
    },
  ];
  const strictOf: LegPick = (r) => r.strict;
  const extendedOf: LegPick = (r) => r.extended;

  it("ranks each leg independently -- the legs can disagree", () => {
    expect(pickBestMae(rows, strictOf)?.basis).toBe("long_run");
    expect(pickBestMae(rows, extendedOf)?.basis).toBe("trailing_3yr");
    expect(pickWorstShortfall(rows, strictOf)?.basis).toBe("long_run");
    expect(pickWorstShortfall(rows, extendedOf)?.basis).toBe("trailing_3yr");
  });

  it("agrees across legs only when both legs' own picks agree", () => {
    // Same fixture, extended flipped so both legs crown long_run: only now
    // may a caller render a claim that spans both samples.
    const agreeing = rows.map((r) =>
      r.basis === "long_run"
        ? { ...r, extended: { meanMae: 2.0, meanShortfall: 50 } }
        : r,
    );
    expect(pickBestMae(agreeing, strictOf)?.basis).toBe(
      pickBestMae(agreeing, extendedOf)?.basis,
    );
    expect(pickBestMae(rows, strictOf)?.basis).not.toBe(
      pickBestMae(rows, extendedOf)?.basis,
    );
  });

  it("skips rows that do not carry the leg, and returns null when none do", () => {
    const oneLegged: PairedBasisMeans[] = [
      { basis: "long_run", horizons: [12], strict: null, extended: { meanMae: 1, meanShortfall: 10 } },
    ];
    expect(pickBestMae(oneLegged, strictOf)).toBeNull();
    expect(pickBestMae(oneLegged, extendedOf)?.basis).toBe("long_run");
    expect(pickWorstShortfall([], strictOf)).toBeNull();
  });
});
