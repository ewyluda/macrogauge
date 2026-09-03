import { expect, test } from "@playwright/test";

/** Batch 7 — hygiene: glossary, a11y on sortable/expandable tables, empty states. */

test("/methodology has the glossary and inline terms link into it", async ({ page }) => {
  await page.goto("/methodology");
  await expect(page.locator(".glossary-row")).toHaveCount(12);
  await expect(page.locator("#term-splice dt")).toHaveText("Splice");
  await page.goto("/gap");
  const term = page.locator("a.term").first();
  await expect(term).toHaveAttribute("href", "/methodology#term-laspeyres");
  await expect(term).toHaveAttribute("title", /fixed-weight index/);
});

test("parity table headers are buttons with aria-sort (#28)", async ({ page }) => {
  await page.goto("/datacenter");
  const th = page.locator('th[aria-sort]').first();
  await expect(th).toHaveAttribute("aria-sort", "descending");
  const btn = page.locator("th button", { hasText: "State" }).first();
  await btn.focus();
  await page.keyboard.press("Enter");
  await expect(page.locator('th[aria-sort="ascending"] button', { hasText: "State" })).toHaveCount(1);
});

test("expandable rows keep row semantics and expose a button control (#29)", async ({ page }) => {
  await page.goto("/markets");
  expect(await page.locator('tr[role="button"]').count()).toBe(0);
  const ctl = page.locator("td button[aria-expanded]").first();
  await expect(ctl).toHaveAttribute("aria-expanded", "false");
  await ctl.focus();
  await page.keyboard.press("Enter");
  await expect(ctl).toHaveAttribute("aria-expanded", "true");
  await page.goto("/capacity");
  expect(await page.locator('div[role="button"]').count()).toBe(0);
  const bar = page.locator(".dashboard-panel button[aria-expanded]").first();
  await bar.click();
  await expect(bar).toHaveAttribute("aria-expanded", "true");
});

test("focus ring is visible on keyboard focus", async ({ page }) => {
  await page.goto("/calculator");
  const input = page.locator('input[type="date"]');
  await input.focus();
  const outline = await input.evaluate((el) => getComputedStyle(el).outlineStyle);
  expect(outline).not.toBe("none");
});
