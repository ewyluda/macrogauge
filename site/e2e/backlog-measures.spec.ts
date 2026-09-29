import { expect, test } from "@playwright/test";
import dc from "../public/data/datacenter.json";

/** Backlog #12 (2026-09-28): DC Build monthly CSV + the P80 contingency line. */

function addMonths(ym: string, n: number): string {
  const y = Number(ym.slice(0, 4));
  const m = Number(ym.slice(5, 7)) - 1 + n;
  return `${y + Math.floor(m / 12)}-${String((m % 12) + 1).padStart(2, "0")}`;
}

test("/datacenter exports the DC Build monthly index as CSV, built on click", async ({ page }) => {
  const build = dc.indexes.build;
  const codes = build.components.map((c) => c.code);
  await page.goto("/datacenter");
  const chart = page.locator(".dc-trend");
  await chart.locator("summary").filter({ hasText: "Export" }).click();
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    chart.getByRole("button", { name: "↓ Monthly index CSV" }).click(),
  ]);
  expect(download.suggestedFilename()).toBe("macrogauge-dc-build-monthly.csv");
  const { readFileSync } = await import("node:fs");
  const lines = readFileSync((await download.path())!, "utf8").trimEnd().split("\r\n");
  expect(lines[0].startsWith("# MacroGauge DC Build index, monthly")).toBe(true);
  expect(lines[1]).toBe(["month", "build_index", ...codes].join(","));
  expect(lines.length - 2).toBe(build.monthly.months.length);
  expect(lines[2].startsWith(`${build.monthly.months[0]},`)).toBe(true);
});

test("/escalation states the P80 carry and its dollar allowance for a forward leg", async ({ page }) => {
  // the forward leg starts at the last month every component covers
  const anchor = dc.indexes.build.components.map((c) => c.last_obs).sort()[0].slice(0, 7);
  await page.goto(`/escalation?base=2022-01&cost=1000000&delivery=${addMonths(anchor, 24)}`);
  const line = page.getByTestId("p80-contingency");
  await expect(line).toBeVisible();
  await expect(line).toContainText("P80");
  await expect(line).toContainText(/carry -?\d+\.\d{2}%\/yr/);
  await expect(line).toContainText("24-month windows");
  await expect(line).toContainText(/\$[\d,]+/);
});
