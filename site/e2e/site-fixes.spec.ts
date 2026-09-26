import { expect, test } from "@playwright/test";

/** Site calc/a11y/state fixes (2026-09-26 review). */

test.describe("non-US locale", () => {
  test.use({ locale: "de-DE" });
  // bare toLocaleString() rendered "1,234" at build and "1.234" in the
  // browser — a React hydration mismatch in every non-US locale
  for (const route of ["/markets", "/datacenter"]) {
    test(`${route} hydrates without a mismatch under de-DE`, async ({ page }) => {
      const errors: string[] = [];
      page.on("console", (m) => {
        if (m.type() === "error") errors.push(m.text());
      });
      page.on("pageerror", (e) => errors.push(String(e)));
      await page.goto(route);
      await page.waitForLoadState("networkidle");
      expect(errors).toEqual([]);
    });
  }
});

test("treemap scrubber and state picker have accessible names", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("slider", { name: "Replay month" })).toBeVisible();
  await page.goto("/my-inflation");
  const state = page.getByLabel("Your state");
  await expect(state).toBeVisible();
  await expect(state).toHaveValue("US");
});

test("calculator explains a pre-2018 or cleared date instead of rendering nothing", async ({ page }) => {
  await page.goto("/calculator?since=2015-06-01");
  await expect(page.getByTestId("since-empty")).toContainText("No data before 2018-01-01");
  await page.goto("/calculator");
  await expect(page.locator(".kpi-card").first()).toBeVisible();
  await page.locator('input[type="date"]').fill("");
  await expect(page.getByTestId("since-empty")).toContainText("Pick a start date");
});

test("/as-of says there is no publish before the ledger starts, not a later one", async ({ page }) => {
  await page.goto("/as-of?date=2020-01-01");
  await expect(page.getByTestId("asof-status")).toContainText(/no publish on or before 2020-01-01; the earliest is \d{4}-\d{2}-\d{2}/);
  await expect(page.getByText(/showing the last one before it/)).toHaveCount(0);
  await expect(page.locator(".kpi-row")).toHaveCount(0);
  await page.getByTestId("asof-empty").getByRole("button").click();
  await expect(page.getByTestId("asof-status")).toContainText(/^publish /);
});
