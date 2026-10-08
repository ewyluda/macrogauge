import { expect, test } from "@playwright/test";
import grades from "../public/data/dc_grades.json";
import accountabilityPce from "../public/data/accountability_pce.json";

/** Batch 2 — render what was already published. */

test("/pce renders the PCE gauge KPI, its weights table and the graded calls", async ({ page }) => {
  await page.goto("/pce");
  await expect(page.getByText("PCE gauge · YoY")).toBeVisible();
  await expect(page.getByText("Official PCEPI · YoY")).toBeVisible();
  // the weights dumbbell lists all 14 components, CPI weight → PCE share
  await expect(page.getByTestId("pce-weights").locator(".dumbbell-row")).toHaveCount(14);
  // the graded-calls table is the same component /scoreboard uses; core PCE
  // calls (added 2026-09-28) get a second one once the artifact carries them
  const core = (accountabilityPce as { core?: { graded: unknown[]; pending: unknown[] } }).core;
  const coreTables = core && (core.graded.length > 0 || core.pending.length > 0) ? 1 : 0;
  await expect(page.locator("th", { hasText: "Graded on" })).toHaveCount(1 + coreTables);
  await expect(page.locator("canvas").first()).toBeVisible();
});

test("/pce and /cpi-preview show the next-PCE-print nowcast", async ({ page }) => {
  await page.goto("/pce");
  await expect(page.getByRole("heading", { name: "Next PCE print — nowcast" })).toBeVisible();
  await expect(page.getByText("PCE nowcast · MoM (SA)", { exact: true })).toBeVisible();
  await expect(page.getByText("Core PCE nowcast · MoM (SA)")).toBeVisible();
  await page.goto("/cpi-preview");
  await expect(page.getByRole("heading", { name: "Next PCE print" })).toBeVisible();
  await expect(page.getByText("PCE nowcast · MoM (SA)", { exact: true })).toBeVisible();
});

test("/escalation/grades shows the storage-tail gate verdict", async ({ page }) => {
  await page.goto("/escalation/grades");
  await expect(page.getByText("Storage (NAND) tail")).toBeVisible();
});

test("/gap carries supercore's monthly history against its official reference, and the gauge's validation (was /supercore, /vs-bls)", async ({ page }) => {
  await page.goto("/gap");
  await expect(page.getByText("Supercore vs its official reference — monthly, full history")).toBeVisible();
  await expect(page.getByText(/Correlation .* mean absolute gap/)).toBeVisible();
  await expect(page.getByTestId("validation-stats")).toContainText(/the gauge correlates [\d.]+ with a mean absolute gap of [\d.]+pp/);
  await expect(page.locator("#validation canvas").first()).toBeVisible();
});

test("/escalation/grades anchor scatter recomputes the published grade for the selected cell", async ({ page }) => {
  await page.goto("/escalation/grades?leg=strict&sb=long_run&sh=12");
  await expect(page.getByText("Expected vs realized — every vintage anchor")).toBeVisible();
  const g = (grades as { legs: Record<string, { grades: Record<string, Record<string, { n: number; shortfall_rate_pct: number }>> }> })
    .legs.strict.grades.long_run.h12;
  const caption = page.getByText(/anchors · shortfall in/);
  await expect(caption).toContainText(`${g.n} anchors`);
  await expect(caption).toContainText(`shortfall in ${g.shortfall_rate_pct.toFixed(1)}%`);
  // switching leg is mirrored into the URL and re-labels the axis caption
  await page.getByRole("button", { name: "Extended (final-revision)" }).click();
  await expect.poll(() => page.evaluate(() => location.search)).toContain("leg=extended");
  // downturn badge is rendered per leg
  await expect(page.locator("th", { hasText: /downturn/ })).toHaveCount(2);
});

test("/escalation/grades lead-lag section plots the correlation profiles", async ({ page }) => {
  await page.goto("/escalation/grades");
  await expect(page.getByText("Solid = cleared the gate")).toBeVisible();
});

test("/scoreboard backtest table carries the vintage cutoff and naive comparison", async ({ page }) => {
  await page.goto("/scoreboard");
  await expect(page.locator("th", { hasText: "Vintage cutoff" })).toHaveCount(1);
  await expect(page.locator("th", { hasText: "Naive (carry-fwd)" })).toHaveCount(1);
  await expect(page.locator("th", { hasText: "vs naive" })).toHaveCount(1);
});

test("/gap shows every variant's summary strip", async ({ page }) => {
  await page.goto("/gap");
  const tiles = page.locator(".quote-tile");
  await expect(tiles).toHaveCount(5);
  await expect(tiles.filter({ hasText: "PCE-weighted" })).toHaveCount(1);
});

