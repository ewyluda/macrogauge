import type { Metadata } from "next";
import Link from "next/link";
import newsJson from "../../../public/data/news.json";
import { NewsFeed } from "@/components/NewsFeed";
import { artifact } from "@/lib/artifact";

const news = artifact("news", newsJson);

export const metadata: Metadata = {
  title: "AI Infra News Tape — live headlines on AI and data-center names",
  description: `A live tape of market-news posts that name one of ${news.universe_size} AI-infrastructure companies — chips, fabs, networking, power, cooling, cloud and data-center REITs — filterable by layer and ticker.`,
};

export default function NewsPage() {
  return (
    <div>
      <h1>
        AI Infra News Tape <span className="subtitle">what the tape is saying about AI and data-center names</span>
      </h1>
      <p className="lede">
        Every market-news post from the last {news.window_days} days that names one of {news.universe_size} AI-infrastructure
        companies, from semiconductor equipment through power, cooling, cloud and data-center REITs. Options-flow prints and
        macro or geopolitics posts are left out. The page refreshes itself every two minutes while it is open. Pair it with
        the <Link href="/capacity">AI capacity tracker</Link> and the <Link href="/datacenter">data-center cost indexes</Link>.
      </p>
      <p className="lede">
        <strong>Treat this as a secondary source.</strong> Posts come from a single social news feed: real headlines
        mixed with commentary, unverified and sometimes wrong. Tickers are tagged by machine. Check the primary filing or
        release before acting on any figure.
      </p>
      <NewsFeed snapshot={news} />
      <section className="dc-method" aria-labelledby="news-method-title" style={{ marginTop: 32 }}>
        <h2 id="news-method-title">How it&apos;s built</h2>
        <p className="method">
          Posts are collected from one WhatsApp market-news channel into an append-only SQLite tape, where a language
          model tags each post with the tickers it <em>mentions</em> and the ones it <em>impacts</em>. Litestream replicates
          the tape to object storage. Every few minutes an exporter takes a verified snapshot and keeps posts that mention a
          ticker in the layer taxonomy ({news.layers.length} layers), in the company, earnings or other categories, and not
          flagged as duplicates. It writes the result to a public JSON object, which this page fetches. Once a day the publish
          run also bakes that object into <Link href="/data/news.json">/data/news.json</Link> after re-filtering it against
          the same config, so the page still renders a snapshot if the live object is unreachable. A ticker that a post only{" "}
          <em>impacts</em> is listed as a read-through, and it never puts a post on the tape by itself.
        </p>
      </section>
    </div>
  );
}
