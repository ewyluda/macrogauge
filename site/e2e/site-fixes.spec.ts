import { expect, test } from "@playwright/test";
import gaptable from "../public/data/gaptable.json";
import methodology from "../public/data/methodology.json";
import { CURATED_INPUTS } from "../src/lib/statusSections";
import qa from "../public/data/qa.json";

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

test("/gap's supercore line claims 'daily' only when something rides live (was /supercore)", async ({ page }) => {
  await page.goto("/gap");
  const live = gaptable.variants.supercore.coverage_pct > 0;
  const line = page.getByTestId("supercore-takeaway");
  await expect(line.getByText(/tracked daily/)).toHaveCount(live ? 1 : 0);
  if (!live) await expect(line).toContainText(/latest monthly BLS-derived reading \(\w{3} \d{4}\)/);
});

// The banner is data-driven: it must appear exactly when a page's artifact
// predates pulse.json (its phase failed on the latest publish) — so the
// expectation is computed from the same JSON the build read.
const STALE_ROUTES: [string, string[]][] = [
  ["/rates", ["rates"]], ["/housing", ["housing"]], ["/labor", ["labor"]],
  ["/datacenter", ["datacenter", "longlead", "rates"]], ["/power", ["datacenter", "dc_grades"]], ["/markets", ["dc_markets"]],
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
  expect(lines[1]).toBe("date,dgs3mo,dgs2,dgs10,t5yie,t10yie,hy_oas,ig_oas,bbb_oas,dollar,spread_2s10s,spread_3m10y,real_10y");
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

test("trust pages print rounded values and readable stamps, never raw floats or ISO times", async ({ page, request }) => {
  const RAW_FLOAT = /\d+\.\d{5,}/;
  const ISO_TIME = /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/;
  for (const path of ["/stress", "/heatcheck"]) {
    await page.goto(path);
    const text = await page.locator("main").innerText();
    expect(text, path).not.toMatch(RAW_FLOAT);
    expect(text, path).not.toMatch(ISO_TIME);
  }
  // /status prints qa.json's check details verbatim: the pipeline rounds
  // them (qa._num), so this holds from the first publish after the fix —
  // value-driven, never skipped: a raw float still in the served artifact
  // must still be the artifact's, not the page's
  const qa = await (await request.get("/data/qa.json")).json() as { checks: { detail: string }[] };
  const artifactRaw = qa.checks.some((c) => RAW_FLOAT.test(c.detail));
  await page.goto("/status");
  const status = await page.locator("main").innerText();
  expect(status).not.toMatch(ISO_TIME);
  if (!artifactRaw) expect(status).not.toMatch(RAW_FLOAT);
});

test("methodology inventory is collapsed behind its source chips, every row still findable", async ({ page }) => {
  const inv = (methodology as { inventory: { source: string }[] }).inventory;
  await page.goto("/methodology");
  const details = page.locator("details.inv-details");
  await expect(details).not.toHaveAttribute("open", "");
  // closed, yet every series row stays in the DOM, so Ctrl-F finds it
  await expect(details.locator("tbody tr")).toHaveCount(inv.length);
  await expect(details.locator("tbody tr").first()).toBeHidden();
  // a source chip opens the list filtered to that source
  const src = "OPENROUTER";
  await page.getByTestId("inv-chip").filter({ hasText: new RegExp(`^${src} `) }).click();
  await expect(details).toHaveAttribute("open", "");
  await expect(details.locator("tbody tr")).toHaveCount(inv.filter((r) => r.source === src).length);
  await expect(details.locator("summary")).toContainText(`${src}: `);
  await page.getByRole("button", { name: `All (${inv.length})` }).click();
  await expect(details.locator("tbody tr")).toHaveCount(inv.length);
});

test("/status groups checks and sources by section, AI Infra first, with freshness bars and curated reviews", async ({ page }) => {
  await page.goto("/status");
  const [checks, sources, curated] = [0, 1, 2].map((i) => page.locator("table.data-table").nth(i));
  // every check sits under a section row; AI Infra leads both tables
  await expect(checks.locator("tr.status-group").first()).toContainText("AI Infra");
  await expect(sources.locator("tr.status-group").first()).toContainText("AI Infra");
  const checkRows = await checks.locator("tbody tr:not(.status-group)").count();
  expect(checkRows).toBe(qa.checks.length);
  // one freshness bar per source that has inventory rows
  await expect(sources.locator(".status-fresh").first()).toBeVisible();
  await expect(curated.locator("tbody tr")).toHaveCount(CURATED_INPUTS.length);
  await expect(curated).toContainText("Last reviewed");
});
