import { expect, test } from "@playwright/test";

/** Batch 1 — share & export foundation: URL state round-trips, CSV/JSON
 *  downloads, citation copy, and the build-time discoverability files. */

test("calculator inputs hydrate from the URL and write back to it", async ({ page }) => {
  await page.goto("/calculator?since=2021-06-15&amount=250");
  await expect(page.locator('input[type="date"]')).toHaveValue("2021-06-15");
  await expect(page.locator('input[type="number"]')).toHaveValue("250");
  await page.locator('input[type="number"]').fill("400");
  await expect.poll(() => page.evaluate(() => location.search)).toContain("amount=400");
  // back to the default removes the param
  await page.locator('input[type="number"]').fill("100");
  await expect.poll(() => page.evaluate(() => location.search)).not.toContain("amount=");
});

test("invalid URL state is ignored, not applied", async ({ page }) => {
  await page.goto("/calculator?since=not-a-date&amount=-5");
  await expect(page.locator('input[type="date"]')).toHaveValue("2020-01-01");
  await expect(page.locator('input[type="number"]')).toHaveValue("100");
});

test("escalation calculator deep-link sets base month, cost and basis", async ({ page }) => {
  await page.goto("/escalation?base=2022-01&cost=1000000&basis=long_run");
  const months = page.locator('input[type="month"]');
  await expect(months.first()).toHaveValue("2022-01");
  await expect(page.locator('input[type="number"]').first()).toHaveValue("1000000");
  // the citation string carries the live query so the setting cites itself
  await expect(page.locator(".citation-text")).toContainText("/escalation?base=2022-01");
});

test("quilt window chip is mirrored into the query string", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "48M", exact: true }).click();
  await expect.poll(() => page.evaluate(() => location.search)).toContain("qw=48");
});

test("CSV download produces a file with the citation comment", async ({ page }) => {
  await page.goto("/grocery");
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("button", { name: "↓ CSV" }).first().click(),
  ]);
  expect(download.suggestedFilename()).toBe("macrogauge-grocery.csv");
  const path = await download.path();
  expect(path).toBeTruthy();
  const { readFileSync } = await import("node:fs");
  const text = readFileSync(path!, "utf8");
  expect(text.startsWith("# MacroGauge grocery staples")).toBe(true);
  expect(text.split("\r\n")[1]).toContain("code,name,month,price");
});

test("JSON download links resolve to the published artifact", async ({ page }) => {
  await page.goto("/grocery");
  const href = await page.locator('a.tool-btn:has-text("JSON")').first().getAttribute("href");
  expect(href).toBe("/data/grocery_basket.json");
  const res = await page.request.get(href!);
  expect(res.ok()).toBe(true);
  expect((await res.json()).items.length).toBeGreaterThan(0);
});

test("copy link writes the current URL to the clipboard", async ({ page, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.goto("/calculator?amount=250");
  await page.getByRole("button", { name: "Copy link" }).click();
  await expect(page.getByRole("button", { name: "Copied" })).toBeVisible();
  const text = await page.evaluate(() => navigator.clipboard.readText());
  expect(text).toContain("/calculator?amount=250");
});

test("footer lists every published artifact and the feed", async ({ page }) => {
  await page.goto("/methodology");
  const links = page.locator(".footer-data a");
  expect(await links.count()).toBeGreaterThanOrEqual(37); // 36 artifacts + feed.xml
  await expect(links.filter({ hasText: "gauge_daily.json" })).toHaveCount(1);
});

test("feed, sitemap, robots and the OG image are emitted by the export", async ({ page }) => {
  const feed = await page.request.get("/feed.xml");
  expect(feed.ok()).toBe(true);
  const feedText = await feed.text();
  expect(feedText).toContain("<rss");
  expect(feedText).toContain("<guid isPermaLink=\"false\">");

  const sitemap = await page.request.get("/sitemap.xml");
  expect(sitemap.ok()).toBe(true);
  const sm = await sitemap.text();
  for (const route of ["/", "/datacenter", "/escalation", "/methodology"]) {
    expect(sm).toContain(`<loc>https://macrogauge-cloudten.vercel.app${route}</loc>`);
  }

  const robots = await page.request.get("/robots.txt");
  expect(robots.ok()).toBe(true);
  expect(await robots.text()).toContain("Sitemap:");

  await page.goto("/");
  const og = await page.locator('meta[property="og:image"]').getAttribute("content");
  expect(og).toContain("/opengraph-image");
  const img = await page.request.get(new URL(og!).pathname);
  expect(img.ok()).toBe(true);
  expect((await img.body()).subarray(1, 4).toString()).toBe("PNG");
  await expect(page.locator('link[rel="alternate"][type="application/rss+xml"]')).toHaveCount(1);
});
