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
    // /datacenter names its first export (it carries three CSVs)
    const csv = menu.getByRole("button", { name: route === "/" ? "↓ CSV" : "↓ Components CSV" });
    await expect(csv).toBeVisible();
    const box = (await menu.boundingBox())!;
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(390);
    const downloadEvent = page.waitForEvent("download");
    await csv.click();
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

test("capacity dossier names its fields for readers, not by curator keys", async ({ page }) => {
  await page.goto("/capacity");
  const company = page.locator(".capacity-company").first();
  await company.click();
  const dossier = page.locator(".cap-dossier");
  await expect(dossier.getByRole("heading", { name: "Valuation" })).toBeVisible();
  await expect(dossier.locator(".cap-ledger")).toContainText("Under construction");
  await expect(dossier.locator(".cap-sites th").first()).toHaveText("Site");
  await expect(dossier).not.toContainText(/\b(revmw|capexmw)\b/i);
  // Tabs are a real tablist: arrow keys move selection.
  const tab = page.getByRole("tab", { name: "Capacity", selected: true });
  await tab.focus();
  await page.keyboard.press("ArrowRight");
  await expect(page.getByRole("tab", { name: "Valuation × Execution", selected: true })).toBeFocused();
});

test("capacity views each carry a readable table view and no page overflow", async ({ page }) => {
  await page.goto("/capacity?tab=Valuation+%C3%97+Execution");
  await expect(page.locator(".cap-table caption", { hasText: "Cheapest per megawatt first" })).toBeVisible();
  await page.getByRole("tab", { name: "Demand map" }).click();
  const deals = page.locator(".cap-table tbody tr");
  expect(await deals.count()).toBeGreaterThan(10);
  await page.getByRole("tab", { name: "Timeline" }).click();
  await expect(page.locator(".cap-figures")).toContainText("Operational today");
  await expect(page.locator(".cap-quarters > li").first()).toBeVisible();
  await page.getByRole("tab", { name: "Geo map" }).click();
  // Sites outside every drawn panel (e.g. China) are listed, never dropped.
  await expect(page.locator(".cap-elsewhere")).toContainText("outside the mapped regions");
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
});

test("datacenter drivers switch, jump bar, power summary and edge-collapsed states", async ({ page }) => {
  await page.goto("/datacenter");
  // one drivers table, switched between the three indexes
  const sw = page.locator(".dc-switch");
  await expect(sw.getByRole("button", { name: /DC Build/ })).toHaveAttribute("aria-pressed", "true");
  await sw.getByRole("button", { name: /DC Hardware/ }).click();
  await expect(page.locator(".dc-drivers-table")).toContainText("Computer storage devices");
  // jump bar targets exist
  for (const id of ["dc-drivers", "dc-power", "dc-parity", "dc-method"]) {
    await expect(page.locator(`.dc-jump a[href="#${id}"]`)).toHaveCount(1);
    await expect(page.locator(`#${id}`)).toHaveCount(1);
  }
  // the hub summarises the power bill and hands off to /power
  const power = page.locator("#dc-power");
  await expect(power.locator(".kpi-card")).toHaveCount(3);
  await expect(power.getByRole("link", { name: /every tariff/ })).toHaveAttribute("href", "/power");
  // the surge annotation and the takeaway title come from the data
  await expect(page.locator("#dc-trend-title")).toContainText("on the year");
  // 51 states collapse to the ten at each end of the sort until asked
  const parity = page.locator("#dc-parity tbody tr");
  await expect(parity).toHaveCount(21);
  await page.getByRole("button", { name: /states in between/ }).click();
  expect(await parity.count()).toBeGreaterThan(40);
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
});

test("power page covers every grid, capacity on one scale, tariffs as a matrix", async ({ page }) => {
  await page.goto("/power");
  await expect(page.locator("h1")).toContainText("on the year");
  // the featured hub is dated with its own window, and the eyebrow says
  // "Published" (the artifact), never a hub's delivery date
  await expect(page.locator(".kpi-card").first()).toContainText("30 days to");
  await expect(page.locator(".research-eyebrow")).toContainText("Published");
  expect(await page.locator(".pw-hubs tbody tr").count()).toBeGreaterThanOrEqual(8);
  await expect(page.locator(".pw-cap figcaption", { hasText: "MISO" })).toBeVisible();
  await expect(page.locator(".pw-cap-unit")).toContainText("$/MW-day");
  await expect(page.locator(".pw-cap-none")).toContainText("ERCOT");
  const tariffs = page.locator(".pw-tariffs tbody tr");
  expect(await tariffs.count()).toBeGreaterThanOrEqual(10);
  await expect(page.locator(".pw-tariffs thead")).toContainText("Minimum bill");
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
});

// The overflow check above raced ECharts: its painter kept the 1280px layout's
// pixel width until the resize event a frame later, and /datacenter's charts sit
// outside any clipping .chart-card (+830px, ~1 run in 3). Narrow and shift each
// chart's box and measure in the same task — before the chart's ResizeObserver
// can fire — so the painter is deterministically stale and only the CSS clip
// keeps the page width.
test("a stale-width chart painter never widens the page", async ({ page }) => {
  await page.goto("/datacenter");
  await expect(page.locator(".echart-root canvas")).toHaveCount(2);
  const over = await page.evaluate(() => {
    for (const root of document.querySelectorAll<HTMLElement>(".echart-root")) {
      Object.assign(root.parentElement!.style, { width: "200px", marginLeft: "600px" });
    }
    return document.documentElement.scrollWidth - innerWidth;
  });
  expect(over).toBeLessThanOrEqual(1);
});

