import { describe, expect, it } from "vitest";
import newsJson from "../../public/data/news.json";
import type { NewsPost } from "./news";
import {
  clusterStories, figures, infraScore, isAllCaps, isInfra, noiseReason, sameStory, storyLayerCounts, storyMatches,
  storyTickerCounts, topFigures,
} from "./newsTape";

let n = 0;
const post = (headline: string, over: Partial<NewsPost> = {}): NewsPost => ({
  id: `p${++n}`, ts: "2026-10-06T12:00:00Z", category: "company", kind: "text", headline,
  points: [{ label: "Detail", text: "Supporting detail." }],
  tickers: [{ ticker: "NVDA", layer: "AI Compute" }], impacted: [], url: null, has_media: false, ...over,
});

// Headlines below are real posts from the tape (2026-09-30 .. 10-07).
describe("noiseReason", () => {
  it("flags posts that carry no story", () => {
    expect(noiseReason(post("$MU 1065C 10/9/2026 for $7.1M"))).toBe("options flow");
    expect(noiseReason(post("Here's a full recap:"))).toBe("recap");
    expect(noiseReason(post("Latest episode of Basis Points"))).toBe("recap");
    expect(noiseReason(post("Bank of America named $NVDA Nvidia, $INTC Intel and $MU Micron as its top semiconductor picks"))).toBe("roundup");
    expect(noiseReason(post("Nike ($NKE) fell more than 10% premarket after a revenue miss, while onsemi ($ON) and Synaptics ($SYNA) rose"))).toBe("roundup");
    expect(noiseReason(post("AI, semiconductors & technology"))).toBe("stub");
    const many = Array.from({ length: 9 }, (_, i) => ({ ticker: `T${i}`, layer: "AI Compute" }));
    expect(noiseReason(post("Analysts moved a dozen names across chips and power", { tickers: many }))).toBe("roundup");
  });

  it("keeps a single company's market move and a short headline that names something", () => {
    expect(noiseReason(post("$VRT Vertiv stock rose 8% premarket after winning a 1 GW liquid-cooling order"))).toBeNull();
    expect(isInfra(post("$VRT Vertiv stock rose 8% premarket after winning a 1 GW liquid-cooling order"))).toBe(true);
    expect(noiseReason(post("Micron raises HBM guidance"))).toBeNull();
    expect(noiseReason(post("AI, semiconductors & technology"))).toBe("stub");
  });

  it("leaves real stories alone, including six-ticker deals", () => {
    const six = ["AMZN", "CEG", "GOOGL", "MSFT", "TLN", "VST"].map((t) => ({ ticker: t, layer: "Power & Grid" }));
    expect(noiseReason(post("$GOOGL Google and $CEG Constellation Energy agreed to add 890 MW of nuclear capacity by upgrading 11 existing plants", { tickers: six }))).toBeNull();
    expect(noiseReason(post("US TO OFFER $4 BILLION LOAN FOR $VST VISTRA TO BOOST NUCLEAR OUTPUT", { points: [] }))).toBeNull();
  });
});

describe("infraScore / isInfra", () => {
  it("keeps the build-out: capacity, power, chips, financing", () => {
    for (const h of [
      "$CRWV CoreWeave plans to enter India with 240 MW of AI data-center capacity at AdaniConneX's Taloja campus",
      "SPACEX SAID TO SEEK $40BN FINANCING LED BY APOLLO FOR NVIDIA CHIPS - FT",
      "$ORCL ORACLE WILL TAKE ON ABOUT $300 MILLION IN POINT BEACH ENERGY EXPENSES TO COMPLETELY FINANCE PROJECT LIGHTHOUSE ENERGY COSTS.",
      "Tencent signed a five-year lease with $ORCL Oracle for access to about 100,000 advanced AI chips across Southeast Asian data centers",
    ]) expect(isInfra(post(h)), h).toBe(true);
  });

  it("drops consumer, app and analyst-call posts that share the universe's tickers", () => {
    for (const h of [
      "$GOOGL Google and $U Unity announced a strategic AI gaming partnership centered on Playground",
      "XREAL priced its AURA spatial-computing glasses from $1,279, combining Android XR and $GOOGL Google Gemini",
      "$GOOGL Alphabet's Waymo increased its inaugural private-debt financing to $5 billion as the robotaxi company raises capital",
      "$META Meta and Sierra are developing an open Personal Agent Protocol to standardize how personal AI agents interact",
      "$META Meta remains an Overweight at Wells Fargo, which raised its price target to $1,000 from $796",
      "Anthropic is expanding its Cyber Verification Program and using $MSFT Microsoft Foundry to deliver Claude capabilities",
    ]) expect(isInfra(post(h, { points: [] })), h).toBe(false);
  });

  it("scores consumer terms below zero even beside a chip mention", () => {
    expect(infraScore(post("Google has increased Pixel 10a prices by $100 as memory and storage constraints raise device costs", { points: [] }))).toBeLessThan(2);
  });
});

