import { expect, test } from "@playwright/test";

/** Batch 6 — Project Controls last mile: landing page, portfolio, escalation polish. */

test("/project-controls links every tool and shows the three receipts", async ({ page }) => {
  await page.goto("/project-controls");
  for (const href of ["/escalation", "/portfolio", "/dc-scoreboard", "/markets", "/longlead", "/datacenter", "/compute", "/capacity"]) {
    await expect(page.locator(`.quote-board a[href="${href}"]`).first()).toBeVisible();
  }
  await expect(page.getByText("A history that cannot be restated")).toBeVisible();
  await expect(page.locator(".citation-text")).toContainText("DC Build Index");
});

test("/portfolio seeds a sample, aggregates it, and round-trips through the URL", async ({ page, browser }) => {
  await page.goto("/portfolio");
  const rows = page.locator('[data-testid="portfolio-row"]');
  await expect(rows).toHaveCount(2);
  await expect(page.locator(".kpi-label", { hasText: "Capital at base" })).toBeVisible();
  await expect(page.locator(".kpi-value").first()).toHaveText("$3,100,000,000");
  // add a project, then the URL carries three
  await page.getByRole("button", { name: "+ Add project" }).click();
  await expect(rows).toHaveCount(3);
  await expect.poll(() => page.evaluate(() => new URLSearchParams(location.search).get("p"))).toContain('"Project 3"');
  const url = page.url();
  const linked = new URL(url).searchParams.get("p");
  // a fresh context with only the link sees the same three projects. It must
  // be a NEW context: clearCookies() left localStorage holding the same three
  // projects, so the old round-trip passed even while the hydrate effect
  // ignored ?p= and fell back to storage (then overwrote the link).
  const fresh = await browser.newContext();
  const shared = await fresh.newPage();
  await shared.goto(url);
  const sharedRows = shared.locator('[data-testid="portfolio-row"]');
  await expect(sharedRows).toHaveCount(3);
  await expect(sharedRows.nth(2).getByLabel("Project name")).toHaveValue("Project 3");
  // …and the link is left as shared, not replaced by the sample
  await expect.poll(() => shared.evaluate(() => new URLSearchParams(location.search).get("p"))).toBe(linked);
  await fresh.close();
  // the same holds for a link opened over a DIFFERENT stored portfolio
  await page.evaluate(() => localStorage.setItem("macrogauge.portfolio.v1", "[]"));
  await page.goto(url);
  await expect(rows).toHaveCount(3);
  await expect.poll(() => page.evaluate(() => new URLSearchParams(location.search).get("p"))).toBe(linked);
  // remove one; localStorage persists across a plain reload without the query
  await page.locator('[data-testid="portfolio-row"]').last().getByRole("button", { name: /Remove/ }).click();
  await expect(rows).toHaveCount(2);
  await page.goto("/portfolio");
  await expect(rows).toHaveCount(2);
});

test("/portfolio reports a bad month as an error instead of a number, and carries with a band", async ({ page }) => {
  await page.goto("/portfolio");
  const first = page.locator('[data-testid="portfolio-row"]').first();
  const delivery = first.getByLabel("Delivery month");
  const min = await delivery.getAttribute("min");
  // min = anchor (last complete month) + 1 since 2026-09-26 — carry starts at
  // the anchor, so delivery = anchor + 24 months carries exactly 24.
  const [y, m] = min!.split("-").map(Number);
  const anchor = new Date(Date.UTC(y, m - 2, 1));
  const target = `${anchor.getUTCFullYear() + 2}-${String(anchor.getUTCMonth() + 1).padStart(2, "0")}`;
  await delivery.fill(target);
  await expect(first.getByText(/24mo carried/)).toBeVisible();
  await expect(page.locator(".kpi-label", { hasText: "Realized band at delivery" })).toBeVisible();
  await expect(page.getByText(/p10–p90 of like-length history on 1 project/)).toBeVisible();
  await first.getByLabel("Base estimate").fill("0");
  await expect(first.getByText("Base estimate must be greater than $0.")).toBeVisible();
});

