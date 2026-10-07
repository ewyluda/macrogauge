import { expect, test } from "@playwright/test";
import status from "../public/data/sources_status.json";

/** a11y backlog (review 2026-09-01 B14/B15/B16). No axe dependency: these
 *  assert the specific structures the review found missing. */

for (const route of ["/", "/gap", "/datacenter", "/methodology"]) {
  test(`${route}: banner, nav and footer sit outside the single <main>`, async ({ page }) => {
    await page.goto(route);
    await expect(page.locator("main")).toHaveCount(1);
    const main = page.locator("main#main-content");
    await expect(main).toHaveCount(1);
    await expect(main.locator("header.site-header, footer.site-footer, nav.site-nav")).toHaveCount(0);
    await expect(page.getByRole("banner")).toHaveCount(1);
    await expect(page.getByRole("contentinfo")).toHaveCount(1);
    await expect(page.getByRole("navigation", { name: "Primary" })).toHaveCount(1);
  });
}

test("skip link is the first tab stop and moves focus into <main>", async ({ page }) => {
  await page.goto("/gap");
  await page.keyboard.press("Tab");
  const skip = page.getByRole("link", { name: "Skip to main content" });
  await expect(skip).toBeFocused();
  await expect(skip).toBeInViewport();
  await page.keyboard.press("Enter");
  await expect(page.locator("main#main-content")).toBeFocused();
});

test("every chart canvas has a role=img text alternative with latest values", async ({ page }) => {
  await page.goto("/");
  await page.waitForSelector(".hero-chart-card canvas");
  const hero = page.locator(".hero-chart-card [role=img]").first();
  await expect(hero).toHaveAttribute("aria-label", /^Macrogauge vs official CPI — latest: .*\d\.\d{2} at \d{4}-\d{2}/);
  // ECharts' own aria layer (AriaComponent) labels its DOM node too
  await expect(hero.locator("> div").first()).toHaveAttribute("aria-label", /.+/);
  const canvases = page.locator("canvas");
  const n = await canvases.count();
  expect(n).toBeGreaterThan(0);
  for (let i = 0; i < n; i++) {
    const label = await canvases.nth(i).evaluate((el) => el.closest("[role=img]")?.getAttribute("aria-label") ?? null);
    expect(label, `canvas ${i} has no role=img ancestor label`).toMatch(/\S/);
  }
});

test("sparklines carry text alternatives", async ({ page }) => {
  await page.goto("/");
  const trails = page.getByTestId("ai-pulse").locator("svg[role=img]");
  expect(await trails.count()).toBeGreaterThan(0);
  await expect(trails.first()).toHaveAttribute("aria-label", /trend: \d+ points, from .+ to latest .+/);
  await page.goto("/grocery");
  const sparks = page.locator('svg[role=img][aria-label*="price history"]');
  expect(await sparks.count()).toBeGreaterThan(0);
  await expect(sparks.first()).toHaveAttribute("aria-label", /price history: \d+ monthly points, latest \$/);
});

test("Sources strip states status in text and exposes each detail to keyboard/AT", async ({ page }) => {
  await page.goto("/");
  const pills = page.locator('a[href="/status"][aria-describedby^="source-"]');
  await expect(pills).toHaveCount(status.sources.length);
  for (let i = 0; i < status.sources.length; i++) {
    const s = status.sources[i];
    const pill = pills.nth(i);
    // a glyph and a spoken tone word ride with the colour
    await expect(pill.locator(".status-pill-icon")).toHaveText(s.ok ? "✓" : "!");
    await expect(pill.locator(".sr-only").first()).toHaveText(s.ok ? "OK:" : "Advisory:");
    const id = await pill.getAttribute("aria-describedby");
    const detail = page.locator(`[id="${id}"]`);
    await expect(detail).toHaveCount(1);
    await expect(detail).toContainText(s.ok ? `${s.name} ok` : `${s.name} failed`);
    if (!s.ok) {
      await expect(pill).toContainText("error");
      await expect(detail).toBeVisible(); // failures are listed in plain sight
    }
  }
});