test("small dead fields render: continued claims, indicator signs, fetched counts, model parameters", async ({ page }) => {
  await page.goto("/labor");
  await expect(page.getByText(/continued [\d,]+k?/i)).toBeVisible();
  await page.goto("/macro-cycle");
  await expect(page.locator("#heat th", { hasText: /^Sign$/ })).toHaveCount(1);
  await expect(page.locator("#stress th", { hasText: /^Sign$/ })).toHaveCount(1);
  await page.goto("/status");
  await expect(page.locator("th", { hasText: "Fetched" })).toHaveCount(1);
  await page.goto("/outlook");
  await expect(page.getByText("expand for every knob")).toBeVisible();
});

test("/capacity timeline tab renders the published curve", async ({ page }) => {
  await page.goto("/capacity?tab=Timeline");
  await expect(page.getByRole("tab", { name: "Timeline", selected: true })).toBeVisible();
  await expect(page.locator("svg path").first()).toBeVisible();
});

test("/macro-cycle puts heat, stress and the recession rules on one page (was /heatcheck, /stress, /recession)", async ({ page, request }) => {
  const heat = await (await request.get("/data/heatcheck.json")).json() as { history?: unknown };
  const stress = await (await request.get("/data/stress.json")).json() as { history?: unknown };
  const rec = await (await request.get("/data/recession.json")).json() as { signals: { op?: string; value: number | null }[] };
  await page.goto("/macro-cycle");
  await expect(page.getByTestId("macro-sentence")).toContainText(/recession rules/);
  await expect(page.locator("#heat canvas")).toHaveCount(heat.history ? 1 : 0);
  await expect(page.getByTestId("stress-trail")).toHaveCount(stress.history ? 1 : 0);
  const rows = page.getByTestId("recession-rules").locator("tbody tr");
  await expect(rows).toHaveCount(rec.signals.length);
  // a rule with a published numeric test shows its distance to the trigger
  const withTest = rec.signals.filter((s) => s.op && s.value != null).length;
  // (the number keeps the "Distance to trigger" header out of the count)
  await expect(page.getByTestId("recession-rules").locator("tbody").getByText(/\d(pp| pts)? to trigger$|past$/)).toHaveCount(withTest);
});

test("/matrix leads with the escalation inputs and /labor with the construction band", async ({ page, request }) => {
  const matrix = await (await request.get("/data/matrix.json")).json() as { groups: { group: string; rows: { trail?: unknown }[] }[] };
  const labor = await (await request.get("/data/labor.json")).json() as { construction?: unknown };
  const inputs = matrix.groups.filter((g) => g.group === "PIPELINE" || g.group === "LABOR COSTS").flatMap((g) => g.rows);
  await page.goto("/matrix");
  const rows = page.getByTestId("escalation-inputs").locator("tbody tr");
  await expect(rows).toHaveCount(inputs.length);
  await expect(rows.first()).toContainText("PPI all commodities");
  // a published trail draws a sparkline; the nowcast block is gone
  await expect(page.getByTestId("escalation-inputs").locator("svg[role=img]")).toHaveCount(inputs.filter((r) => r.trail).length);
  await expect(page.getByText("CPI bridge")).toHaveCount(0);
  await page.goto("/labor");
  await expect(page.getByTestId("construction-band")).toHaveCount(labor.construction ? 1 : 0);
});

test("/calculator compares cost indexes since a bid month, rebased to 100", async ({ page }) => {
  await page.goto("/calculator");
  const rows = page.getByTestId("since-table").locator("tbody tr");
  // the default picks: DC Build, switchgear, transformers, plus CPI-U once clause_series carries it
  const dc = await (await page.request.get("/data/datacenter.json")).json() as { clause_series?: { code: string }[] };
  const cpi = (dc.clause_series ?? []).some((c) => c.code === "cpi_u") ? 1 : 0;
  await expect(rows).toHaveCount(3 + cpi);
  await expect(rows.first()).toContainText("DC Build index");
  await page.getByTestId("since-picker").getByLabel("DC Hardware index").check();
  await expect(rows).toHaveCount(4 + cpi);
  await expect.poll(() => page.evaluate(() => location.search)).toContain("dc_hardware");
  // a shared link restores the bid month; the chart draws one line per pick
  await page.goto("/calculator?since=2021-01&series=dc_build,dc_ops");
  await expect(page.getByTestId("since-table").locator("thead")).toContainText("Since 2021-01");
  await expect(rows).toHaveCount(2);
  await expect(page.locator(".chart-card canvas")).toHaveCount(1);
});

