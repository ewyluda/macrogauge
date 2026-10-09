import { expect, test } from "@playwright/test";
import { NAV } from "../src/lib/nav";
import { ratesHeadline } from "../src/lib/ratesHeadline";

test("research theme stays consistent across client navigation", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("body")).toHaveCSS("background-color", "rgb(246, 247, 249)");
  await page.locator(".footer-links").getByRole("link", { name: "Data Centers", exact: true }).click();
  await expect(page.locator(".datacenter-dashboard")).toBeVisible();
  await expect(page.locator("body")).toHaveCSS("background-color", "rgb(246, 247, 249)");
  await page.locator(".footer-links").getByRole("link", { name: "CPI Preview", exact: true }).click();
  await expect(page.locator("h1")).toContainText("CPI Preview");
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
  await page.goto("/capacity?tab=Capacity");
  const company = page.locator(".capacity-company").first();
  await company.click();
  await expect(company).toHaveAttribute("aria-expanded", "true");
  await expect(page.locator(".capacity-site-table").first()).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
});

test("capacity dossier names its fields for readers, not by curator keys", async ({ page }) => {
  await page.goto("/capacity?tab=Capacity");
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
  await page.keyboard.press("ArrowLeft");
  await expect(page.getByRole("tab", { name: "Valuation × Execution", selected: true })).toBeFocused();
});

