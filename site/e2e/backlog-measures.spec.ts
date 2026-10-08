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

test("an edited bare /escalation link reopens with the forward estimate its sender saw (audit F1)", async ({ page, context }) => {
  const chartLabel = (p: typeof page) => p.locator('[aria-label^="Escalated cost"]').first().getAttribute("aria-label");
  const deliver = (p: typeof page) => p.getByLabel("Deliver by").inputValue();
  const edits: [string, (p: typeof page) => Promise<void>][] = [
    ["cost", (p) => p.getByLabel("Base cost ($)").fill("10000000")],
    ["base", (p) => p.getByLabel("Base month").fill("2023-01")],
    ["basis", async (p) => { await p.getByTestId("carry-basis").selectOption({ index: 1 }); }],
  ];
  for (const [what, edit] of edits) {
    await page.goto("/escalation");
    const defaultDelivery = await deliver(page);
    expect(defaultDelivery, what).toMatch(/^\d{4}-\d{2}$/);     // a bare visit opens on a forward leg
    await edit(page);
    // the default MODE is written, never a month the reader didn't choose
    await expect(page, what).toHaveURL(/delivery=auto/);
    const seen = await chartLabel(page);
    expect(seen, what).toContain("Carried at");
    const fresh = await context.newPage();
    await fresh.goto(page.url());
    expect(await deliver(fresh), what).toBe(defaultDelivery);
    await expect.poll(() => chartLabel(fresh), { message: what }).toBe(seen);
    await fresh.close();
  }
  // a link minted without ?delivery still means "measured only"
  await page.goto("/escalation?cost=1000000");
  await expect.poll(() => deliver(page)).toBe("");
});

test("the escalation chart's accessible name states the p10–p90 endpoints (audit F10)", async ({ page }) => {
  await page.goto("/escalation");
  const label = page.locator('[aria-label^="Escalated cost"]').first();
  await expect(label).toHaveAttribute("aria-label", /Realized range \(p10–p90\) at \d{4}-\d{2}: \$[\d,]+ to \$[\d,]+; P80 allowance \$[\d,]+\./);
  // the stacked band's hidden floor series is never announced
  await expect(label).not.toHaveAttribute("aria-label", /\bp10 [\d,]+ at /);
});