test("/cpi-preview leads with the call and the forecaster spread; receipts sort by |contribution|", async ({ page }) => {
  await page.goto("/cpi-preview");
  await expect(page.getByTestId("cpi-preview-takeaway")).toContainText(/CPI.*the forecasters average [+−]\d\.\d\d% on the month/);
  await expect(page.getByTestId("forecaster-dots").locator(".fc-dots-dot").first()).toBeVisible();
  const cells = page.locator("section", { hasText: "Component receipts" }).locator("tbody tr td:nth-child(4)");
  const vals = (await cells.allInnerTexts()).map((t) => Math.abs(parseFloat(t.replace("−", "-"))));
  expect(vals.length).toBeGreaterThan(1);
  expect(vals).toEqual([...vals].sort((a, b) => b - a));
});

test("/outlook titles its chart with the takeaway and exports the component paths", async ({ page }) => {
  await page.goto("/outlook");
  await expect(page.locator("h2", { hasText: /^Inflation (climbs|rises|eases|holds) / })).toHaveCount(1);
  const section = page.locator("section", { hasText: "Component paths" });
  await section.locator("summary", { hasText: "Export data" }).click();
  const [download] = await Promise.all([page.waitForEvent("download"), section.getByRole("button", { name: /CSV/ }).click()]);
  expect(download.suggestedFilename()).toBe("macrogauge-outlook-component-paths.csv");
  // the citation rides as a leading "#" comment line; the header follows
  const lines = (await (await import("node:fs/promises")).readFile(await download.path(), "utf8")).split(/\r?\n/);
  const head = lines.find((l) => !l.startsWith("#"));
  expect(head).toBe("component,month,mom_pct,index");
});

test("DC index components drill down from /datacenter to their own page, 36 months by default", async ({ page }) => {
  await page.goto("/datacenter");
  await page.locator("#dc-drivers").getByRole("link", { name: "Power & distribution transformers" }).first().click();
  await expect(page).toHaveURL(/\/datacenter\/components\/transformers$/);
  await expect(page.locator("h1")).toContainText("of the DC Build index");
  await expect(page.locator(".kpi-label", { hasText: "Contribution to DC Build" })).toBeVisible();
  await expect(page.getByRole("button", { name: "36M", pressed: true })).toBeVisible();
  await expect(page.locator(".chart-card canvas")).toHaveCount(1);
  // a long-lead package shows its stated lead times
  await expect(page.getByTestId("dc-lead-times").locator("tbody tr").first()).toBeVisible();
  await page.getByRole("button", { name: "ALL" }).click();
  await expect.poll(() => page.evaluate(() => location.search)).toContain("win=all");
});

test("/components defaults its chart to 36 months; /my-inflation calls a small gap in line", async ({ page }) => {
  await page.goto("/components/shelter_rent");
  await expect(page.getByRole("button", { name: "36M", pressed: true })).toBeVisible();
  await page.goto("/my-inflation");
  const gap = page.getByTestId("my-gap");
  await expect(gap).toBeVisible();
  const text = await gap.innerText();
  const pp = Number(/(\d+\.\d+)pp/.exec(text)?.[1]);
  if (pp < 0.25) await expect(gap).toContainText("in line");
  else await expect(gap).toContainText(/hotter|cooler/);
});

test("household pages lead with their takeaway (session 4E)", async ({ page }) => {
  await page.goto("/pce");
  await expect(page.getByTestId("pce-overshoot")).toContainText(/when the gauge ran at least 1pp above PCEPI/);
  await page.goto("/scoreboard");
  await expect(page.getByTestId("scoreboard-takeaway")).toContainText(/has the smallest miss on CPI/);
  await expect(page.getByTestId("error-bars")).toBeVisible();
  // the benchmark tiles now sit inside the backtest section
  await expect(page.locator("section", { hasText: "Walk-forward backtest" }).locator(".kpi-label", { hasText: "Naive MAE" })).toBeVisible();
  await page.goto("/cost-of-living");
  await expect(page.getByRole("button", { name: "24M", pressed: true })).toBeVisible();
  await page.goto("/grocery");
  await expect(page.getByTestId("grocery-takeaway")).toBeVisible();
  // electricity and utility gas are off the shelf, not out of the data
  await expect(page.getByText(/^Avg price: electricity/i)).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Piped gas" })).toBeVisible();
  await page.goto("/my-inflation");
  await expect(page.getByText("Your rate minus everyone's, percentage points")).toBeVisible();
});
