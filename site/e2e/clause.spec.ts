import { test, expect } from "@playwright/test";
import dc from "../public/data/datacenter.json";

const series = (dc as unknown as { clause_series?: { code: string; source_id: string; months: string[] }[] }).clause_series ?? [];

test("/escalation/clause settles on an official series and drafts clause text", async ({ page }) => {
  const errors: string[] = [];
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
  await page.goto("/escalation/clause");
  await expect(page.locator("h1")).toContainText("clause kit");
  if (series.length === 0) {
    await expect(page.getByText("publish with the next daily run")).toBeVisible();
  } else {
    await expect(page.getByTestId("clause-result")).toBeVisible();
    const text = page.getByTestId("clause-text");
    await expect(text).toContainText("Price adjustment.");
    await expect(text).toContainText("as first published");
    await page.getByLabel("Vintage").selectOption("latest");
    await expect(text).toContainText("as most recently published");
    await page.getByLabel("Adjustment month").fill(series[0].months[0]);
    await expect(page.getByRole("alert")).toContainText("after the base month");
  }
  expect(errors).toEqual([]);
});

test("/escalation links to the clause kit", async ({ page }) => {
  await page.goto("/escalation");
  await page.getByRole("link", { name: "price-adjustment clause kit" }).click();
  await expect(page).toHaveURL(/\/escalation\/clause/);
});