describe("figures", () => {
  it("reads capacity and deal dollars from the headline", () => {
    expect(figures(post("$APLD Applied Digital secured access to up to 1 GW of power capacity in Finland"))).toEqual([
      { kind: "capacity", value: 1000, label: "1 GW" },
    ]);
    expect(figures(post("Wall Street banks are launching a record $60 billion financing package to fund $AVGO Broadcom AI chips")))
      .toEqual([{ kind: "dollars", value: 60e9, label: "$60B" }]);
    expect(figures(post("SPACEX SAID TO SEEK $40BN FINANCING LED BY APOLLO FOR NVIDIA CHIPS"))[0].value).toBe(40e9);
  });

  it("reads the month May as a month, not a forecast", () => {
    expect(figures(post("$APLD Applied Digital energized 200 MW at Polaris Forge in May"))).toEqual([
      { kind: "capacity", value: 200, label: "200 MW" },
    ]);
    expect(figures(post("$APLD Applied Digital may add 200 MW at Polaris Forge"))).toEqual([]);
  });

  it("ignores forecasts, revenue targets and the supporting detail", () => {
    expect(figures(post("$AMZN Amazon Web Services could more than double revenue from $129B in 2025 to $334B by 2028"))).toEqual([]);
    expect(figures(post("$MRVL Marvell raised its growth ambitions, targeting $70B–$90B of FY31 revenue"))).toEqual([]);
    expect(figures(post("Some lenders want stronger guarantees for loans backed by $NVDA Nvidia chips",
      { points: [{ label: null, text: "Nvidia has $500 billion of loans in view." }] }))).toEqual([]);
  });
});

describe("clusterStories", () => {
  const crwv = [{ ticker: "CRWV", layer: "Cloud Delivery" }];
  const a = post("$CRWV CoreWeave plans to enter India with 240 MW of AI data-center capacity at AdaniConneX's Taloja campus",
    { ts: "2026-10-07T12:08:00Z", tickers: crwv });
  const b = post("$CRWV CoreWeave is entering India with its first data centers, taking 240 MW at AdaniConneX's Taloja campus",
    { ts: "2026-10-07T11:37:00Z", tickers: crwv });
  const flash = post("COREWEAVE TO ENTER INDIA WITH 240 MW AT ADANICONNEX TALOJA CAMPUS", { ts: "2026-10-07T12:30:00Z", tickers: crwv, points: [] });
  const other = post("$CRWV CoreWeave said its NVIDIA Vera Rubin NVL72 system is now available", { ts: "2026-10-07T10:00:00Z", tickers: crwv });

  it("collapses repeats of one story behind its newest detailed post", () => {
    const stories = clusterStories([flash, a, b, other]);
    expect(stories).toHaveLength(2);
    expect(stories[0].lead).toBe(a); // prose with detail beats the newer capitals flash
    expect(stories[0].also).toEqual([flash, b]);
    expect(stories[0].latest).toBe(flash.ts);
    expect(stories[0].infra).toBe(true);
  });

  it("never merges across tickers, outside the window, or through a recap", () => {
    expect(sameStory(a, { ...b, tickers: [{ ticker: "NBIS", layer: "Cloud Delivery" }] })).toBe(false);
    expect(sameStory(a, { ...b, ts: "2026-10-01T00:00:00Z" })).toBe(false);
    const recap = post("Here's a full recap:", { tickers: crwv, points: [{ label: null, text: "CoreWeave took 240 MW in India." }] });
    expect(sameStory(a, recap)).toBe(false);
  });

  it("judges relevance per story, so a terse flash rides with its story", () => {
    const s = clusterStories([flash, a]);
    expect(isInfra(flash)).toBe(true);
    expect(s).toHaveLength(1);
  });

  it("on the published tape: fewer stories than posts, no recap leads an infra story", () => {
    const posts = newsJson.posts as NewsPost[];
    const stories = clusterStories(posts);
    expect(stories.length).toBeLessThanOrEqual(posts.length);
    expect(stories.reduce((k, s) => k + 1 + s.also.length, 0)).toBe(posts.length);
    for (const s of stories.filter((x) => x.infra)) expect(noiseReason(s.lead)).toBeNull();
  });
});

