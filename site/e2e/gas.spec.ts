import { expect, test } from "@playwright/test";
import gas from "../public/data/gas.json";

/** /gas (2026-10-19): the page renders gas.json's own numbers, never its own math. */

test("/gas: the hub table prints each published ratio in published order", async ({ page }) => {
  const hubs = (gas.power_vs_gas ?? []).filter((r) => r.ratio != null);
  test.skip(hubs.length === 0, "no hub has a ratio in this publish");
  await page.goto("/gas");
  const rows = page.getByTestId("gas-hub-table").locator("tbody tr");
  await expect(rows).toHaveCount(hubs.length);
  for (const [i, r] of hubs.entries()) {
    await expect(rows.nth(i)).toContainText(r.label);
    await expect(rows.nth(i).locator("td").nth(5)).toHaveText(r.ratio!.toFixed(1));
  }
});

test("/gas: every gas-fired deal shows its gas plant MW and burn, never a guess", async ({ page }) => {
  const deals = gas.ai_gas_deals?.deals ?? [];
  test.skip(deals.length === 0, "no gas-fired deals in this publish");
  await page.goto("/gas");
  const rows = page.getByTestId("gas-deals-table").locator("tbody tr");
  await expect(rows).toHaveCount(deals.length);
  for (const [i, d] of deals.entries()) {
    const cells = rows.nth(i).locator("td");
    // burn is computed on the gas plant's own MW; an unstated split publishes no burn
    await expect(cells.last()).toHaveText(d.bcf_d_full_output == null ? "—" : d.bcf_d_full_output.toFixed(2));
    if (d.gas_mw == null) await expect(cells.nth(3)).toContainText("not stated");
    else await expect(cells.nth(3)).toHaveText(Math.round(d.gas_mw).toLocaleString("en-US"));
  }
});

test("/gas: the fuel table has one row per EIA heat rate", async ({ page }) => {
  const rates = gas.fuel_cost?.heat_rates ?? [];
  test.skip(rates.length === 0, "no fuel block in this publish");
  await page.goto("/gas");
  const rows = page.getByTestId("gas-fuel-table").locator("tbody tr");
  await expect(rows).toHaveCount(rates.length);
  await expect(rows.first()).toContainText(`$${rates[0].fuel_usd_mwh.toFixed(2)}`);
});

test("/gas sits beside Power & Tariffs in the AI Infra nav, and /power links to it", async ({ page }) => {
  await page.goto("/power");
  const hrefs = await page.getByRole("navigation", { name: "Primary" }).locator("a").evaluateAll(
    (as) => as.map((a) => a.getAttribute("href")));
  expect(hrefs.indexOf("/gas")).toBe(hrefs.indexOf("/power") + 1);
  if (gas.power_vs_gas?.length) {
    await expect(page.getByRole("link", { name: "each hub against gas" })).toHaveAttribute("href", "/gas#power-vs-gas");
  }
});
