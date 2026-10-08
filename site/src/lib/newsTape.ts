import { etDayKey, type NewsPost } from "./news";

/** Editorial pass over the AI-infra news tape, applied in the browser to
 *  whichever feed the page shows (the baked snapshot or the live object), so
 *  both get identical treatment and nothing upstream changes:
 *
 *   1. noiseReason — posts that carry no story at all (options-flow prints,
 *      multi-stock recaps and roundups, headline-only stubs).
 *   2. infraScore — keyword rules, not a model: strong infrastructure terms
 *      (capacity, power, chips and memory supply, data centers) and weaker
 *      money/contract terms, minus consumer, app and analyst-call topics.
 *   3. clusterStories — one row per story: posts within STORY_WINDOW_H that
 *      share a ticker and either a figure ("240 MW", "$40 billion") or most of
 *      their wording collapse behind the most detailed post. Relevance is
 *      judged per STORY (any member clears the threshold), so a terse wire
 *      flash stays with the fuller post it repeats. Stories under the
 *      threshold stay one click away under "Everything".
 *   4. figures — the capacity and deal-dollar figures a post states, for the
 *      "biggest numbers" strip. Verbatim from the post, never inferred, and
 *      never from a sentence that forecasts or estimates.
 *
 *  Every rule is a pure function of the post text, unit-tested against real
 *  posts in newsTape.test.ts. */

export const INFRA_THRESHOLD = 2;
export const STORY_WINDOW_H = 96;

const text = (p: NewsPost) => [p.headline, ...p.points.map((x) => x.text)].join(" ");
const letters = (s: string) => s.replace(/[^A-Za-z]/g, "");

/** A headline written in capitals (wire flash style). */
export function isAllCaps(s: string): boolean {
  const l = letters(s.replace(/\$[A-Z.]+/g, ""));
  return l.length >= 12 && l === l.toUpperCase();
}

