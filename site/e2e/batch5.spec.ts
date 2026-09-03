import { expect, test } from "@playwright/test";
import ledger from "../public/data/ledger.json";
import replay from "../public/data/replay.json";

/** Batch 5 — receipts: component pages, revisions, point-in-time ledger, nowcast band, open data. */

test("every basket component has a page and the tables link to it", async ({ page }) => {
  const codes = (replay as { components: { code: string }[] }).components.map((c) => c.code);
  expect(codes).toHaveLength(14);
  for (const code of ["shelter_owned", "fuel", "medical"]) {
    await page.goto(`/components/${code}`);
    await expect(page.locator(".kpi-label", { hasText: "YoY (ours)" })).toBeVisible();
    await expect(page.locator("canvas").first()).toBeVisible();
  }
  await page.goto("/gap");
  const link = page.locator('a[href="/components/fuel"]').first();
  await expect(link).toBeVisible();
  await link.click();
  await expect(page).toHaveURL(/\/components\/fuel/);
  // level view is URL state
  await page.getByRole("button", { name: "INDEX LEVEL", exact: true }).click();
  await expect.poll(() => page.evaluate(() => location.search)).toContain("view=level");
});

test("live component shows its sources and splice; carry-forward component says so", async ({ page }) => {
  await page.goto("/components/fuel");
  await expect(page.getByText(/Splice point \d{4}-\d{2}-\d{2}/)).toBeVisible();
  await expect(page.locator("th", { hasText: "Blend weight" })).toHaveCount(1);
  await page.goto("/components/medical");
  await expect(page.getByText("No live blend configured")).toBeVisible();
});

test("/revisions renders three targets with the payrolls bar chart", async ({ page }) => {
  await page.goto("/revisions");
  await expect(page.locator(".kpi-label", { hasText: "Payrolls · change revision" })).toBeVisible();
  await expect(page.locator("canvas").first()).toBeVisible();
  await expect(page.locator("table.data-table")).toHaveCount(3);
});

test("/as-of reads a ledger row by date from the URL and cites it", async ({ page }) => {
  const rows = (ledger as { rows: { date: string; gauge_yoy_pct: number | null }[] }).rows;
  // a date can carry several publishes (the first day had two); the page shows the LAST one that day
  const first = rows.filter((r) => r.date === rows[0].date).slice(-1)[0];
  await page.goto(`/as-of?date=${first.date}`);
  await expect(page.locator('input[type="date"]')).toHaveValue(first.date);
  if (first.gauge_yoy_pct != null) {
    await expect(page.locator(".kpi-value").first()).toHaveText(`${first.gauge_yoy_pct.toFixed(1)}%`);
  }
  await expect(page.locator(".citation-text")).toContainText(`as published, ${first.date}`);
  await expect(page.locator(".citation-text")).toContainText(`/as-of?date=${first.date}`);
});

test("nowcast hero shows the realized error band", async ({ page }) => {
  await page.goto("/cpi-preview");
  await expect(page.locator(".kpi-label", { hasText: "Realized error band" })).toBeVisible();
  await expect(page.getByText(/mean absolute error over \d+ vintage-true prints/)).toBeVisible();
});

test("/data lists every artifact with a schema link that resolves", async ({ page }) => {
  await page.goto("/data");
  const rows = page.locator("table.data-table tbody tr");
  expect(await rows.count()).toBeGreaterThanOrEqual(42);
  const href = await page.locator('a[href^="/schemas/"]').first().getAttribute("href");
  const res = await page.request.get(href!);
  expect(res.ok()).toBe(true);
  expect((await res.json()).$schema).toContain("json-schema.org");
});