/** anchor = the delivery input's min − 1 month (min = last complete month + 1). */
async function portfolioAnchor(page: import("@playwright/test").Page): Promise<(n: number) => string> {
  await page.goto("/portfolio");
  const min = await page.locator('[data-testid="portfolio-row"]').first().getByLabel("Delivery month").getAttribute("min");
  const [y, m] = min!.split("-").map(Number);
  return (n: number) => {
    const d = new Date(Date.UTC(y, m - 2 + n, 1));
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
  };
}
const dollars = (s: string | null) => Number((s ?? "").match(/-?\$[\d,]+/)![0].replace(/[$,]/g, ""));

test("/portfolio shows the S-curve figure beside the full carry, smaller at a positive basis", async ({ page }) => {
  const at = await portfolioAnchor(page);
  // a build half done at the anchor: start = anchor − 12, delivery = anchor + 12
  const p = [{ id: "sc1", name: "Half built", market: "nova", mw: 100, baseCost: 1_000_000_000, baseMonth: "2024-06",
    deliveryMonth: at(12), basis: "trailing3y", startMonth: at(-12) }];
  await page.goto(`/portfolio?p=${encodeURIComponent(JSON.stringify(p))}`);
  const row = page.locator('[data-testid="portfolio-row"]');
  await expect(row).toHaveCount(1);
  await expect(row.getByLabel("Construction start")).toHaveValue(at(-12));
  await expect(row.getByTestId("start-assumed")).toHaveCount(0);
  await expect(page.locator(".data-table th", { hasText: "At delivery (full carry)" })).toBeVisible();
  await expect(page.locator(".data-table th", { hasText: "S-curve (to spend midpoint)" })).toBeVisible();
  await expect(page.locator(".kpi-label", { hasText: "S-curve (to spend midpoint)" })).toBeVisible();
  const full = row.getByTestId("full-carry-cell");
  const sc = row.getByTestId("s-curve-cell");
  await expect(full).toContainText("12mo carried");
  // half spent; the rest's spend midpoint is month 16 of 24 = anchor + 4
  await expect(sc).toContainText(`50% spent · rest to ${at(4)} (4mo)`);
  const basis = await row.getByLabel("Carry basis").locator("option:checked").textContent();
  expect(basis).toMatch(/\+\d/); // positive basis
  const fullUsd = dollars(await full.textContent());
  const scUsd = dollars(await sc.textContent());
  expect(scUsd).toBeGreaterThan(0);
  expect(scUsd).toBeLessThan(fullUsd);
  await expect(page.getByTestId("s-curve-method")).toContainText("sin²(πu/2)");
});

test("/portfolio loads an old-format link without startMonth and labels the start assumed", async ({ page }) => {
  const at = await portfolioAnchor(page);
  const old = [{ id: "o1", name: "Old link", market: "nova", mw: 50, baseCost: 500_000_000, baseMonth: "2024-01", deliveryMonth: at(24), basis: "trailing3y" }];
  await page.goto(`/portfolio?p=${encodeURIComponent(JSON.stringify(old))}`);
  const row = page.locator('[data-testid="portfolio-row"]');
  await expect(row).toHaveCount(1);
  await expect(row.getByLabel("Project name")).toHaveValue("Old link");
  await expect(row.getByLabel("Construction start")).toHaveValue("");
  await expect(row.getByTestId("start-assumed")).toContainText(`assumed ${at(0)}`);
  // 24-month build starting at the anchor: nothing spent, midpoint = anchor + 12
  await expect(row.getByTestId("s-curve-cell")).toContainText(`0% spent · rest to ${at(12)} (12mo)`);
  await expect(row.getByTestId("full-carry-cell")).toContainText("24mo carried");
});

test("escalation calculator: whole-dollar formatting, month validation, extracted carry table", async ({ page }) => {
  await page.goto("/escalation?base=2022-01&cost=1000000");
  // #19: no "$1.29M" beside "$72,800" — every dollar figure is whole dollars
  await expect(page.locator(".kpi-value").first()).toHaveText(/^\$[\d,]+$/);
  await expect(page.getByText(/\$\d+\.\d+M/)).toHaveCount(0);
  // #37: the carry block still renders
  await expect(page.getByText("What you could carry")).toBeVisible();
  // #20: a malformed base month is reported as such, not as "index starts in"
  await page.goto("/escalation?base=2022-13");
  await expect(page.getByTestId("base-month-error")).toHaveCount(0); // codec rejects it: default applies
  const base = page.locator('input[type="month"]').first();
  await base.fill("");
  await expect(page.getByTestId("base-month-error")).toContainText("Enter a base month as YYYY-MM");
});