describe("topFigures", () => {
  it("takes each story's first figure, largest first", () => {
    const s = clusterStories([
      post("$CRWV CoreWeave takes 240 MW in India with an option to expand to 480 MW", { tickers: [{ ticker: "CRWV", layer: "Cloud Delivery" }] }),
      post("$APLD Applied Digital secured access to up to 1 GW of power capacity in Finland", { tickers: [{ ticker: "APLD", layer: "DC Real Estate" }] }),
    ]);
    expect(topFigures(s, "capacity", 5).map((r) => r.figure.label)).toEqual(["1 GW", "240 MW"]);
  });
});

describe("isAllCaps", () => {
  it("spots wire flashes but not cashtags in prose", () => {
    expect(isAllCaps("NVIDIA SHARES RISE 2.7% TO HIT FIRST RECORD HIGH SINCE MAY")).toBe(true);
    expect(isAllCaps("$NVDA Nvidia shares rose 2.7% to a record")).toBe(false);
  });
});

describe("story filters and counts", () => {
  const nv = { ticker: "NVDA", layer: "AI Compute" };
  const vst = { ticker: "VST", layer: "Power & Grid" };
  const stories = clusterStories([
    post("$VST Vistra signs 1 GW nuclear power agreement for a data center campus", { tickers: [vst], ts: "2026-10-06T14:00:00Z" }),
    post("$NVDA Nvidia ships Rubin racks to a 300 MW AI campus", { tickers: [nv, vst], ts: "2026-10-06T13:00:00Z" }),
    post("$NVDA Nvidia expands HBM supply agreements for Blackwell GPUs", { tickers: [nv], ts: "2026-10-05T13:00:00Z" }),
  ]);
  it("matches a story by any of its posts' tickers and layers", () => {
    expect(stories.filter((s) => storyMatches(s, { layer: "Power & Grid", ticker: null }))).toHaveLength(2);
    expect(stories.filter((s) => storyMatches(s, { layer: "Power & Grid", ticker: "NVDA" }))).toHaveLength(1);
  });
  it("counts stories, not posts", () => {
    expect(storyTickerCounts(stories)).toEqual([["NVDA", 2], ["VST", 2]]);
    expect(storyLayerCounts(stories, ["AI Compute", "Power & Grid", "Cooling"])).toEqual([["AI Compute", 2], ["Power & Grid", 2]]);
  });
});