test("capacity leads with a takeaway and the valuation scatter, and bars scale per cohort", async ({ page }) => {
  await page.goto("/capacity");
  // the tracked, estimated universe — never a market-wide share
  await expect(page.locator("h1")).toContainText("operating AI capacity we track");
  await expect(page.getByTestId("cap-takeaway")).toContainText("market cap");
  // the default view is the scatter: market cap ≠ megawatts, above the fold
  await expect(page.getByRole("tab", { name: "Valuation × Execution", selected: true })).toBeVisible();
  await expect(page.locator(".cap-viz svg")).toBeVisible();
  // one dashed median per business type, never a pooled one
  await expect(page.locator(".cap-viz .cap-median")).toHaveCount(2);
  await expect(page.locator(".cap-viz .cap-median text").first()).toContainText("median");
  // the valuation table compares EV/MW only within a business type: GPU
  // clouds and landlords are separate groups, each with its own median
  const typeGroups = page.locator(".cap-table tr.cap-table-group");
  expect(await typeGroups.count()).toBeGreaterThanOrEqual(2);
  await expect(typeGroups.first()).toContainText("median");
  // the bars split by business — hyperscalers, GPU clouds, landlords — each
  // group on its own scale
  await page.getByRole("tab", { name: "Capacity" }).click();
  const heads = page.locator(".cap-group-head");
  await expect(heads).toHaveCount(3);
  await expect(heads.nth(1)).toContainText("GPU clouds and operators");
  await expect(heads.nth(2)).toContainText("Landlords");
  await expect(heads.first()).toContainText("bars scaled to");
  // rank numbering runs on across the groups
  const ranks = await page.locator(".cap-rank").allTextContents();
  expect(ranks.map(Number)).toEqual(ranks.map((_, i) => i + 1));
  // the Neoclouds cohort still separates GPU clouds from landlords
  await page.locator(".cap-cohort button", { hasText: "Neoclouds" }).click();
  await expect(heads).toHaveCount(2);
  // a single business (hyperscalers): one list, no group headers
  await page.locator(".cap-cohort button", { hasText: "Hyperscalers" }).click();
  await expect(heads).toHaveCount(0);
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

test("power page maps every hub with a 30-day average, named in its accessible summary", async ({ page, request }) => {
  const dc = await (await request.get("/data/datacenter.json")).json() as { power: { hubs: { label: string; avg30: number | null }[] } };
  const priced = dc.power.hubs.filter((h) => h.avg30 != null);
  await page.goto("/power");
  const map = page.getByTestId("hub-map");
  await expect(map.locator("circle")).toHaveCount(priced.length);
  const label = await map.locator("svg").getAttribute("aria-label");
  for (const h of priced) expect(label).toContain(h.label);
  // labels give way to the table on a phone; the page never scrolls sideways
  await page.setViewportSize({ width: 375, height: 812 });
  await expect(map.locator(".hub-map-label").first()).toBeHidden();
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

// Runs once the published capacity.json carries the ev_note contract (the
// daily run after this branch merges); until then it SKIPS, stating so, rather
// than passing with zero assertions against the old artifact.
test("capacity withholds EV/MW for AKAM, MARA and EQIX and says why", async ({ page, request }) => {
  const cap = await (await request.get("/data/capacity.json")).json();
  const noted = cap.companies.filter((c: { ev_note?: string }) => c.ev_note);
  test.skip(noted.length === 0, "published capacity.json predates ev_note (lands with the next daily publish)");
  expect(noted.map((c: { t: string }) => c.t).sort()).toEqual(["AKAM", "EQIX", "MARA"]);
  await page.goto("/capacity");
  for (const c of noted) {
    expect(c.ev_per_mw).toBeNull();
    // never plotted, never in the priced table
    await expect(page.locator(".cap-viz .cap-label", { hasText: new RegExp(`^${c.t}$`) })).toHaveCount(0);
    await expect(page.locator(".cap-table tbody tr", { hasText: c.t })).toHaveCount(0);
  }
  // searching one lands on an empty scatter that gives ITS reason
  for (const c of noted) {
    await page.goto(`/capacity?q=${c.t}`);
    await expect(page.locator(".cap-withheld")).toContainText(c.ev_note);
  }
});

test("build inputs page leads with a takeaway and never shows an unlabeled stand-in", async ({ page, request }) => {
  const data = await (await request.get("/data/commodities.json")).json();
  await page.goto("/commodities");
  await expect(page.locator("h1")).toContainText("on the year");
  // no KPI label carries a bit/byte unit the uppercase style would corrupt
  for (const label of await page.locator(".kpi-label").allTextContents()) expect(label).not.toMatch(/\d+\s*gb/i);
  // the page renders exactly the artifact's rows (de-duplication itself is
  // the writer's contract, pinned in test_commodities_writer)
  const rowCount = data.groups.reduce((n: number, g: { rows: unknown[] }) => n + g.rows.length, 0);
  await expect(page.locator("table.data-table tbody tr")).toHaveCount(rowCount);
});

// Runs once the published commodities.json carries chg_alt (the daily run
// after this branch merges); until then it SKIPS, saying so, instead of
// passing with zero assertions. Each check is scoped to its own row, so three
// rows sharing "since Jul 15, 2026" can't vouch for one another.
type CmRow = { code: string; label: string; chg_alt?: { pct: number; label: string }; spark_span?: string };
test("build inputs: each stand-in change and trend span renders in its own row", async ({ page, request }) => {
  const data = await (await request.get("/data/commodities.json")).json();
  const rows: CmRow[] = data.groups.flatMap((g: { rows: CmRow[] }) => g.rows);
  const alts = rows.filter((r) => r.chg_alt);
  test.skip(alts.length === 0, "published commodities.json predates chg_alt (lands with the next daily publish)");
  expect(alts.map((r) => r.code).sort()).toEqual(
    ["dramex_ddr4_16g", "dramex_ddr5_16g", "dramex_nand_mlc64", "pjm_capacity", "vast_h100_sxm"]);
  await page.goto("/commodities");
  const fmt = (v: number) => `${v > 0 ? "+" : v < 0 ? "−" : ""}${Math.abs(v).toFixed(1)}%`;
  for (const r of alts) {
    const cell = page.locator("tr", { has: page.locator("td", { hasText: new RegExp(`^${r.label.replace(/[()]/g, "\\$&")}$`) }) })
      .locator(".cm-alt");
    await expect(cell).toContainText(fmt(r.chg_alt!.pct));
    await expect(cell.locator("small")).toHaveText(r.chg_alt!.label);
  }
  for (const r of rows.filter((x) => x.spark_span)) {
    const row = page.locator("tr", { has: page.locator("td", { hasText: new RegExp(`^${r.label.replace(/[()]/g, "\\$&")}$`) }) });
    await expect(row.locator(".cm-spark small")).toHaveText(r.spark_span!);
  }
});

test("markets: the C&W pipeline column names its region and never reads a null as zero", async ({ page, request }) => {
  await page.goto("/markets");
  await expect(page.locator(".mk-table thead")).toContainText("Market pipeline");
  const data = await (await request.get("/data/dc_markets.json")).json();
  // publish-gated: market_pipeline lands with the next daily run
  test.skip(!data.market_pipeline_source, "published dc_markets.json predates market_pipeline (lands with the next daily publish)");
  type P = { key: string; market_pipeline: { mw_uc: number | null; fit: string | null; label: string | null; null_note: string | null } };
  // 7,355 MW is statewide Virginia: the row must say so beside the number
  const nova = page.locator("#mk-row-nova");
  await expect(nova.locator("td").nth(7)).toHaveText(/^7,355 MW/);
  await expect(nova).toContainText("Virginia (statewide)");
  for (const m of data.markets as P[]) {
    const row = page.locator(`#mk-row-${m.key}`);
    const p = m.market_pipeline;
    if (p.mw_uc == null) await expect(row).toContainText("not broken out by C&W");
    else if (p.fit !== "close") await expect(row).toContainText(p.label!);
  }
  // the receipt: document, page and the verbatim quote
  await page.locator("#mk-row-nova button[aria-expanded]").click();
  const receipt = page.getByTestId("mk-pipe-receipt-nova");
  await expect(receipt).toContainText("Americas Data Center Update H1 2026");
  await expect(receipt).toContainText("flipbook p. 8");
  await expect(receipt.locator("q")).toContainText("7,355MW Under Construction");
  // sortable: the largest figure leads
  await page.locator(".mk-table thead").getByRole("button", { name: /^Market pipeline/ }).click();
  const top = Math.max(...(data.markets as P[]).map((m) => m.market_pipeline.mw_uc ?? -1));
  await expect(page.locator(".mk-table tbody > tr").first().locator("td").nth(7)).toHaveText(new RegExp(`^${top.toLocaleString("en-US")} MW`));
  await expect(page.locator("#market-pipeline")).toContainText("The region is C&W");
  // a ninth column must still fit the card at desktop width, with a row open
  // (an unwrapped receipt once stretched the table to 3,250px)
  await page.setViewportSize({ width: 1440, height: 900 });
  await expect(receipt).toBeVisible();   // Northern Virginia, still open from above
  const fits = await page.locator(".mk-table").evaluate((el) => el.scrollWidth <= el.clientWidth + 1);
  expect(fits).toBe(true);
  // QCEW suppression must not hide the independent broker source receipt.
  // Hillsboro currently takes this branch; use all unavailable rows so the
  // check follows future disclosure changes too.
  for (const m of data.markets.filter((r: { available: boolean }) => !r.available)) {
    const toggle = page.locator(`#mk-row-${m.key} button[aria-expanded]`);
    await toggle.focus();
    await page.keyboard.press("Enter");
    await expect(toggle).toHaveAttribute("aria-expanded", "true");
    const sourceReceipt = page.getByTestId(`mk-pipe-receipt-${m.key}`);
    await expect(sourceReceipt).toBeVisible();
    await expect(sourceReceipt).toContainText(data.market_pipeline_source.doc);
    if (m.market_pipeline.mw_uc != null) {
      await expect(sourceReceipt).toContainText(`flipbook p. ${m.market_pipeline.page}`);
      await expect(sourceReceipt.locator("q")).toHaveText(m.market_pipeline.quote);
    } else {
      await expect(sourceReceipt).toContainText(m.market_pipeline.null_note);
    }
    await page.keyboard.press("Enter");
    await expect(toggle).toHaveAttribute("aria-expanded", "false");
    await expect(sourceReceipt).toHaveCount(0);
  }
});

test("markets: the capacity column says it is the tracker's projects, and each market trends 8 quarters", async ({ page, request }) => {
  await page.goto("/markets");
  await expect(page.locator(".mk-table thead")).toContainText("Tracked AI projects");
  await expect(page.locator(".mk-table thead")).not.toContainText("MW under constr.");
  const data = await (await request.get("/data/dc_markets.json")).json();
  type H = { key: string; counties_total: number; history?: { emp: number[]; quarters: string[]; counties: number } };
  const withHist = data.markets.filter((m: H) => (m.history?.emp.length ?? 0) > 1);
  // publish-gated: the history field lands with the next daily run
  test.skip(withHist.length === 0, "published dc_markets.json predates history (lands with the next daily publish)");
  for (const m of withHist as H[]) {
    const trend = page.locator(`#mk-row-${m.key} .mk-trend`);
    await expect(trend.locator("svg")).toBeVisible();
    await expect(trend.locator("small")).toContainText("–");
    // a headcount level is drawn neutral, never in the rate palette's red
    await expect(trend.locator("svg polyline")).toHaveAttribute("stroke", "var(--accent-sky)");
    // a line covering fewer counties than the headcount above it says so
    if (m.history!.counties < m.counties_total) {
      await expect(trend.locator("small")).toContainText(`${m.history!.counties} of ${m.counties_total} counties`);
    } else {
      await expect(trend.locator("small")).not.toContainText("counties");
    }
  }
});

test("site costs: industrial power by default, one metric drives the map and a ranked table", async ({ page }) => {
  await page.goto("/states");
  // one claim as the H1; the cohort, month and US average sit in the takeaway
  await expect(page.locator("h1")).toContainText("Industrial power costs");
  await expect(page.getByTestId("st-takeaway")).toContainText("48 contiguous states");
  await expect(page.getByRole("button", { name: "Industrial ¢/kWh", pressed: true })).toBeVisible();
  await expect(page.locator(".st-table-title")).toContainText("industrial power price");
  // ten at each end of the ranking, the middle behind a button
  const rows = page.locator(".st-table tbody tr");
  const ranks = (await page.locator(".st-table .st-rank").allTextContents()).filter((t) => t !== "—").map(Number);
  expect(ranks.slice(0, 10)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  await page.getByRole("button", { name: /states in between/ }).click();
  expect(await rows.count()).toBeGreaterThan(40);
  // switching the metric re-ranks the table and lands in the URL
  await page.getByRole("button", { name: "Construction $/wk" }).click();
  await expect(page).toHaveURL(/metric=wage/);
  await expect(page.locator(".st-table-title")).toContainText("construction wage");
  const wages = (await page.locator(".st-table tbody tr td.st-active").allTextContents())
    .filter((t) => t.startsWith("$")).map((t) => Number(t.replace(/[$,]/g, "")));
  expect(wages).toEqual([...wages].sort((a, b) => b - a));
});

test("cost of capital: takeaway H1, credit tiles instead of GDPNow/auto loans, and a /datacenter benchmark strip", async ({ page, request }) => {
  const rates = await (await request.get("/data/rates.json")).json();
  // expectations follow the published values and the page's own display
  // rule, so a small market move or a missing series is a pass, not a flake
  const expected = ratesHeadline(rates.curve.find((r: { code: string }) => r.code === "DGS10"),
    rates.credit.bbb_yield, rates.credit.bbb_move);
  const hasBbb = rates.credit.bbb_yield?.value != null;
  const hasTakeaway = expected?.detail != null;

  await page.goto("/rates");
  // one claim as the H1: BBB debt leads when it is published, else the 10-year
  await expect(page.locator("h1")).toHaveText(expected!.title);
  await expect(page.locator("h1")).toContainText(hasBbb ? "BBB corporate debt yields" : "The 10-year Treasury yields");
  const labels = await page.locator(".rt-tile .quote-label").allTextContents();
  expect(labels).not.toContain("GDPNow");
  expect(labels).not.toContain("60m auto loan");
  expect(labels).toContain("HY OAS");
  // tile meta is a block: no bare separator floats as its own flex item
  await expect(page.locator(".rt-tile .quote-meta")).toHaveCount(0);
  await expect(page.getByTestId("rates-takeaway")).toHaveCount(hasTakeaway ? 1 : 0);
  if (hasTakeaway) await expect(page.getByTestId("rates-takeaway")).toContainText("The 10-year Treasury is");
  if (expected?.detail?.includes("BBB spread moved")) await expect(page.getByTestId("rates-takeaway")).toContainText("BBB spread moved");

  await page.goto("/datacenter");
  const strip = page.locator("#dc-capital");
  await expect(strip).toContainText("Financing benchmarks");
  await expect(strip).toContainText("not a project");
  await expect(strip.locator(".kpi-card").first()).toContainText("10-year Treasury");
  await expect(strip.locator(".kpi-card", { hasText: "BBB corporate bond yield" })).toHaveCount(hasBbb ? 1 : 0);
  await expect(strip.locator("a[href='/rates']")).toBeVisible();
});

// pages moved onto the shared research-intro header: [route, method id, method prose marker]
for (const [route, method, prose] of [
  ["/rates", "#rt-method", "The market benchmarks that financing a build is priced against"],
  ["/compute", "#cp-method", "chain-linked equal-weight geometric means"],
  ["/capacity", "#cap-method", "the gap is the whole point"],
  ["/markets", "#mk-method", "State resolution averages Loudoun with Bristol"],
]) {
  test(`${route}: shared header puts a KPI in the first phone screen; the method closes the page`, async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(route);
    await expect(page.locator(".research-intro h1")).toBeVisible();
    const kpi = await page.locator(".kpi-row .kpi-card").first().boundingBox();
    expect(kpi!.y + kpi!.height).toBeLessThanOrEqual(844);
    // the method prose left the header for a closing section the as-of line links to
    await expect(page.locator(".research-intro")).not.toContainText(prose);
    await expect(page.locator(method)).toContainText(prose);
    await page.locator(`.page-asof a[href='${method}']`).click();
    await expect(page.locator(method)).toBeInViewport();
  });
}

test("index ledger: DC Build by default, a series switch in the URL, and commit links", async ({ page }) => {
  await page.goto("/as-of");
  await expect(page.getByTestId("asof-chart-title")).toContainText("DC Build YoY as published");
  await expect(page.getByRole("button", { name: "DC Build", pressed: true })).toBeVisible();
  await page.getByRole("button", { name: "DC Hardware" }).click();
  await expect(page).toHaveURL(/series=dc_hardware/);
  await expect(page.getByTestId("asof-chart-title")).toContainText("DC Hardware");
  // a live row links the ledger file's history for its publish day
  await expect(page.getByTestId("asof-commit")).toHaveAttribute("href",
    /^https:\/\/github\.com\/ewyluda\/macrogauge\/commits\/main\/store\/ledger\/pulse\.jsonl\?since=\d{4}-\d{2}-\d{2}&until=\d{4}-\d{2}-\d{2}$/);
  // a backfilled row links the exact commit that published its reading, not
  // the 2026-09-03 append (PR #69 review F1)
  await page.goto("/as-of?date=2026-08-12&series=dc_hardware");
  await expect(page.getByTestId("asof-commit")).toHaveAttribute("href",
    "https://github.com/ewyluda/macrogauge/commit/71a428c5bcc4064ad93023af5c73b7a72fa08388");
  await expect(page.getByTestId("asof-commit")).toContainText("published this reading");
  // the page states the commit it was built from
  await expect(page.getByTestId("build-sha")).toHaveAttribute("href", /\/commit\/[0-9a-f]{40}$/);
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
