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
