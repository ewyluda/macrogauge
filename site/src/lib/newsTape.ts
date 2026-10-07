import type { NewsPost } from "./news";

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
const ROUNDUP = /\b(top (semiconductor )?picks?|buy-rated stocks|upgrades, downgrades|premarket|stocks? (rose|fell|gained)|shares rose today)\b/i;

/** Why a post is not a story, or null when it is one. */
export function noiseReason(p: NewsPost): "options flow" | "recap" | "roundup" | "stub" | null {
  const h = p.headline.trim();
  if (OPTIONS_FLOW.test(h)) return "options flow";
  if (RECAP.test(h)) return "recap";
  if (p.tickers.length >= 9 || ROUNDUP.test(h)) return "roundup";
  const words = h.split(/\s+/).filter(Boolean).length;
  if (words < 5 || (p.points.length === 0 && words < 8 && !/\d/.test(h))) return "stub";
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

const CAPACITY = /\b(\d+(?:[.,]\d+)?)\s?(gw|mw|gigawatts?|megawatts?)\b/gi;
const DOLLARS = /\$\s?(\d+(?:\.\d+)?)\s?(trillion|tn|billion|bn|b)\b/gi;
const DEAL_WORDS = /\b(?:financing|arrang\w*|debt|loan|lend|deal|invest(?:ment|s|ing)?|funding|raise[sd]?|round|capex|capital spending|lease|contract|agreement|orders?|acquir\w+|purchase|buy|facility|package|commit\w*)\b/i;
// A sentence that projects rather than reports: its figures are estimates.
const FORECAST = /\b(?:forecast\w*|estimat\w*|could|may|might|projects?|projected|expects?|expected|targets?|targeting|by (?:the end of )?20\d\d|through 20\d\d)\b/i;

const num = (s: string) => Number(s.replace(/,/g, ""));

/** Capacity (MW) and deal-dollar figures stated in the HEADLINE — the claim
 *  the post leads with, not a number from its supporting detail. Dollar
 *  figures count only beside a deal word in the same sentence (so revenue and
 *  price targets don't), and a sentence that forecasts contributes nothing. */
export function figures(p: NewsPost): Figure[] {
  const out: Figure[] = [];
  for (const src of [p.headline]) {
    for (const sentence of src.split(/(?<=[.;])\s+/)) {
      if (FORECAST.test(sentence)) continue;
      for (const m of sentence.matchAll(CAPACITY)) {
        const unit = m[2].toLowerCase();
        const mw = num(m[1]) * (unit.startsWith("g") ? 1000 : 1);
        if (mw > 0) out.push({ kind: "capacity", value: mw, label: mw >= 1000 ? `${+(mw / 1000).toFixed(2)} GW` : `${Math.round(mw)} MW` });
      }
      if (!DEAL_WORDS.test(sentence)) continue;
      for (const m of sentence.matchAll(DOLLARS)) {
        const u = m[2].toLowerCase();
        const usd = num(m[1]) * (u.startsWith("t") ? 1e12 : 1e9);
        out.push({ kind: "dollars", value: usd, label: usd >= 1e12 ? `$${+(usd / 1e12).toFixed(2)}T` : `$${+(usd / 1e9).toFixed(1)}B` });
      }
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Story clusters
// ---------------------------------------------------------------------------

export type Story = { lead: NewsPost; also: NewsPost[]; latest: string; infra: boolean };

const STOP = new Set(("the a an and or of to in for on with at by from as is are was were be its it that this " +
  "said says will would could has have had after over into about more than new").split(" "));
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
const figureKeys = (p: NewsPost) => new Set(figures(p).map((f) => `${f.kind}:${f.value}`));

/** True when two posts are the same story (see module docstring). */
export function sameStory(a: NewsPost, b: NewsPost): boolean {
  // a recap or roundup shares tickers and figures with everything; it never
  // joins (or leads) a story
  if (noiseReason(a) || noiseReason(b)) return false;
  if (Math.abs(Date.parse(a.ts) - Date.parse(b.ts)) > STORY_WINDOW_H * 3_600_000) return false;
  const ta = new Set(a.tickers.map((t) => t.ticker));
  if (!b.tickers.some((t) => ta.has(t.ticker))) return false;
  const fa = figureKeys(a);
  for (const k of figureKeys(b)) if (fa.has(k)) return true;
  return jaccard(words(a), words(b)) >= 0.3;
}

/** The post to lead a story with: prose over a capitals flash, then one with
 *  supporting detail, then the newest — a story leads with its latest
 *  development, not its first report. */
function leadRank(p: NewsPost): [number, number, string] {
  return [isAllCaps(p.headline) ? 0 : 1, p.points.length > 0 ? 1 : 0, p.ts];
}
function better(a: NewsPost, b: NewsPost): boolean {
  const [x, y] = [leadRank(a), leadRank(b)];
  return x[0] !== y[0] ? x[0] > y[0] : x[1] !== y[1] ? x[1] > y[1] : x[2] > y[2];
}

/** Newest-first posts -> newest-first stories. Greedy single pass: each post
 *  joins the first story it matches any member of, else starts its own. */
export function clusterStories(posts: NewsPost[]): Story[] {
  const groups: NewsPost[][] = [];
  for (const p of posts) {
    const g = groups.find((members) => members.some((m) => sameStory(m, p)));
    if (g) g.push(p);
    else groups.push([p]);
  }
  return groups.map((members) => {
    const lead = members.reduce((best, p) => (better(p, best) ? p : best));
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
    const first = [s.lead, ...s.also].map((p) => figures(p).find((f) => f.kind === kind)).find(Boolean);
    if (first) rows.push({ story: s, figure: first });
  }
  return rows.sort((a, b) => b.figure.value - a.figure.value).slice(0, n);
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
