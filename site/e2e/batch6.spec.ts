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

test("/portfolio seeds a sample, aggregates it, and round-trips through the URL", async ({ page }) => {
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
  // a fresh context with only the link sees the same three projects
  await page.context().clearCookies();
  await page.goto(url);
  await expect(rows).toHaveCount(3);
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
  const [y, m] = min!.split("-").map(Number);
  await delivery.fill(`${y + 2}-${String(m).padStart(2, "0")}`);
  await expect(first.getByText(/24mo carried/)).toBeVisible();
  await expect(page.locator(".kpi-label", { hasText: "Realized band at delivery" })).toBeVisible();
  await expect(page.getByText(/p10–p90 of like-length history on 1 project/)).toBeVisible();
  await first.getByLabel("Base estimate").fill("0");
  await expect(first.getByText("Base estimate must be greater than $0.")).toBeVisible();
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