// Cases from the 2026-10-07 PR #60 review (docs/reviews/2026-10-07-pr-60-review.md).
// Microsoft headlines below are CONTROLLED examples, not real announcements.
describe("review 2026-10-07 — story identity, lead, figures", () => {
  const msft = [{ ticker: "MSFT", layer: "Cloud Delivery" }];
  const m = (headline: string, ts: string, over: Partial<NewsPost> = {}) => post(headline, { tickers: msft, ts, ...over });

  it("F1: a shared amount alone doesn't make two events one story", () => {
    const power = m("$MSFT Microsoft signed a $5 billion nuclear electricity contract with a utility", "2026-10-06T12:00:00Z");
    const cyber = m("$MSFT Microsoft agreed a $5 billion cybersecurity acquisition", "2026-10-06T15:00:00Z");
    expect(sameStory(power, cyber)).toBe(false);
  });

  it("F1: different capacities are different events, however similar the wording", () => {
    const tx = m("$MSFT Microsoft opens 200 MW data center in Texas", "2026-10-06T12:00:00Z");
    const fi = m("$MSFT Microsoft opens 900 MW data center in Finland", "2026-10-06T13:00:00Z");
    expect(sameStory(tx, fi)).toBe(false);
    expect(clusterStories([fi, tx])).toHaveLength(2);
  });

  it("F2: a newer reversal leads, and its story leaves the numbers strip", () => {
    const deal = m("$MSFT Microsoft secured a 500 MW nuclear power agreement with Constellation", "2026-10-06T12:00:00Z");
    const off = m("MICROSOFT CANCELS 500 MW NUCLEAR POWER AGREEMENT WITH CONSTELLATION", "2026-10-07T09:00:00Z", { points: [] });
    const [story] = clusterStories([off, deal]);
    expect(story.lead).toBe(off);
    expect(story.also).toEqual([deal]);
    expect(topFigures([story], "capacity", 4)).toEqual([]);
  });

  it("F4: grouped thousands with a decimal parse whole", () => {
    expect(figures(m("$MSFT Microsoft signed for 1,250.5 MW of capacity in Virginia", "2026-10-06T12:00:00Z"))).toEqual([
      { kind: "capacity", value: 1250.5, label: "1.25 GW" },
    ]);
    expect(figures(m("$MSFT Microsoft signed for 2,500 MW in Ohio", "2026-10-06T12:00:00Z"))[0].value).toBe(2500);
  });

  it("F5: revenue and valuation amounts are not deal dollars", () => {
    expect(figures(m("$MSFT Microsoft reported $100 billion of revenue and signed a $5 billion data center financing deal", "2026-10-06T12:00:00Z")))
      .toEqual([{ kind: "dollars", value: 5e9, label: "$5B" }]);
    // real tape headline
    expect(figures(post("AI infrastructure provider Lambda is seeking up to $4 billion in a Blackstone- and Coatue-led funding round at a $14.5 billion pre-money valuation")))
      .toEqual([{ kind: "dollars", value: 4e9, label: "$4B" }]);
  });

  it("F6: contract dates and the noun 'project' are not forecasts", () => {
    // real tape headline (Black Hills / Google, 2026-10-06)
    const bkh = post("$BKH Black Hills signed definitive agreements through 2048 to supply power for $GOOGL Google's planned Cheyenne, Wyoming data center, including up to 590 MW of grid service and management of roughly 2.1 GW of third-party resources.");
    expect(figures(bkh).map((f) => f.value)).toEqual([590, 2100]);
    expect(figures(m("$MSFT Microsoft completed its 500 MW Quincy project", "2026-10-06T12:00:00Z"))[0].value).toBe(500);
  });

  it("F7: a short headline-only flash that names something is not a stub", () => {
    expect(noiseReason(post("NVIDIA HALTS GPU SHIPMENTS", { points: [] }))).toBeNull();
    expect(noiseReason(post("AI, semiconductors & technology", { points: [] }))).toBe("stub");
  });

  it("F9: a chain of matches can't stretch a story past the window", () => {
    const h = "$MSFT Microsoft expands its Wisconsin AI data center campus with Fairwater";
    const stories = clusterStories([
      m(h, "2026-10-07T12:00:00Z"), m(h, "2026-10-04T12:00:00Z"), m(h, "2026-10-01T12:00:00Z"),
    ]);
    for (const s of stories) {
      const ts = [s.lead, ...s.also].map((p) => Date.parse(p.ts));
      expect(Math.max(...ts) - Math.min(...ts)).toBeLessThanOrEqual(96 * 3_600_000);
    }
    expect(stories).toHaveLength(2);
  });

  it("F10: 'may' is a forecast in any case; the month May is not", () => {
    for (const h of ["MICROSOFT MAY ADD 500 MW OF DATA CENTER CAPACITY IN TEXAS",
      "$MSFT Microsoft may add 500 MW in Texas", "$MSFT Microsoft May Add 500 MW In Texas"]) {
      expect(figures(m(h, "2026-10-06T12:00:00Z")), h).toEqual([]);
    }
    for (const h of ["$MSFT Microsoft energized 500 MW in May", "MICROSOFT ENERGIZED 500 MW IN MAY",
      "$MSFT Microsoft energized 500 MW on May 12"]) {
      expect(figures(m(h, "2026-10-06T12:00:00Z")).map((f) => f.value), h).toEqual([500]);
    }
  });
});

describe("topFigures — one row per deal", () => {
  it("shows a figure repeated by the same company once, at its newest story", () => {
    const avgo = [{ ticker: "AVGO", layer: "AI Compute" }];
    const early = post("Broadcom ($AVGO) and its banking syndicate are beginning efforts to arrange approximately $60 billion for Anthropic",
      { tickers: avgo, ts: "2026-10-02T12:03:00Z" });
    const late = post("Wall Street banks are launching a record $60 billion financing package to fund $AVGO Broadcom AI chips",
      { tickers: avgo, ts: "2026-10-05T21:05:00Z" });
    const rows = topFigures([{ lead: late, also: [], latest: late.ts, infra: true }, { lead: early, also: [], latest: early.ts, infra: true }], "dollars", 4);
    expect(rows).toHaveLength(1);
    expect(rows[0].story.lead).toBe(late);
  });
});

