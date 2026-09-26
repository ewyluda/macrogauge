import { expect, test } from "@playwright/test";
import gaptable from "../public/data/gaptable.json";
import methodology from "../public/data/methodology.json";

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

test("/supercore claims 'daily' only when something rides live", async ({ page }) => {
  await page.goto("/supercore");
  const live = gaptable.variants.supercore.coverage_pct > 0;
  await expect(page.getByText(/tracked daily/)).toHaveCount(live ? 1 : 0);
  await expect(page.locator(".kpi-label").first()).toHaveText(live ? "Supercore YoY (today)" : /^Supercore YoY \(\w{3} \d{4} BLS\)$/);
  if (!live) await expect(page.getByText(/latest monthly BLS-derived reading/)).toBeVisible();
});

// The banner is data-driven: it must appear exactly when a page's artifact
// predates pulse.json (its phase failed on the latest publish) — so the
// expectation is computed from the same JSON the build read.
const STALE_ROUTES: [string, string[]][] = [
  ["/rates", ["rates"]], ["/housing", ["housing"]], ["/labor", ["labor"]],
  ["/datacenter", ["datacenter", "dc_grades", "longlead"]], ["/markets", ["dc_markets"]],
  ["/capacity", ["capacity"]], ["/longlead", ["longlead"]], ["/commodities", ["commodities"]], ["/outlook", ["outlook"]],
];
for (const [route, files] of STALE_ROUTES) {
  test(`${route} shows the stale-phase banner iff its artifact predates pulse.json`, async ({ page, request }) => {
    const pulse = await (await request.get("/data/pulse.json")).json();
    const stamps: string[] = [];
    for (const f of files) stamps.push((await (await request.get(`/data/${f}.json`)).json()).published_at);
    const stale = stamps.some((s) => Date.parse(s) < Date.parse(pulse.published_at));
    await page.goto(route);
    await expect(page.getByTestId("stale-banner")).toHaveCount(stale ? 1 : 0);
  });
}

test("/rates builds its history CSV on click instead of inlining ~2k rows", async ({ page, request }) => {
  // the page HTML carries only the recipe: the column name appears a handful
  // of times, not once per inlined row as before
  const html = await (await request.get("/rates")).text();
  expect(html.split("spread_3m10y").length - 1).toBeLessThan(10);
  const rates = await (await request.get("/data/rates.json")).json();
  await page.goto("/rates");
  const section = page.locator("section", { hasText: "Spreads — 2s10s" }).first();
  await section.locator("summary", { hasText: "Export data" }).click();
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    section.getByRole("button", { name: "↓ CSV" }).click(),
  ]);
  expect(download.suggestedFilename()).toBe("macrogauge-rates-history.csv");
  const { readFileSync } = await import("node:fs");
  const lines = readFileSync((await download.path())!, "utf8").trimEnd().split("\r\n");
  expect(lines[0]).toBe("# MacroGauge rates history (daily, DGS10 business-day grid)");
  expect(lines[1]).toBe("date,dgs3mo,dgs2,dgs10,t5yie,t10yie,hy_oas,dollar,spread_2s10s,spread_3m10y,real_10y");
  expect(lines.length - 2).toBe(rates.history.dates.length);
  expect(lines[2].startsWith(`${rates.history.dates[0]},`)).toBe(true);
});

test("component sources table shows each series' own latest obs, not the whole source's", async ({ page }) => {
  // electricity rides EIA's monthly retail price; EIA as a source also
  // carries weekly gasoline, so the source-level date runs months ahead
  const inv = (methodology as { inventory: { code: string; latest_obs: string | null }[] }).inventory;
  const own = inv.find((r) => r.code === "eia_elec_res")!.latest_obs!;
  await page.goto("/components/electricity");
  const row = page.locator("tr", { has: page.getByText("eia_elec_res", { exact: true }) });
  await expect(row).toContainText(own);
  await expect(page.locator("th", { hasText: "Series latest obs" })).toHaveCount(1);
});
