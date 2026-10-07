import { expect, test } from "@playwright/test";

/** Batch 6 — escalation calculator polish. */

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
