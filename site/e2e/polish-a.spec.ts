import { expect, test, type Page } from "@playwright/test";

/** Polish batch A (2026-10-18): shared controls and formatting, pinned. */

const CONTROL_PAGES = ["/", "/datacenter", "/datacenter/components/transformers", "/methodology"];

async function optionBoxes(page: Page) {
  return page.locator(".segmented-option").evaluateAll((els) =>
    els.filter((e) => (e as HTMLElement).offsetParent !== null).map((e) => ({
      text: (e.textContent ?? "").trim(),
      h: e.getBoundingClientRect().height,
    })));
}

test.describe("segmented controls, desktop", () => {
  for (const path of CONTROL_PAGES) {
    test(`${path}: options are at least 32px tall and not all caps`, async ({ page }) => {
      await page.goto(path);
      const boxes = await optionBoxes(page);
      expect(boxes.length).toBeGreaterThan(0);
      for (const b of boxes) {
        expect(b.h, b.text).toBeGreaterThanOrEqual(32);
        // an all-caps label that is a word, not an acronym (BLS, YoY) or a span (24M)
        expect(/^[A-Z ]{4,}$/.test(b.text), b.text).toBe(false);
      }
    });
  }
});

test.describe("segmented controls, phone (390px)", () => {
  test.use({ viewport: { width: 390, height: 844 } });
  test("options are 44px touch targets", async ({ page }) => {
    await page.goto("/");
    const boxes = await optionBoxes(page);
    expect(boxes.length).toBeGreaterThan(0);
    for (const b of boxes) expect(b.h, b.text).toBeGreaterThanOrEqual(44);
  });
});

test.describe("numbers", () => {
  // a hyphen directly before a digit, not inside a word, a date or a range ("2026-10", "12-month", "0.1–0.2")
  const HYPHEN_MINUS = /(^|[\s(·:])-\d/m;
  for (const path of ["/markets", "/outlook", "/scoreboard", "/revisions", "/pce", "/escalation/grades", "/"]) {
    test(`${path}: negatives use the true minus`, async ({ page }) => {
      await page.goto(path);
      await page.waitForLoadState("networkidle"); // client tables (the quilt) render after hydration
      const text = await page.locator("main").innerText();
      const hit = text.match(HYPHEN_MINUS);
      expect(hit?.[0] ?? null, hit ? text.slice(Math.max(0, hit.index! - 40), hit.index! + 40) : "").toBeNull();
    });
  }

  test("/cost-of-living: the spread KPI matches the 1dp readings beside it", async ({ page }) => {
    await page.goto("/cost-of-living");
    const spread = page.locator(".kpi-card", { hasText: "Spread" }).locator(".kpi-value");
    await expect(spread).toHaveText(/^[+−]\d+\.\dpp$/);
  });

  test("home market pulse: dollars lead, units follow", async ({ page }) => {
    await page.goto("/");
    const pulse = await page.locator(".market-grid").innerText();
    expect(pulse).not.toMatch(/\d \$\//);
    expect(pulse).toMatch(/\$[\d,]+(\.\d+)?\/(oz|gal)/);
  });
});

test.describe("dates", () => {
  test("home's forecaster and pulse panels name months and days, not ISO", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator(".panel-title", { hasText: "Next CPI print" })).not.toContainText(/\d{4}-\d{2}/);
    const pulse = await page.locator(".market-grid").innerText();
    expect(pulse).not.toMatch(/week of \d{4}-/);
  });

  test("/revisions labels ECI periods as quarters", async ({ page }) => {
    await page.goto("/revisions");
    const first = page.locator("#eci table.data-table tbody tr td").first();
    await expect(first).toHaveText(/^Q[1-4] \d{4}$/);
  });

  test("/matrix shows a quarterly row's as-of as a quarter", async ({ page }) => {
    await page.goto("/matrix");
    const row = page.locator("table.data-table tbody tr", { has: page.locator("td", { hasText: /^quarterly$/ }) }).first();
    await expect(row).toContainText(/Q[1-4] \d{4}/);
  });

  test("/status publish stamps read in ET", async ({ page }) => {
    await page.goto("/status");
    await expect(page.locator("main")).not.toContainText(/\d{2}:\d{2} UTC/);
    await expect(page.locator("main")).toContainText(/\d{1,2}:\d{2} [AP]M ET/);
  });
});
