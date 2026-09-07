import { expect, test } from "@playwright/test";
import { NAV } from "../src/lib/nav";

test("research theme stays consistent across client navigation", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("body")).toHaveCSS("background-color", "rgb(246, 247, 249)");
  await page.locator(".footer-links").getByRole("link", { name: "Data Centers", exact: true }).click();
  await expect(page.locator(".datacenter-dashboard")).toBeVisible();
  await expect(page.locator("body")).toHaveCSS("background-color", "rgb(246, 247, 249)");
  await page.locator(".footer-links").getByRole("link", { name: "Next Print", exact: true }).click();
  await expect(page.locator("h1")).toContainText("Next Print");
  await expect(page.locator("body")).toHaveCSS("background-color", "rgb(246, 247, 249)");
});

test("home comparisons, rate state and compact citation remain usable", async ({ page, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.goto("/");
  const chart = page.locator("#inflation-trend");
  await expect(chart.locator("canvas")).toBeVisible();
  const comparisons = chart.getByRole("button", { name: "All comparisons" });
  await expect(comparisons).toHaveAttribute("aria-pressed", "false");
  await comparisons.click();
  await expect(comparisons).toHaveAttribute("aria-pressed", "true");
  await chart.getByRole("button", { name: "3m ann.", exact: true }).click();
  await expect(page).toHaveURL(/rate=ann3/);
  await expect(chart.locator(".citation-text")).not.toBeVisible();
  await chart.locator(".citation-disclosure summary").focus();
  await page.keyboard.press("Enter");
  await expect(chart.locator(".citation-text")).toBeVisible();
  await chart.locator(".citation").getByRole("button", { name: "Copy", exact: true }).click();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toContain("CPI-comparable gauge YoY");
});

for (const route of ["/", "/datacenter"]) {
  test(`research overview and menus fit a phone: ${route}`, async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(route);
    const chart = page.locator(route === "/" ? "#inflation-trend" : ".dc-trend");
    await expect(chart.locator("canvas").first()).toBeVisible();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
    expect(overflow).toBeLessThanOrEqual(1);
    const cards = page.locator(route === "/" ? ".headline-comparator" : ".dc-headline .kpi-card:not(:first-child)");
    const boxes = await cards.evaluateAll((nodes) => nodes.map((node) => node.getBoundingClientRect().toJSON()));
    expect(Math.round(boxes[0].y)).toBe(Math.round(boxes[1].y));
    await chart.locator("summary").filter({ hasText: "Export" }).click();
    const menu = chart.locator("details[open] .research-popover");
    await expect(menu.getByRole("button", { name: "↓ CSV" })).toBeVisible();
    const box = (await menu.boundingBox())!;
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(390);
    const downloadEvent = page.waitForEvent("download");
    await menu.getByRole("button", { name: "↓ CSV" }).click();
    expect((await downloadEvent).suggestedFilename()).toMatch(/\.csv$/);
  });
}


const routes = NAV.flatMap((entry) => entry.kind === "link"
  ? [entry.href] : entry.sections.flatMap((section) => section.items.map((item) => item.href)));
for (const route of [...routes, "/components/fuel"]) {
  test(`sitewide mobile layout stays within the viewport: ${route}`, async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(route);
    await page.waitForLoadState("networkidle");
    await expect(page.locator("body")).toHaveCSS("background-color", "rgb(246, 247, 249)");
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
    expect(overflow, `Horizontal page overflow on ${route}`).toBeLessThanOrEqual(1);
    await expect(page.locator("h1")).toBeVisible();
  });
}

test("toolbar menus dismiss with Escape and outside clicks", async ({ page }) => {
  await page.goto("/grocery");
  const menu = page.locator(".research-disclosure").first();
  await menu.locator("summary").click();
  await expect(menu).toHaveAttribute("open", "");
  await page.keyboard.press("Escape");
  await expect(menu).not.toHaveAttribute("open", "");
  await expect(menu.locator("summary")).toBeFocused();
  await menu.locator("summary").click();
  await page.locator("h1").click();
  await expect(menu).not.toHaveAttribute("open", "");
});

test("capacity company details stay usable on a phone", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/capacity");
  const company = page.locator(".capacity-company").first();
  await company.click();
  await expect(company).toHaveAttribute("aria-expanded", "true");
  await expect(page.locator(".capacity-site-table").first()).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
});
