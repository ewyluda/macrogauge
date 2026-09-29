import { expect, test } from "@playwright/test";
import pulse from "../public/data/pulse.json";
import gaptable from "../public/data/gaptable.json";
import methodology from "../public/data/methodology.json";
import official from "../public/data/official.json";
import fuel from "../public/data/fuel.json";
import outlook from "../public/data/outlook.json";

/** Backlog #7 (review 2026-09-26): the homepage reconciles its three CPI
 *  numbers; /gap grades supercore and PCE against their own prints. */

const pp = (v: number) => {
  const r = Number(v.toFixed(2));
  return `${r > 0 ? "+" : r < 0 ? "−" : ""}${Math.abs(r).toFixed(2)}pp`;
};

test("homepage reconciliation strip: official → reconstruction → ours, from the published JSON", async ({ page }) => {
  await page.goto("/");
  const strip = page.getByTestId("recon-strip");
  await expect(strip).toBeVisible();
  const recon = methodology.validation.bls_reconstruction;
  await expect(strip.getByTestId("recon-official")).toHaveText(`${pulse.official.yoy_pct.toFixed(2)}%`);
  await expect(strip.getByTestId("recon-reconstruction")).toHaveText(`${recon.weighted_bls_yoy_pct.toFixed(2)}%`);
  await expect(strip.getByTestId("recon-gauge")).toHaveText(`${pulse.gauge.yoy_pct.toFixed(2)}%`);
  const err = Math.round((recon.weighted_bls_yoy_pct - pulse.official.yoy_pct) * 100) / 100;
  await expect(strip.getByTestId("recon-decomposition-error")).toContainText(pp(err));
  await expect(strip.getByTestId("recon-decomposition-error")).toContainText("decomposition error");
  await expect(strip.getByTestId("recon-component-gaps")).toContainText(pp(gaptable.total_gap_pp));
  await expect(strip).toContainText(`Headline gap ${pp(pulse.gap_pp)}`);
});

test("homepage tiles carry two decimals; gas prices name their source; treemap says reconstructed", async ({ page }) => {
  await page.goto("/");
  const { cpi, core } = official.headline;
  const cpiTile = page.locator(".kpi-card", { hasText: "Official CPI · YoY" });
  await expect(cpiTile.locator(".kpi-value")).toHaveText(`${cpi.yoy_pct.toFixed(2)}%`);
  await expect(cpiTile).toContainText(`previous ${cpi.prev_yoy_pct.toFixed(2)}%`);
  const coreTile = page.locator(".kpi-card", { hasText: "Core CPI · YoY" });
  await expect(coreTile.locator(".kpi-value")).toHaveText(`${core.yoy_pct.toFixed(2)}%`);
  await expect(coreTile).toContainText(`previous ${core.prev_yoy_pct.toFixed(2)}%`);

  const market = page.locator(".market-panel");
  await expect(market).toContainText("Regular gas · EIA weekly");
  if (fuel.pump != null) await expect(market).toContainText(`AAA daily pump $${fuel.pump.toFixed(2)}`);

  await expect(page.getByText(/BLS reconstructed \d+\.\d{2}%/)).toBeVisible();
});

test("homepage outlook widget explains its index-level starting point", async ({ page }) => {
  await page.goto("/");
  const caveat = page.getByTestId("outlook-caveat");
  await expect(caveat).toContainText(`${outlook.latest_complete_month_yoy_pct.toFixed(2)}%`);
  await expect(caveat).toContainText("index-level YoY");
  await expect(caveat).toContainText("not the own-observation headline");
});

test("/gap grades supercore vs core CPI and the PCE gauge vs PCEPI", async ({ page }) => {
  await page.goto("/gap");
  const strip = page.getByTestId("gap-variant-strip");
  const cases: [string, number | null, { yoy_pct: number }, string][] = [
    ["supercore", gaptable.variants.supercore.yoy_pct, official.headline.core, "core CPI"],
    ["pce", gaptable.variants.pce.yoy_pct, official.headline.pce, "PCEPI"],
    ["gauge", gaptable.variants.gauge.yoy_pct, official.headline.cpi, "official CPI"],
  ];
  for (const [key, yoy, ref, label] of cases) {
    const tile = strip.locator(`[data-variant="${key}"]`);
    await expect(tile.locator(".quote-group")).toHaveText(`vs ${label}`);
    if (yoy != null) {
      const gap = Math.round((yoy - ref.yoy_pct) * 100) / 100;
      await expect(tile.locator(".quote-meta")).toContainText(`${pp(gap)} vs `);
      await expect(tile.locator(".quote-meta")).toContainText(`${label} ${ref.yoy_pct.toFixed(2)}%`);
    }
  }
});
