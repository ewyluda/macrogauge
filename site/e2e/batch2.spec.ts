import { expect, test } from "@playwright/test";
import grades from "../public/data/dc_grades.json";

/** Batch 2 — render what was already published. */

test("/pce renders the PCE gauge KPI, its weights table and the graded calls", async ({ page }) => {
  await page.goto("/pce");
  await expect(page.getByText("PCE gauge · YoY")).toBeVisible();
  await expect(page.getByText("Official PCEPI · YoY")).toBeVisible();
  // weights table lists all 14 components with a PCE column
  const rows = page.locator("table.data-table").last().locator("tbody tr");
  await expect(rows).toHaveCount(14);
  // the graded-calls table is the same component /scoreboard uses
  await expect(page.locator("th", { hasText: "Graded on" })).toHaveCount(1);
  await expect(page.locator("canvas").first()).toBeVisible();
});

test("/supercore shows the monthly history against core CPI with validation stats", async ({ page }) => {
  await page.goto("/supercore");
  await expect(page.getByText("Supercore vs core CPI — monthly, full history")).toBeVisible();
  await expect(page.getByText(/Correlation .* mean absolute gap/)).toBeVisible();
  await expect(page.locator("canvas")).toHaveCount(2);
});

test("/dc-scoreboard anchor scatter recomputes the published grade for the selected cell", async ({ page }) => {
  await page.goto("/dc-scoreboard?leg=strict&sb=long_run&sh=12");
  await expect(page.getByText("Expected vs realized — every vintage anchor")).toBeVisible();
  const g = (grades as { legs: Record<string, { grades: Record<string, Record<string, { n: number; shortfall_rate_pct: number }>> }> })
    .legs.strict.grades.long_run.h12;
  const caption = page.getByText(/anchors · shortfall in/);
  await expect(caption).toContainText(`${g.n} anchors`);
  await expect(caption).toContainText(`shortfall in ${g.shortfall_rate_pct.toFixed(1)}%`);
  // switching leg is mirrored into the URL and re-labels the axis caption
  await page.getByRole("button", { name: "Extended (final-revision)" }).click();
  await expect.poll(() => page.evaluate(() => location.search)).toContain("leg=extended");
  // downturn badge is rendered per leg
  await expect(page.locator("th", { hasText: /downturn/ })).toHaveCount(2);
});

test("/dc-scoreboard lead-lag section plots the correlation profiles", async ({ page }) => {
  await page.goto("/dc-scoreboard");
  await expect(page.getByText("Solid = cleared the gate")).toBeVisible();
});

test("/scoreboard backtest table carries the vintage cutoff and naive comparison", async ({ page }) => {
  await page.goto("/scoreboard");
  await expect(page.locator("th", { hasText: "Vintage cutoff" })).toHaveCount(1);
  await expect(page.locator("th", { hasText: "Naive (carry-fwd)" })).toHaveCount(1);
  await expect(page.locator("th", { hasText: "vs naive" })).toHaveCount(1);
});

test("/gap shows every variant's summary strip", async ({ page }) => {
  await page.goto("/gap");
  const tiles = page.locator(".quote-tile");
  await expect(tiles).toHaveCount(5);
  await expect(tiles.filter({ hasText: "PCE-weighted" })).toHaveCount(1);
});

test("small dead fields render: continued claims, indicator signs, fetched counts, model parameters", async ({ page }) => {
  await page.goto("/labor");
  await expect(page.getByText(/continued [\d,]+k?/i)).toBeVisible();
  await page.goto("/heatcheck");
  await expect(page.locator("th", { hasText: /^Sign$/ })).toHaveCount(1);
  await page.goto("/stress");
  await expect(page.locator("th", { hasText: /^Sign$/ })).toHaveCount(1);
  await page.goto("/status");
  await expect(page.locator("th", { hasText: "Fetched" })).toHaveCount(1);
  await page.goto("/outlook");
  await expect(page.getByText("expand for every knob")).toBeVisible();
});

test("/capacity timeline tab renders the published curve", async ({ page }) => {
  await page.goto("/capacity?tab=Timeline");
  await expect(page.getByRole("button", { name: "Timeline", pressed: true })).toBeVisible();
  await expect(page.locator("svg path").first()).toBeVisible();
});
