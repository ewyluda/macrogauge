import { expect, test } from "@playwright/test";
import changes from "../public/data/changes.json";
import housing from "../public/data/housing.json";

/** Batch 4 — pipeline unlocks: rates, compute, housing, USDA wholesale, since-yesterday. */

test("/rates renders the curve table with eight tenors and the liquidity KPIs", async ({ page }) => {
  await page.goto("/rates");
  const curve = page.locator("table.data-table").first();
  await expect(curve.locator("tbody tr")).toHaveCount(8);
  await expect(page.locator(".kpi-label", { hasText: "Net liquidity" })).toBeVisible();
  await expect(page.locator(".kpi-label", { hasText: "Spread to 10y" })).toBeVisible();
  await expect(page.locator("canvas").first()).toBeVisible();
});

test("/compute renders both composites and six models", async ({ page }) => {
  await page.goto("/compute");
  await expect(page.locator(".kpi-label", { hasText: "Token price index" })).toBeVisible();
  await expect(page.locator(".kpi-label", { hasText: "GPU-hour index" })).toBeVisible();
  const models = page.locator("table.data-table").first();
  await expect(models.locator("tbody tr")).toHaveCount(6);
});

test("/housing affordability KPI matches the artifact", async ({ page }) => {
  await page.goto("/housing");
  const share = (housing as { affordability: { share_pct: number } }).affordability.share_pct;
  await expect(page.getByText("Payment ÷ paycheck")).toBeVisible();
  await expect(page.locator(".kpi-value").first()).toHaveText(`${share.toFixed(1)}%`);
});

test("/grocery shows the farm-to-shelf table with five USDA staples", async ({ page }) => {
  await page.goto("/grocery");
  await expect(page.getByText("Farm to shelf — USDA wholesale vs the BLS shelf price")).toBeVisible();
  const t = page.locator("table.data-table").first();
  await expect(t.locator("tbody tr")).toHaveCount(5);
});

test("since-yesterday strip on the homepage and the /changes page agree on the previous publish", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator(".since-strip")).toBeVisible();
  const prev = (changes as { prev_published_at: string | null }).prev_published_at;
  if (prev) {
    await expect(page.locator(".since-strip")).toContainText("vs ");
  } else {
    await expect(page.locator(".since-strip")).toContainText("first reading");
  }
  await page.goto("/changes");
  await expect(page.locator(".kpi-label", { hasText: "Previous publish" })).toBeVisible();
  await expect(page.locator("table.data-table").nth(1).locator("tbody tr")).toHaveCount(14);
});

test("feed body carries the since-yesterday sentence", async ({ page }) => {
  const feed = await page.request.get("/feed.xml");
  expect(await feed.text()).toContain("Since the previous publish:");
});