describe("audit F6–F8 (docs/reviews/2026-10-08-pr-54-70-review-coverage-audit.md)", () => {
  const msft = [{ ticker: "MSFT", layer: "Cloud Delivery" }];
  const at = (ts: string) => ({ ts, tickers: msft, points: [] });

  it("F6: a sentence-case flash with a subject and an action is a story, like its capitals twin", () => {
    for (const h of ["Nvidia halts chip shipments", "Microsoft cancels nuclear power agreement"]) {
      expect(noiseReason(post(h, { points: [] })), h).toBeNull();
      expect(noiseReason(post(h.toUpperCase(), { points: [] })), h).toBeNull();
    }
    expect(isInfra(post("Nvidia halts chip shipments", { points: [] }))).toBe(true);
    // a section title is still a stub: a comma/ampersand list, no act
    expect(noiseReason(post("AI, semiconductors & technology", { points: [] }))).toBe("stub");
    expect(noiseReason(post("Market update", { points: [] }))).toBe("stub");
  });

  it("F7: equal-capacity campuses in different named places stay separate; a rewrite of one site still folds", () => {
    const tx = post("Microsoft opens 500 MW data center in Texas", { id: "tx", ...at("2026-10-07T12:00:00Z") });
    const fi = post("Microsoft opens 500 MW data center in Finland", { id: "fi", ...at("2026-10-07T12:00:00Z") });
    expect(sameStory(tx, fi)).toBe(false);
    expect(clusterStories([tx, fi])).toHaveLength(2);
    const txNoFig = post("Microsoft opens new data center campus in Texas", { id: "a", ...at("2026-10-07T12:00:00Z") });
    const fiNoFig = post("Microsoft opens new data center campus in Finland", { id: "b", ...at("2026-10-07T12:00:00Z") });
    expect(clusterStories([txNoFig, fiNoFig])).toHaveLength(2);
    const rewrite = post("Microsoft's new 500 MW data center in Texas opens, Bloomberg reports", { id: "tx2", ...at("2026-10-07T13:00:00Z") });
    expect(sameStory(tx, rewrite)).toBe(true);
    // real posts (2026-10-06): one deal told twice, naming different
    // counterparty words but no conflicting place, still folds into one story
    const goog = [{ ticker: "CEG", layer: "Power & Grid" }, { ticker: "GOOGL", layer: "Cloud Delivery" }];
    const g1 = post("$GOOGL Google and $CEG Constellation Energy agreed to add 890 MW of nuclear capacity by upgrading 11 existing plants, highlighting a faster and cheaper path for Big Tech to secure power for expanding data-center demand.",
      { id: "g1", ts: "2026-10-06T15:44:40Z", tickers: goog });
    const g2 = post("$GOOGL Alphabet is nearing a multi-year deal worth at least $1 billion with $CEG Constellation Energy for nuclear power, as Google secures electricity for expanding AI data-center demand.",
      { id: "g2", ts: "2026-10-06T12:03:40Z", tickers: goog });
    expect(clusterStories([g1, g2])).toHaveLength(1);
  });

  it("F8: two same-day equal-dollar deals both make the strip; one deal reported on two days shows once", () => {
    const duke = post("Microsoft signs $5 billion contract with Duke Energy for nuclear electricity", { id: "d", ...at("2026-10-07T12:00:00Z") });
    const fab = post("Microsoft acquires chipmaking startup for $5 billion to expand semiconductor fabrication", { id: "f", ...at("2026-10-07T12:00:00Z") });
    const stories = clusterStories([duke, fab]);
    expect(stories).toHaveLength(2);
    expect(topFigures(stories, "dollars", 4)).toHaveLength(2);
    // the Broadcom case: the same $60B package on Oct 2 and Oct 5 stays one row
    const avgo = [{ ticker: "AVGO", layer: "AI Compute" }];
    const early = post("Broadcom ($AVGO) and its banking syndicate are beginning efforts to arrange approximately $60 billion for Anthropic",
      { id: "e", ts: "2026-10-02T14:00:00Z", tickers: avgo });
    const late = post("Wall Street banks are launching a record $60 billion financing package to fund $AVGO Broadcom AI chips",
      { id: "l", ts: "2026-10-05T14:00:00Z", tickers: avgo });
    expect(topFigures(clusterStories([late, early]), "dollars", 4)).toHaveLength(1);
  });
});