// Charts used to resize only on window resize, so a box that narrowed for any
// other reason (layout change, late content) kept a stale, clipped canvas
// forever. They now observe their own box.
test("a chart redraws to fit its box when only the box changes width", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.goto("/datacenter");
  const canvases = page.locator(".echart-root canvas");
  await expect(canvases).toHaveCount(2);
  await page.evaluate(() => {
    for (const root of document.querySelectorAll<HTMLElement>(".echart-root")) {
      root.parentElement!.style.width = "300px";
    }
  });
  for (const canvas of await canvases.all()) {
    await expect.poll(() => canvas.evaluate((c) => c.getBoundingClientRect().width)).toBe(300);
  }
  expect(errors).toEqual([]);
});

test("markets tightness chart ranks markets and opens the row with county names", async ({ page }) => {
  await page.goto("/markets");
  const bars = page.locator(".mk-bars .mk-bar-row");
  expect(await bars.count()).toBeGreaterThanOrEqual(10);
  // ranked: the first bar's score is the largest
  const scores = await page.locator(".mk-bar-val strong").allTextContents();
  const nums = scores.map((t) => Number(t.replace("+", "")));
  expect(nums[0]).toBe(Math.max(...nums));
  // clicking a bar opens that market's row, whose receipts name counties
  const nova = page.getByRole("button", { name: /^Northern Virginia: tightness/ });
  await nova.click();
  await expect(page.locator("#mk-row-nova button[aria-expanded]")).toHaveAttribute("aria-expanded", "true");
  await expect(page.locator("table.data-table").first()).toContainText("Loudoun County");
  // no cents in the wage column
  await expect(page.locator("table.data-table").first().locator("> tbody")).not.toContainText(/\$\d[\d,]*\.\d\d\/wk/);
});

test("long-lead board summarizes every package and prints each vendor once", async ({ page }) => {
  await page.goto("/longlead");
  const board = page.locator(".ll-board-table tbody tr");
  expect(await board.count()).toBe(await page.locator(".ll-package").count());
  // GE Vernova serves two packages: full figures once, a pointer the second time
  await expect(page.locator("#ll-transformers .ll-seen")).toContainText("Switchgear");
  await expect(page.locator("#ll-transformers")).toContainText("Siemens Energy");
  // quotes are collapsed by default and open on demand
  const quote = page.locator(".ll-quote").first();
  await expect(quote.locator("q")).not.toBeVisible();
  await quote.locator("summary").click();
  await expect(quote.locator("q")).toBeVisible();
  // the board has a lead-time column; packages without a stated one say so
  await expect(page.locator(".ll-board-table thead")).toContainText("Lead time");
  await expect(page.locator(".ll-board-table tbody tr").first().locator("td.ll-board-lead")).toBeVisible();
  // a null note's EDGAR receipts read as short links, never raw 100-char paths
  for (const a of await page.locator(".ll-note-link").all()) {
    expect((await a.textContent())!.length).toBeLessThan(30);
  }
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
  // on a phone the board stacks: the vendor column stays on screen
  const vendors = page.locator('.ll-board-table td[data-label="What the vendors say"]').first();
  const box = (await vendors.boundingBox())!;
  expect(box.x + box.width).toBeLessThanOrEqual(390);
  // and its TEXT reflows at 320px: a grid cell can fit while unwrapped
  // contents overflow it, so measure the document and every vendor line
  await page.setViewportSize({ width: 320, height: 700 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
  const overflow = await page.locator(".ll-board-table .ll-signals li").evaluateAll((lis) =>
    lis.filter((li) => li.scrollWidth > li.clientWidth + 1).length);
  expect(overflow).toBe(0);
});

test("long-lead board leads with stated lead times once the daily run publishes them", async ({ page, request }) => {
  const ll = await (await request.get("/data/longlead.json")).json();
  const leads = ll.packages.flatMap((p: { lead_times?: unknown[] }) => p.lead_times ?? []);
  test.skip(leads.length === 0, "artifact predates lead times (2026-10-07)");
  await page.goto("/longlead");
  await expect(page.getByTestId("ll-takeaway")).toContainText("weeks from order");
  await expect(page.locator(".ll-leads").first()).toBeVisible();
  // every lead time is dated and links its source
  for (const li of await page.locator(".ll-leads > li").all()) {
    await expect(li.locator(".ll-fig-meta")).toContainText("stated");
    await expect(li.locator(".ll-fig-meta a")).toHaveAttribute("href", /^https:\/\//);
  }
});

// CI (Linux fonts) overflowed /status at 375px on a QCEW error URL that macOS
// fonts happened to fit — pin the wrap rule itself, independent of font metrics.
test("source-error text can break inside long URLs", async ({ page }) => {
  await page.goto("/status");
  const errs = page.locator("p.wrap-anywhere");
  if (await errs.count()) {
    await expect(errs.first()).toHaveCSS("overflow-wrap", "anywhere");
  }
});
