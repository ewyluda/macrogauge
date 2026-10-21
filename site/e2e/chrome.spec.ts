import { expect, test, type Locator } from "@playwright/test";

/** Live-site polish review 2026-10-15, batch 3: the site chrome (404, nav,
 *  footer, header pill, share cards), pinned. */

/** WCAG contrast of an element's text against its own background composited
 *  over every ancestor's (the pill's tint is translucent). */
async function contrast(el: Locator): Promise<number> {
  return el.evaluate((node) => {
    const parse = (s: string): number[] => {
      const rgb = s.match(/rgba?\(([^)]+)\)/);
      if (rgb) { const p = rgb[1].split(/[ ,/]+/).filter(Boolean).map(Number); return [p[0], p[1], p[2], p[3] ?? 1]; }
      const srgb = s.match(/color\(srgb ([^)]+)\)/);
      if (srgb) { const p = srgb[1].split(/[ /]+/).filter(Boolean).map(Number); return [p[0] * 255, p[1] * 255, p[2] * 255, p[3] ?? 1]; }
      return [0, 0, 0, 0];
    };
    const lum = (c: number[]) => {
      const f = (v: number) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
      return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]);
    };
    const stack: string[] = [];
    for (let n: Element | null = node; n; n = n.parentElement) stack.push(getComputedStyle(n).backgroundColor);
    let bg = [255, 255, 255];
    for (const s of stack.reverse()) {
      const c = parse(s);
      bg = [0, 1, 2].map((i) => c[i] * c[3] + bg[i] * (1 - c[3]));
    }
    const [a, b] = [lum(parse(getComputedStyle(node).color)), lum(bg)].sort((x, y) => y - x);
    return (a + 0.05) / (b + 0.05);
  });
}

test.describe("404 under a dark OS scheme", () => {
  test.use({ colorScheme: "dark" });

  test("is the site's own light page, with ways back in", async ({ page }) => {
    const res = await page.goto("/no-such-page");
    expect(res?.status()).toBe(404);
    // Next's built-in 404 painted the body black here and hid the wordmark
    const bg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
    expect(bg).toBe("rgb(246, 247, 249)");
    const main = page.locator("main");
    for (const href of ["/", "/datacenter", "/data"]) {
      await expect(main.locator(`a[href="${href}"]`)).toBeVisible();
    }
    await expect(page).toHaveTitle(/^Page not found — Macrogauge$/);
  });
});

test("nested routes light their own nav section", async ({ page }) => {
  for (const [path, group, item] of [
    ["/escalation/clause", "AI Infra", "Escalation"],
    ["/datacenter/components/constr_wages", "AI Infra", "Data Centers"],
    ["/states/va", "AI Infra", "Site Costs"],
    ["/grocery/bacon-sliced", "Inflation", "Grocery Prices"],
    ["/components/shelter_owned", "Inflation", "Gauge Gap"],
  ]) {
    await page.goto(path);
    await expect(page.locator(".nav-trigger.active"), path).toHaveText(group);
    await expect(page.locator(".nav-menu-link.active"), path).toContainText(item);
  }
});

test("AI Infra sits second, with the two tools in their own column", async ({ page }) => {
  await page.goto("/");
  const top = await page.locator(".nav-items > .nav-link, .nav-items > .nav-group > .nav-trigger").allTextContents();
  expect(top.slice(0, 2)).toEqual(["Home", "AI Infra"]);
  const heads = page.locator(".nav-group").filter({ hasText: "AI Infra" }).locator(".nav-menu-head");
  await expect(heads).toHaveText(["Cost to build", "Capacity & compute", "Tools"]);
});

test("the dropdown caret is a legible chevron, not a 9px glyph", async ({ page }) => {
  await page.goto("/");
  const box = await page.locator(".nav-trigger .nav-caret").first().boundingBox();
  expect(box!.width).toBeGreaterThanOrEqual(10);
  expect(box!.height).toBeGreaterThanOrEqual(10);
});

test("the header self-test pill and the /status pills clear AA contrast", async ({ page }) => {
  await page.goto("/");
  const pill = page.locator(".site-header .status-pill");
  expect(await contrast(pill)).toBeGreaterThanOrEqual(4.5);
  const icon = await pill.locator(".status-pill-icon").evaluate((n) => parseFloat(getComputedStyle(n).fontSize));
  expect(icon).toBeGreaterThanOrEqual(11);
  await page.goto("/status");
  const pills = page.locator("main .status-pill");
  for (let i = 0; i < Math.min(await pills.count(), 12); i++) {
    expect(await contrast(pills.nth(i))).toBeGreaterThanOrEqual(4.5);
  }
});

test.describe("phone (390px)", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test("the menu button sits at the far right, past the pill", async ({ page }) => {
    await page.goto("/");
    const toggle = (await page.locator(".mobile-menu-toggle").boundingBox())!;
    const pill = (await page.locator(".site-header .status-pill").boundingBox())!;
    expect(toggle.x + toggle.width).toBeGreaterThanOrEqual(390 - 12);
    expect(toggle.x).toBeGreaterThanOrEqual(pill.x + pill.width);
  });

  test("footer links are 44px tap targets", async ({ page }) => {
    await page.goto("/");
    const heights = await page.locator(".footer-col a").evaluateAll((as) => as.map((a) => a.getBoundingClientRect().height));
    expect(heights.length).toBeGreaterThan(20);
    expect(Math.min(...heights)).toBeGreaterThanOrEqual(44);
  });
});

test("every AI Infra page shares its own card", async ({ page }) => {
  for (const route of ["/datacenter", "/escalation", "/calculator", "/longlead", "/power", "/commodities", "/markets",
    "/states", "/rates", "/as-of", "/capacity", "/compute", "/news", "/gas"]) {
    await page.goto(route);
    const og = await page.locator('meta[property="og:image"]').getAttribute("content");
    expect(new URL(og!).pathname, route).toBe(`${route}/opengraph-image`);
    const img = await page.request.get(`${route}/opengraph-image`);
    expect(img.ok(), route).toBe(true);
    expect((await img.body()).subarray(1, 4).toString(), route).toBe("PNG");
  }
});
