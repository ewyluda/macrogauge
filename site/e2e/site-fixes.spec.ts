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
