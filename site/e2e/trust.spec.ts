import { expect, test } from "@playwright/test";
import gaptable from "../public/data/gaptable.json";
import status from "../public/data/sources_status.json";
import changes from "../public/data/changes.json";
import compute from "../public/data/compute.json";
import stress from "../public/data/stress.json";
import accountability from "../public/data/accountability_cpi.json";
import { stressWord } from "../src/lib/macroCycle";

/** Live-site polish review 2026-10-15: the P2s where the site stated
 *  something wrong or contradicted itself, pinned against the baked files. */

const publishDay = status.generated_at.slice(0, 10);
const ISO = /\d{4}-\d{2}-\d{2}/g;

test("/pce compares PCE shares with the CPI weights the headline uses today", async ({ page }) => {
  await page.goto("/pce");
  const medical = gaptable.rows.find((r) => r.component === "medical")!;
  // was 8.4% (config/basket.json's base weight) beside home's 8.3%
  await expect(page.getByTestId("pce-weights").getByRole("img", { name: /^Medical care:/ }))
    .toHaveAttribute("aria-label", new RegExp(`CPI weight ${(medical.weight * 100).toFixed(1)}%`));
});

test("/components shows each blend source's effective share, not its config weight", async ({ page }) => {
  await page.goto("/components/shelter_owned");
  const shares = await page.getByTestId("blend-share").allInnerTexts();
  // config {zori .5, aptlist .3} renormalizes to 62.5 / 37.5 when both have data
  expect(shares.map((s) => s.split("\n")[0])).toEqual(["62.5%", "37.5%"]);
  await expect(page.getByText(/config weights here sum to 80%/)).toBeVisible();
});

test("/scoreboard lists the pending call first and says the backtest actual is NSA", async ({ page }) => {
  await page.goto("/scoreboard");
  const live = page.locator("table.data-table", { has: page.locator("th", { hasText: "Called on" }) }).first();
  if (accountability.pending.length) {
    await expect(live.locator("tbody tr").first()).toContainText("pending");
  }
  await expect(page.locator("th", { hasText: "Actual (NSA, first print)" })).toHaveCount(1);
});

test("/macro-cycle grades stress on one scale", async ({ page }) => {
  await page.goto("/macro-cycle");
  const top = [...(stress.indicators as { score: number }[])].sort((a, b) => b.score - a.score)[0];
  test.skip(!top, "no stress inputs on this publish");
  // the WhyLine is the innermost block holding the label
  await expect(page.locator("div", { hasText: "Most stretched:" }).last())
    .toContainText(`of 100 (${stressWord(top.score)})`);
});

test("/revisions carries payroll revisions by sign, not by good/bad colour", async ({ page }) => {
  await page.goto("/revisions");
  const table = page.locator("table.data-table", { has: page.locator("th", { hasText: "Change rev." }) });
  const colors = await table.locator("tbody tr td:last-child").evaluateAll((tds) => tds.map((td) => (td as HTMLElement).style.color));
  expect(colors.length).toBeGreaterThan(0);
  for (const c of colors) expect(c).not.toMatch(/accent-(red|emerald)/);
});

test("both mortgage rates name their source", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByText("30Y mortgage · Freddie Mac weekly")).toBeVisible();
  await page.goto("/cost-of-living");
  const jump = page.getByTestId("col-jump");
  if (await jump.count()) {
    await expect(jump).toContainText("(Mortgage News Daily, ");
    await expect(jump).toContainText("(Freddie Mac PMMS, monthly average)");
  }
});

test("/compute dates its indexes from their base, and drops an all-empty 30d column", async ({ page }) => {
  await page.goto("/compute");
  const base = [compute.token_index.base_date, compute.gpu_index.base_date].filter(Boolean).sort()[0]!;
  const fmt = new Date(`${base}T00:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
  await expect(page.getByRole("heading", { name: `Both indexes, daily since ${fmt}` })).toBeVisible();
  const models = page.locator("table.data-table", { has: page.locator("th", { hasText: "Blended" }) });
  const any30 = compute.models.some((m) => m.chg_30d_pct != null);
  await expect(models.locator("th", { hasText: /^30d$/ })).toHaveCount(any30 ? 1 : 0);
  await expect(page.getByTestId("models-no-30d")).toHaveCount(any30 ? 0 : 1);
});

test("no forward-dated feed reads as the latest observation", async ({ page }) => {
  // home Sources strip, /status and /data: STEO 2027-12-01 sat under a green check
  const ahead = (t: string) => (t.match(ISO) ?? []).filter((d) => d > publishDay);
  await page.goto("/");
  for (const label of await page.locator("section", { hasText: "Sources" }).locator(".status-pill").allInnerTexts()) {
    if (ahead(label).length) expect(label).toMatch(/forecast to|market path to|day-ahead|dated ahead to/);
  }
  await page.goto("/status");
  const srcTable = page.locator("table.data-table", { has: page.locator("th", { hasText: "Latest obs" }) });
  for (const cell of await srcTable.locator("tbody tr:not(.status-group) td:nth-child(8)").allInnerTexts()) {
    if (ahead(cell).length) expect(cell).toMatch(/forecast to|market path to|day-ahead|dated ahead to/);
  }
  await page.goto("/data");
  const newest = await page.locator("table.data-table tbody tr td:nth-child(3)").allInnerTexts();
  for (const n of newest.filter((x) => x !== "—")) {
    expect(new Date(`${n} UTC`).toISOString().slice(0, 10) <= publishDay, n).toBe(true);
  }
});

test("/gap's contribution caption describes the mode the chart opens in", async ({ page }) => {
  await page.goto("/gap");
  const caption = page.getByTestId("contribution-caption");
  await expect(caption).toContainText("weight × (our YoY − BLS YoY)");
  await page.getByRole("button", { name: "OURS", exact: true }).click();
  await expect(caption).toContainText("the segments sum to the headline line exactly");
});

test("/changes names a biggest move only when something moved, and doesn't link to itself", async ({ page }) => {
  await page.goto("/changes");
  await expect(page.locator(".since-strip")).toHaveCount(0);
  const kpi = page.locator(".kpi-card", { has: page.locator(".kpi-label", { hasText: "Biggest component move" }) });
  const moved = (changes.components as { delta_pp: number | null }[]).some((x) => x.delta_pp != null && Math.abs(x.delta_pp) >= 0.005);
  if (moved) await expect(kpi).not.toContainText("0.00pp");
  else await expect(kpi).toContainText(changes.prev_published_at ? "no component moved" : "no previous reading");
});
