import { expect, test } from "@playwright/test";

/** Batch 3 — momentum, contribution, breadth (site-only math). */

test("hero chart rate control switches to 3m annualized and lives in the URL", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "3m ann.", exact: true }).first().click();
  await expect.poll(() => page.evaluate(() => location.search)).toContain("rate=ann3");
  await expect(page.getByText(/annualized off the daily index/).first()).toBeVisible();
  // deep link applies on load (the same key drives every momentum chart)
  await page.goto("/vs-bls?rate=ann6");
  await expect(page.getByRole("button", { name: "6m ann.", exact: true })).toBeVisible();
  await expect(page.getByText(/annualized off the daily index/)).toBeVisible();
});

test("cost-of-living and supercore charts carry the same rate control", async ({ page }) => {
  await page.goto("/cost-of-living?rate=ann3");
  await expect(page.getByText(/annualized off the daily index/)).toBeVisible();
  await page.goto("/supercore?rate=ann3");
  await expect(page.getByText(/annualized off the daily index/)).toBeVisible();
});

test("contribution section renders 14 component rows whose contributions sum to the headline", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByText("Contribution to YoY — what is driving the number")).toBeVisible();
  const table = page.locator("table.data-table").filter({ has: page.locator("th", { hasText: "Contribution" }) }).first();
  await expect(table.locator("tbody tr")).toHaveCount(14);
  const pps = await table.locator("tbody tr td:nth-child(7)").allTextContents();
  const sum = pps.reduce((s, t) => s + Number(t.replace("−", "-").replace("pp", "").replace("+", "")), 0);
  const headline = Number((await page.locator(".headline-primary .kpi-value").textContent())!.replace("%", ""));
  expect(Math.abs(sum - headline)).toBeLessThan(0.1);
  // mode + window chips are URL state
  await page.getByRole("button", { name: "GAP (ours − BLS)", exact: true }).click();
  await expect.poll(() => page.evaluate(() => location.search)).toContain("cm=gap");
});

test("breadth panel shows the four diagnostics and the matrix carries our trimmed cuts", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByText("Breadth · above 2%")).toBeVisible();
  await expect(page.getByText("16% trimmed mean")).toBeVisible();
  await page.goto("/matrix");
  await expect(page.getByText("Macrogauge 16% trimmed mean (14 components)")).toBeVisible();
  await expect(page.getByText("Macrogauge weighted median (14 components)")).toBeVisible();
});

test("/gap shows the gap-contribution bars in gap mode by default", async ({ page }) => {
  await page.goto("/gap");
  await expect(page.getByText("Gap contribution over time — ours minus BLS, by component")).toBeVisible();
  await expect(page.getByRole("button", { name: "GAP (ours − BLS)", exact: true })).toBeVisible();
  await expect(page.locator("canvas").first()).toBeVisible();
});
