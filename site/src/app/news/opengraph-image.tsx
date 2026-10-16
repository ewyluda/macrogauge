import { C, ogCard } from "@/lib/ogCard";
import { artifact } from "@/lib/artifact";
import { clusterStories } from "@/lib/newsTape";
import newsJson from "../../../public/data/news.json";

export const dynamic = "force-static";
export const alt = "Macrogauge AI Infra News Tape — live headlines on AI and data-center names";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

const news = artifact("news", newsJson);

export default function Image() {
  // the page's default view: repeats folded into stories, build-out stories only
  const stories = clusterStories(news.posts).filter((s) => s.infra);
  return ogCard({
    kicker: "AI INFRA NEWS",
    stamp: `tape to ${(news.tape_last_post_at ?? news.published_at).slice(0, 10)}`,
    headline: `A live tape of market-news posts naming one of ${news.universe_size} AI-infrastructure companies — chips and fabs through power, cooling, cloud and data-center REITs.`,
    tiles: [
      { label: "Build-out stories", value: String(stories.length), color: C.sky, ctx: `last ${news.window_days} days` },
      { label: "Posts on the tape", value: String(news.posts.length), color: C.violet, ctx: "repeats folded into stories" },
      { label: "Companies tracked", value: String(news.universe_size), color: C.amber, ctx: `${news.layers.length} layers` },
    ],
    takeaway: "The page refreshes itself every two minutes while it is open; the primary filing or release stays the last word on any figure.",
  });
}