const OPTIONS_FLOW = /^\$?[A-Z.]{1,6}\s+\d+(?:\.\d+)?[CP]\s+\d{1,2}\/\d{1,2}\/\d{2,4}\b/;
const RECAP = /^(here'?s (a|the) (full )?recap|latest episode|market close|premarket movers)/i;
// Lists of names: a roundup whatever else the headline says.
const ROUNDUP_LIST = /\b(top (semiconductor )?picks?|buy-rated stocks|upgrades, downgrades|premarket mov\w+)\b/i;
// Market-move phrasing: a roundup only when the headline names several
// companies — "Vertiv stock rose 8% after a 1 GW order" is a story.
const MARKET_MOVE = /\b(premarket|stocks? (rose|fell|gained|declined)|shares? (rose|fell|gained|declined))\b/i;
const CASHTAG = /\$[A-Z]{1,6}\b/g;
// What a company DOES in a short flash: a deal or build verb (reversals are
// REVERSAL, below). With a capitalised first word and no list punctuation,
// a headline like "Nvidia halts chip shipments" names a subject and an act.
const ACTION = /\b(?:sign\w*|acquir\w*|buy\w*|bought|rais\w*|cut\w*|win\w*|won|launch\w*|open\w*|expand\w*|announc\w*|invest\w*|plan\w*|build\w*|built|order\w*|agree\w*|partner\w*|deliver\w*|ship\w*|award\w*)\b/i;

/** Why a post is not a story, or null when it is one. */
export function noiseReason(p: NewsPost): "options flow" | "recap" | "roundup" | "stub" | null {
  const h = p.headline.trim();
  if (OPTIONS_FLOW.test(h)) return "options flow";
  if (RECAP.test(h)) return "recap";
  const names = Math.max(p.tickers.length, (h.match(CASHTAG) ?? []).length);
  if (p.tickers.length >= 9 || ROUNDUP_LIST.test(h) || (MARKET_MOVE.test(h) && names >= 3)) return "roundup";
  const words = h.split(/\s+/).filter(Boolean);
  // A section title ("AI, semiconductors & technology") names nothing: no
  // figure, no cashtag, no proper noun after its first word. A short headline
  // that does ("Micron raises HBM guidance") is a story.
  // The same test applies to headline-only posts, so a short wire flash that
  // names a company and an action ("NVIDIA HALTS GPU SHIPMENTS") stays.
  // A sentence-case flash ("Microsoft cancels nuclear power agreement") has
  // its only proper noun FIRST, so it also counts when the first word is
  // capitalised, the headline is not a comma/ampersand list (section titles
  // are) and it states an action (audit F6).
  const subjectActs = /^[A-Z]/.test(words[0] ?? "") && !/[,&]/.test(h) && (REVERSAL.test(h) || ACTION.test(h));
  const namesSomething = /\d|\$[A-Z]/.test(h) || words.slice(1).some((w) => /^[A-Z]/.test(w)) || subjectActs;
  if (!namesSomething && (words.length < 5 || (p.points.length === 0 && words.length < 8))) return "stub";
  return null;
}

// Strong: the physical build-out and its supply chain.
const STRONG: RegExp[] = [
  /\b\d[\d.,]*\s?(?:mw|gw|megawatts?|gigawatts?)\b/i,
  /\bdata[- ]?cent(?:er|re)s?\b/i,
  /\b(?:campus|colocation|hyperscale(?:r|rs)?|critical it)\b/i,
  /\b(?:nuclear|atomic power|uprates?|power (?:purchase|supply|capacity|agreement|plants?)|ppa|grid|interconnect(?:ion)?|substations?|transformers?|turbines?|gensets?|fuel cells?|utility|utilities|electricity|energy (?:costs?|expenses|supply|capacity|infrastructure))\b/i,
  /\b(?:gpus?|accelerators?|tpus?|hbm|dram|nand|memory (?:shortage|supply|demand|prices?|bit)|wafers?|fabs?|(?<!microsoft )foundry|cleanrooms?|packaging|cowos|burn-in|lithography|chipmaking)\b/i,
  /\b(?:servers?|racks?|nvl72|blackwell|rubin|vera|ai factory|ai cloud|inference capacity|compute capacity|computing capacity)\b/i,
  /\b(?:liquid cooling|cooling|thermal)\b/i,
  /\b(?:ai chips?|chips?|semiconductors?|custom silicon|asics?)\b/i,
];
// Weak: money and contracts — infra-relevant only beside a strong term.
const WEAK: RegExp[] = [
  /\b(?:capex|capital spending|capital expenditures?)\b/i,
  /\b(?:financing|debt|loans?|credit facility|spv|bonds?|lease(?:s|back)?|leasing)\b/i,
  /\b(?:backlog|orders?|book-to-bill|contracted|supply agreement|multi-year deal)\b/i,
  /\b(?:supply chain|shortage|constrained|capacity)\b/i,
];
// Consumer and app topics that share tickers with the infra universe (−3).
const OFF_TOPIC: RegExp[] = [
  /\b(?:gaming|xbox|playstation|grand theft auto|gta)\b/i,
  /\b(?:glasses|spatial[- ]computing|headsets?|smartphones?|iphone|pixel \d|wi-?fi|cameras?)\b/i,
  /\b(?:robotaxi|waymo|airbnb|shopping|retailers?|e-?commerce)\b/i,
  /\b(?:agent protocol|personal agents?|ai assistant|chatbot|startup accelerator|testify|lawmakers|extinction|safety proof)\b/i,
];
// Analyst calls and corporate housekeeping: weaker, since an infra story can
// mention a price target in passing (−2).
const SIDE_TOPIC: RegExp[] = [
  /\b(?:patent|royalt(?:y|ies)|share repurchase|buyback|price target|outperform|overweight|initiation|upgraded|downgraded)\b/i,
  /\b(?:forward earnings|times earnings|valuation multiple|p\/e)\b/i,
];

const hits = (rs: RegExp[], s: string) => rs.reduce((n, r) => n + (r.test(s) ? 1 : 0), 0);

/** 2 per strong term, 1 per weak term, +1 for a stated deal of $1B or more,
 *  −3 per off-topic term, −2 per side topic. */
export function infraScore(p: NewsPost): number {
  const s = text(p);
  const bigDeal = figures(p).some((f) => f.kind === "dollars" && f.value >= 1e9) ? 1 : 0;
  return 2 * hits(STRONG, s) + hits(WEAK, s) + bigDeal - 3 * hits(OFF_TOPIC, s) - 2 * hits(SIDE_TOPIC, s);
}

export const isInfra = (p: NewsPost) => noiseReason(p) === null && infraScore(p) >= INFRA_THRESHOLD;

// ---------------------------------------------------------------------------
// Figures
// ---------------------------------------------------------------------------

export type Figure = { kind: "capacity" | "dollars"; value: number; label: string };

// The whole numeric token — grouped thousands and a decimal part ("1,250.5
// MW") — and never a tail of a longer number.
const NUMBER = "(\\d{1,3}(?:,\\d{3})+(?:\\.\\d+)?|\\d+(?:\\.\\d+)?)";
const CAPACITY = new RegExp(`(?<![\\d.,])${NUMBER}\\s?(gw|mw|gigawatts?|megawatts?)\\b`, "gi");
const DOLLARS = new RegExp(`\\$\\s?${NUMBER}\\s?(trillion|tn|billion|bn|b)\\b`, "gi");
// An amount whose own role is revenue, valuation or a target is not a deal,
// whatever deal word shares its sentence. Read from the few words beside it.
const NOT_A_DEAL = /\b(?:revenue|revenues|sales|valuation|valued|pre-money|post-money|market (?:cap|value)|price target|earnings|eps|profit|income|backlog of)\b/i;
const DEAL_WORDS = /\b(?:financing|arrang\w*|debt|loan|lend|deal|invest(?:ment|s|ing)?|funding|raise[sd]?|round|capex|capital spending|lease|contract|agreement|orders?|acquir\w+|purchase|buy|facility|package|commit\w*)\b/i;
// A sentence that projects rather than reports: its figures are estimates.
// Verbs only — "project" the noun, and contract dates like "through 2048",
// describe things that already happened.
const FORECAST = /\b(?:forecast\w*|estimat\w*|could|might|would|projects? to|projected|projecting|expects?|expected|targets?|targeting)\b/i;
// "may" in any case is a forecast unless it is the month: after a date
// preposition ("in May", "since MAY") or before a day or year ("May 12").
const MONTH_BEFORE = new Set(["in", "since", "until", "from", "on", "of", "by", "through", "late", "early", "mid", "last", "this", "next", "during", "before", "after"]);
function hasModalMay(sentence: string): boolean {
  for (const m of sentence.matchAll(/\bmay\b/gi)) {
    const before = sentence.slice(0, m.index).trim().split(/\s+/).pop()?.toLowerCase() ?? "";
    const after = sentence.slice((m.index ?? 0) + 3);
    if (!MONTH_BEFORE.has(before) && !/^\s*(?:\d{1,2}\b|,?\s*\d{4}\b)/.test(after)) return true;
  }
  return false;
}

const num = (s: string) => Number(s.replace(/,/g, ""));
/** The last |n| words of `s` (n < 0) or its first n words (n > 0). */
function wordsAround(s: string, n: number): string {
  const w = s.trim().split(/\s+/).filter(Boolean);
  return (n < 0 ? w.slice(n) : w.slice(0, n)).join(" ");
}

/** Capacity (MW) and deal-dollar figures stated in the HEADLINE — the claim
 *  the post leads with, not a number from its supporting detail. Dollar
 *  figures count only beside a deal word in the same sentence (so revenue and
 *  price targets don't), and a sentence that forecasts contributes nothing. */
export function figures(p: NewsPost): Figure[] {
  const out: Figure[] = [];
  for (const sentence of p.headline.split(/(?<=[.;])\s+/)) {
    if (FORECAST.test(sentence) || hasModalMay(sentence)) continue;
    for (const m of sentence.matchAll(CAPACITY)) {
      const unit = m[2].toLowerCase();
      const mw = num(m[1]) * (unit.startsWith("g") ? 1000 : 1);
      if (mw > 0) {
        const label = mw >= 1000 ? `${+(mw / 1000).toFixed(2)} GW` : `${+mw.toFixed(1)} MW`;
        out.push({ kind: "capacity", value: mw, label });
      }
    }
    if (!DEAL_WORDS.test(sentence)) continue;
    for (const m of sentence.matchAll(DOLLARS)) {
      const start = m.index ?? 0;
      // the amount's own role: "revenue of $X", "valued at $X", "$X of revenue",
      // "$X pre-money valuation" — not a word from a neighbouring clause
      const near = `${wordsAround(sentence.slice(0, start), -2)} ${wordsAround(sentence.slice(start + m[0].length), 3)}`;
      if (NOT_A_DEAL.test(near)) continue;
      const u = m[2].toLowerCase();
      const usd = num(m[1]) * (u.startsWith("t") ? 1e12 : 1e9);
      out.push({ kind: "dollars", value: usd, label: usd >= 1e12 ? `$${+(usd / 1e12).toFixed(2)}T` : `$${+(usd / 1e9).toFixed(1)}B` });
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Story clusters
// ---------------------------------------------------------------------------

export type Story = { lead: NewsPost; also: NewsPost[]; latest: string; infra: boolean };

const STOP = new Set(("the a an and or of to in for on with at by from as is are was were be its it that this " +
  "said says will would could has have had after over into about more than new " +
  // units and magnitudes say nothing about which event a headline is
  "billion million trillion percent").split(" "));
function words(p: NewsPost): Set<string> {
  return new Set(
    p.headline.toLowerCase().replace(/\$[a-z.]+/g, " ").split(/[^a-z0-9]+/)
      .filter((w) => w.length >= 4 && !STOP.has(w)),
  );
}
function jaccard(a: Set<string>, b: Set<string>): number {
  if (!a.size || !b.size) return 0;
  let n = 0;
  for (const w of a) if (b.has(w)) n++;
  return n / (a.size + b.size - n);
}
/** Everything sameStory compares, computed once per post rather than once
 *  per pair: clustering is O(n²) and reruns on every live refresh. */
type Features = {
  t: number; tickers: Set<string>; noise: boolean; figs: Set<string>; words: Set<string>;
  capacity: Set<number>; dollars: Set<number>; places: Set<string>;
};

/** The places a prose headline sites its story at: the run of capitalised
 *  words after "in", "at", "near" or "outside" ("… data center in New York"),
 *  lower-cased and space-joined, so New York and New Jersey stay apart.
 *  Only prepositional places, never every capitalised word: a rewrite that
 *  adds a counterparty or a wire credit is still the same event. A capitals
 *  flash or Title Case headline capitalises its prepositions, so it yields
 *  none and never vetoes. */
const PLACE = /\b(?:in|at|near|outside)\s+(?:the\s+)?([A-Z][A-Za-z\u2019'.-]+(?:\s+[A-Z][A-Za-z\u2019'.-]+)*)/g;
function places(p: NewsPost): Set<string> {
  return new Set([...p.headline.matchAll(PLACE)]
    .map((m) => m[1].split(/\s+/)
      .map((w) => w.replace(/[\u2019']s$/i, "").replace(/[^A-Za-z]/g, "").toLowerCase())
      .filter(Boolean).join(" "))
    .filter((w) => w.length >= 3));
}
function features(p: NewsPost): Features {
  const fs = figures(p);
  return {
    t: Date.parse(p.ts),
    tickers: new Set(p.tickers.map((x) => x.ticker)),
    noise: noiseReason(p) !== null,
    figs: new Set(fs.map((f) => `${f.kind}:${f.value}`)),
    words: words(p),
    capacity: new Set(fs.filter((f) => f.kind === "capacity").map((f) => f.value)),
    dollars: new Set(fs.filter((f) => f.kind === "dollars").map((f) => f.value)),
    places: places(p),
  };
}
const disjoint = (a: Set<number>, b: Set<number>) => a.size > 0 && b.size > 0 && ![...a].some((v) => b.has(v));
/** One place names the other whole-word first: "texas" and "texas ai" (a
 *  capitalised word that trails the place) are one place; "new york" and
 *  "new jersey" are not. */
const samePlace = (a: string, b: string) => a === b || a.startsWith(`${b} `) || b.startsWith(`${a} `);
/** Both headlines site their story and at no shared place: different events,
 *  whatever company, figure and verbs they share. */
const differentPlaces = (a: Set<string>, b: Set<string>) =>
  a.size > 0 && b.size > 0 && ![...a].some((n) => [...b].some((m) => samePlace(n, m)));

/** Cheapest test first: time window, shared ticker, noise, then figures and
 *  wording. A recap or roundup shares tickers and figures with everything; it
 *  never joins (or leads) a story. Two headlines stating DIFFERENT capacities
 *  (or different deal sizes) are different events, and a matching figure
 *  counts only beside some shared wording — "$5 billion" alone is not an
 *  event. */
function sameStoryF(a: Features, b: Features): boolean {
  if (Math.abs(a.t - b.t) > STORY_WINDOW_H * 3_600_000) return false;
  let shared = false;
  for (const t of b.tickers) if (a.tickers.has(t)) { shared = true; break; }
  if (!shared || a.noise || b.noise) return false;
  if (disjoint(a.capacity, b.capacity) || disjoint(a.dollars, b.dollars)) return false;
  // "500 MW data center in Texas" vs "… in Finland": matching company, figure
  // and generic verbs never override two different named places (audit F7)
  if (differentPlaces(a.places, b.places)) return false;
  const overlap = jaccard(a.words, b.words);
  for (const k of b.figs) if (a.figs.has(k)) return overlap >= 0.15;
  return overlap >= 0.3;
}

/** True when two posts are the same story (see module docstring). */
export function sameStory(a: NewsPost, b: NewsPost): boolean {
  return sameStoryF(features(a), features(b));
}

/** A later post that reverses or changes the story: it must lead, however
 *  terse, or the row keeps presenting a deal that no longer stands. */
export const REVERSAL = /\b(?:cancel\w*|terminat\w*|scrap\w*|halt\w*|suspend\w*|withdr[ae]w\w*|pull\w* out|abandon\w*|den(?:y|ies|ied)|delay\w*|postpone\w*|pause[sd]?|revised terms|renegotiat\w*|block\w*|reject\w*|collaps\w*|fell through|walk(?:s|ed)? away)\b/i;

/** The post to lead a story with: prose over a capitals flash, then one with
 *  supporting detail, then the newest — a story leads with its latest
 *  development, not its first report. A newer post carrying a reversal the
 *  current lead doesn't overrides all of that (see pickLead). */
function leadRank(p: NewsPost): [number, number, string] {
  return [isAllCaps(p.headline) ? 0 : 1, p.points.length > 0 ? 1 : 0, p.ts];
}
function better(a: NewsPost, b: NewsPost): boolean {
  const [x, y] = [leadRank(a), leadRank(b)];
  return x[0] !== y[0] ? x[0] > y[0] : x[1] !== y[1] ? x[1] > y[1] : x[2] > y[2];
}

function pickLead(members: NewsPost[]): NewsPost {
  const lead = members.reduce((best, p) => (better(p, best) ? p : best));
  const reversal = members
    .filter((p) => p.ts > lead.ts && REVERSAL.test(p.headline) && !REVERSAL.test(lead.headline))
    .reduce<NewsPost | null>((n, p) => (!n || p.ts > n.ts ? p : n), null);
  return reversal ?? lead;
}

/** Posts -> newest-first stories. Greedy single pass: each post joins the
 *  first story it matches any member of, else starts its own — and never a
 *  story whose newest post is outside the window, so chains of matches can't
 *  stretch a story past STORY_WINDOW_H. */
export function clusterStories(posts: NewsPost[]): Story[] {
  const groups: { members: NewsPost[]; feats: Features[]; minT: number; maxT: number }[] = [];
  const window = STORY_WINDOW_H * 3_600_000;
  for (const p of posts) {
    const f = features(p);
    const g = groups.find((x) =>
      Math.max(x.maxT, f.t) - Math.min(x.minT, f.t) <= window && x.feats.some((m) => sameStoryF(m, f)));
    if (g) { g.members.push(p); g.feats.push(f); g.minT = Math.min(g.minT, f.t); g.maxT = Math.max(g.maxT, f.t); }
    else groups.push({ members: [p], feats: [f], minT: f.t, maxT: f.t });
  }
  return groups.map(({ members }) => {
    const lead = pickLead(members);
    const latest = members.reduce((t, p) => (p.ts > t ? p.ts : t), members[0].ts);
    return { lead, also: members.filter((p) => p !== lead), latest, infra: members.some(isInfra) };
  }).sort((a, b) => (a.latest < b.latest ? 1 : a.latest > b.latest ? -1 : 0));
}

/** One figure per story — the FIRST of that kind its lead states (else the
 *  first a repeat states), since a post's first figure is its subject ("240 MW
 *  … option to expand to 480 MW") — then the largest stories first. */
export function topFigures(stories: Story[], kind: Figure["kind"], n: number): { story: Story; figure: Figure }[] {
  const rows: { story: Story; figure: Figure }[] = [];
  for (const s of stories) {
    // a story whose latest word reverses it has no figure to boast about
    if (REVERSAL.test(s.lead.headline)) continue;
    const first = [s.lead, ...s.also].map((p) => figures(p).find((f) => f.kind === kind)).find(Boolean);
    if (first) rows.push({ story: s, figure: first });
  }
  rows.sort((a, b) => b.figure.value - a.figure.value);
  // The same figure for the same company on DIFFERENT New York days is one
  // deal reported twice, even when the reports didn't fold into one story
  // (Broadcom's $60B package on Oct 2 and Oct 5): show it once, at its newest
  // story. On the same day, two stories the clustering kept apart are two
  // deals, equal size or not (audit F8; plan D10).
  const out: typeof rows = [];
  for (const r of rows) {
    const tickers = new Set(storyTickers(r.story).map((t) => t.ticker));
    const day = etDayKey(r.story.latest);
    const dupe = out.find((o) => o.figure.value === r.figure.value && etDayKey(o.story.latest) !== day &&
      storyTickers(o.story).some((t) => tickers.has(t.ticker)));
    if (!dupe) out.push(r);
    else if (r.story.latest > dupe.story.latest) out[out.indexOf(dupe)] = r;
    if (out.length === n) break;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Story-level filters and counts (the feed's chips count stories, not posts)
// ---------------------------------------------------------------------------

const storyPosts = (s: Story) => [s.lead, ...s.also];

/** Every ticker the story's posts name, with its layer, de-duplicated. */
export function storyTickers(s: Story): { ticker: string; layer: string }[] {
  const seen = new Map<string, string>();
  for (const p of storyPosts(s)) for (const t of p.tickers) if (!seen.has(t.ticker)) seen.set(t.ticker, t.layer);
  return [...seen.entries()].map(([ticker, layer]) => ({ ticker, layer }));
}

export function storyMatches(s: Story, f: { layer: string | null; ticker: string | null }): boolean {
  const ts = storyTickers(s);
  return (!f.layer || ts.some((t) => t.layer === f.layer)) && (!f.ticker || ts.some((t) => t.ticker === f.ticker));
}

/** [ticker, stories] by count desc, ticker asc on ties. */
export function storyTickerCounts(stories: Story[]): [string, number][] {
  const n = new Map<string, number>();
  for (const s of stories) for (const t of storyTickers(s)) n.set(t.ticker, (n.get(t.ticker) ?? 0) + 1);
  return [...n.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
}

/** Layers in config order with how many stories touch each (zero dropped). */
export function storyLayerCounts(stories: Story[], layers: readonly string[]): [string, number][] {
  return layers
    .map((l): [string, number] => [l, stories.filter((s) => storyTickers(s).some((t) => t.layer === l)).length])
    .filter(([, k]) => k > 0);
}
