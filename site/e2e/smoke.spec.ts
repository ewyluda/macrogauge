import { expect, test, type Locator } from "@playwright/test";
import qa from "../public/data/qa.json";
import gaugeDaily from "../public/data/gauge_daily.json";

/** A delivery month `horizon` months past the END OF THE GRID, read off the
 *  picker's own `min` (which the page sets to grid-end + 1 month).
 *
 *  Never a literal like "2029-06": the grid advances every publish, so a
 *  fixed month silently drifts to a shorter horizon each month and breaks
 *  outright once the grid passes it. This repo has been bitten by dated test
 *  fixtures before. */
async function deliveryAtHorizon(input: Locator, horizon: number): Promise<string> {
  const min = await input.getAttribute("min");
  expect(min).toBeTruthy();
  const [y, m] = min!.split("-").map(Number);
  // `min` is grid-end + 1 month, i.e. horizon 1 — so horizon N is N-1 further.
  const total = y * 12 + (m - 1) + (horizon - 1);
  return `${String(Math.floor(total / 12)).padStart(4, "0")}-${String((total % 12) + 1).padStart(2, "0")}`;
}

// (route, text that proves the page's own content rendered)
const ROUTES: [string, string][] = [
  ["/", "Inflation quilt — every component, every month"],
  ["/methodology", "generated from config + live validation"],
  ["/supercore", "Supercore Services"],
  ["/my-inflation", "the official basket isn"],
  ["/calculator", "The Since-Date Calculator"],
  ["/real-wages", "Real Wage Tracker"],
  ["/cpi-preview", "Component receipts"],
  ["/scoreboard", "Forecast Scoreboard"],
  // markers must be unique to the page body — nav/footer link labels appear
  // (hidden) on every page, so bare page names would resolve to those first
  ["/matrix", "models × targets"],
  ["/gap", "where ours differs from BLS"],
  ["/vs-bls", "Macrogauge vs BLS"],
  ["/next-print", "who’s where"],
  ["/heatcheck", "Economy Heat Check"],
  ["/stress", "Consumer Stress Index"],
  ["/recession", "six transparent signals"],
  ["/datacenter", "Data Center Cost Index"],
  ["/status", "Data-integrity self-test"],
  ["/releases", "the evidence base for vintage-true grading"],
  ["/grocery", "every BLS average-price staple, monthly since 2018"],
  ["/outlook", "the next 12 months, component by component"],
  ["/cost-of-living", "the buy-in premium"],
  ["/states", "gas, power, wages"],
  ["/metros", "the 50 largest metros, ranked by rent inflation"],
  ["/labor", "the jobs market, in receipts"],
  ["/commodities", "the AI build-out basket, priced daily"],
  ["/capacity", "the gap is the whole point"],
  ["/escalation", "the math is a ratio, so the unit is yours"],
  ["/markets", "construction wages and headcount where the shovels are"],
  ["/dc-scoreboard", "did the basis you carried hold?"],
  ["/longlead", "not a lead-time quote in weeks"],
];

for (const [path, text] of ROUTES) {
  test(`renders ${path} without console errors`, async ({ page }) => {
    const errors: string[] = [];
    page.on("console", (m) => {
      if (m.type() === "error") errors.push(m.text());
    });
    page.on("pageerror", (e) => errors.push(String(e)));
    await page.goto(path);
    await expect(page.getByText(text, { exact: false }).first()).toBeVisible();
    await page.waitForLoadState("networkidle"); // let /data fetches land
    expect(errors).toEqual([]);
  });
}

// Review 2026-09-01 B2: a runtime-fetched artifact that 404s (the host serves
// an HTML not-found page) used to resolve r.json() into a SyntaxError that
// the component swallowed into "loading…" forever. Every such fetch now goes
// through lib/useJson, which checks r.ok and renders a retry line instead.
for (const [route, artifact, what] of [
  ["/my-inflation", "replay.json", "component data"],
  ["/", "compare.json", "inflation quilt data"],
] as const) {
  test(`${route} shows a failure state when ${artifact} 404s`, async ({ page }) => {
    await page.route(`**/data/${artifact}`, (r) =>
      r.fulfill({ status: 404, contentType: "text/html", body: "<h1>Not found</h1>" }),
    );
    await page.goto(route);
    await expect(page.getByText(`${what} unavailable — reload to retry`)).toBeVisible();
    await expect(page.getByText(/^loading /)).toHaveCount(0);
  });
}

test("calculator receives its narrow series at build time", async ({ page }) => {
  let gaugeRequests = 0;
  page.on("request", (request) => {
    if (request.url().endsWith("/data/gauge_daily.json")) gaugeRequests += 1;
  });
  await page.goto("/calculator");
  await expect(page.getByText("Prices since 2020-01-01")).toBeVisible();
  await page.waitForLoadState("networkidle");
  expect(gaugeRequests).toBe(0);
});

test("the lazy ECharts runtime paints a chart", async ({ page }) => {
  await page.goto("/supercore");
  await expect(page.locator("canvas").first()).toBeVisible();
});

test("data-center PNG export uses the lazy chart instance", async ({ page }) => {
  await page.addInitScript(() => {
    HTMLAnchorElement.prototype.click = function () {
      document.documentElement.dataset.testDownload =
        `${this.download}|${this.href.slice(0, 22)}`;
    };
  });
  await page.goto("/datacenter");
  await expect(page.locator("canvas").first()).toBeVisible();
  await page.getByRole("button", { name: "Export PNG" }).first().click();
  await expect(page.locator("html")).toHaveAttribute(
    "data-test-download",
    "macrogauge-dc-index.png|data:image/png;base64,",
  );
});

test("markets sortable controls preserve column-header semantics", async ({ page }) => {
  await page.goto("/markets");
  const head = page.locator("table.data-table thead");

  // The interactive control belongs INSIDE the th: putting role="button" on
  // the th itself removes its columnheader role and breaks data-cell/header
  // associations for screen-reader table navigation.
  await expect(head.getByRole("columnheader")).toHaveCount(7);
  await expect(head.getByRole("button")).toHaveCount(6);

  const wageYoy = head.getByRole("columnheader", { name: /^Wage YoY/ });
  await expect(wageYoy).toHaveAttribute("aria-sort", "descending");

  await head.getByRole("button", { name: /^Market/ }).click();
  await expect(
    head.getByRole("columnheader", { name: /^Market/ })
  ).toHaveAttribute("aria-sort", "descending");
  await expect(wageYoy).not.toHaveAttribute("aria-sort");
});

test("quilt module renders month cells and grocery cards render prices", async ({ page }) => {
  await page.goto("/");
  await page.waitForLoadState("networkidle");
  await expect(page.getByText("OURS: CPI-Comparable")).toBeVisible();
  await expect(page.getByText("Eggs (dozen)")).toBeVisible();
});

test("peer calibration panel labels every column's basis", async ({ page }) => {
  await page.goto("/datacenter");
  await page.waitForLoadState("networkidle");
  // the basis badge is the load-bearing label, and it has to live in the COLUMN
  // HEADER — a peer column without one reads as a like-for-like comparison,
  // which it is not. Scoping to the thead is the assertion that matters.
  const header = page.locator("thead", { hasText: "Our DC Build" });
  await expect(header.getByText("T&T DCCI", { exact: true })).toBeVisible();
  await expect(header.getByText("Turner BCI", { exact: true })).toBeVisible();
  await expect(header.getByText("BLS office PPI", { exact: true })).toBeVisible();
  await expect(header.getByText("cost model", { exact: true })).toBeVisible();
  await expect(header.getByText("bid-price proxy", { exact: true })).toBeVisible();
  await expect(header.getByText("output price", { exact: true })).toBeVisible();
  await expect(header.getByText("input cost", { exact: true })).toBeVisible();
  // only the BLS column is our own arithmetic off published levels
  await expect(header.getByText("computed by us", { exact: true })).toHaveCount(1);
  // Turner Construction and Turner & Townsend are unrelated firms; both peers
  // must carry the full firm name somewhere on the page
  await expect(page.getByText("Turner Construction", { exact: false }).first())
    .toBeVisible();
});

test("my-inflation state selector localizes the headline", async ({ page }) => {
  await page.goto("/my-inflation");
  await page.waitForLoadState("networkidle");
  await page.getByRole("combobox").selectOption("TX");
  await expect(page.getByText("components localized", { exact: false })).toBeVisible();
});

test("12-month outlook renders its summary and forward-driver receipts", async ({ page }) => {
  await page.goto("/");
  await page.waitForLoadState("networkidle");
  await expect(page.getByText("Macrogauge outlook — next 12 months")).toBeVisible();
  await expect(page.getByText("latest complete month", { exact: false })).toBeVisible();
  await expect(page.getByText("Fuel futures", { exact: false })).toBeVisible();
  await expect(page.getByText("realized-volatility band", { exact: false })).toBeVisible();
});

test("escalation calculator responds to a new base month", async ({ page }) => {
  await page.goto("/escalation");
  await page.waitForLoadState("networkidle");
  await expect(page.getByText("Total escalation")).toBeVisible();
  await expect(page.getByText("What drove it")).toBeVisible();

  const card = page.getByText("Total escalation").locator("..");
  const before = await card.innerText();
  // Task 7 added a second month input (DELIVER BY), so the bare locator is
  // no longer unique — scope to the first one (BASE MONTH) to preserve this
  // test's original behavior.
  await page.locator('input[type="month"]').first().fill("2019-01");
  // toHaveText auto-retries until the assertion passes or times out, so it
  // rides out the React re-render triggered by fill() instead of racing it
  // with a single innerText() snapshot (CI flake risk on a route the daily
  // bot's commits exercise every morning).
  await expect(card).not.toHaveText(before);

  // Task 5's fix round added a TOTAL/Headline reconciliation footer to the
  // bridge table — the label "TOTAL" also appears (as a substring) in the
  // table's own subtitle and in the methodology copy below it, so scope to
  // the tfoot and require an exact match to avoid a strict-mode violation.
  await expect(
    page.locator("tfoot").getByText("TOTAL", { exact: true })
  ).toBeVisible();
});

test("escalation calculator prompts instead of showing $0 when base cost is cleared", async ({ page }) => {
  await page.goto("/escalation");
  await page.waitForLoadState("networkidle");
  await expect(page.getByText("Total escalation")).toBeVisible();

  const costInput = page.locator('input[type="number"]');
  await costInput.fill("0");
  await expect(
    page.getByText("Enter a base cost greater than $0 to see the escalation.")
  ).toBeVisible();

  await costInput.fill("9000000");
  await expect(
    page.getByText("Enter a base cost greater than $0 to see the escalation.")
  ).not.toBeVisible();
  await expect(page.getByText("Total escalation")).toBeVisible();
});

test("escalation calculator projects forward when a delivery month is set", async ({
  page,
}) => {
  await page.goto("/escalation");
  await expect(page.getByText("Total escalation")).toBeVisible();

  // The basis table is visible from the start — the five realized regimes are
  // informative on their own, and Task 7 gates it on `anchor`, not on a
  // delivery month. What must NOT be present yet is the forward leg itself:
  // the per-window factor column and the band sentence both need a horizon.
  //
  // NOTE: page.getByText(/independent/) is unusable as the gating signal —
  // it always matches at least two elements regardless of calculator state:
  // the site-wide header tagline ("An independent daily gauge...") and the
  // static Methodology copy below the calculator ("...number of independent
  // draws behind it..."), both present on first load. "overlapping windows"
  // (no "historical" in between) is unique to the band sentence itself — the
  // Methodology copy's parallel phrase is "overlapping historical windows".
  await expect(page.getByText("What you could carry")).toBeVisible();
  await expect(page.getByText("overlapping windows")).toHaveCount(0);

  const deliver = page.locator('input[type="month"]').nth(1);
  const max = await deliver.getAttribute("max");
  expect(max).toBeTruthy();
  await deliver.fill(max!);

  await expect(page.getByText("What you could carry")).toBeVisible();
  await expect(page.getByText("overlapping windows")).toBeVisible();
  await expect(page.getByText(/Escalated to /).last()).toBeVisible();
});

test("escalation calculator refuses a delivery month past the cap", async ({ page }) => {
  await page.goto("/escalation");
  const deliver = page.locator('input[type="month"]').nth(1);
  await deliver.fill("2099-01");
  await expect(
    page.getByText(/Pick a delivery month between/)
  ).toBeVisible();
});

test("escalation delivery picker's own minimum is accepted, not rejected", async ({
  page,
}) => {
  await page.goto("/escalation");
  const deliver = page.locator('input[type="month"]').nth(1);
  // The native picker offers `min` as a selectable value, so `min` must itself
  // be valid. It used to be `lastMonth`, which deliveryValid rejects (it
  // requires a strictly later month), so choosing the picker's own minimum
  // produced the out-of-range error.
  const min = await deliver.getAttribute("min");
  expect(min).toBeTruthy();
  await deliver.fill(min!);
  await expect(page.getByText(/Pick a delivery month between/)).toHaveCount(0);
  await expect(page.getByText("What you could carry")).toBeVisible();
  await expect(page.getByText(/Escalated to /).last()).toBeVisible();
});

test("escalation basis table lists a downturn regime", async ({ page }) => {
  await page.goto("/escalation");
  const deliver = page.locator('input[type="month"]').nth(1);
  const max = await deliver.getAttribute("max");
  await deliver.fill(max!);
  // the 2008-12 -> 2011-12 window only resolves because of the deep backfill.
  // Scope to the basis table's own cell — the same label text also appears
  // (as an <option>) in the CARRY <select>, a strict-mode violation for a
  // bare getByText.
  await expect(
    page.locator("td", { hasText: "Downturn regime (GFC)" })
  ).toBeVisible();
});

test("escalation says why there's no band under a sub-12-month delivery window", async ({
  page,
}) => {
  await page.goto("/escalation");
  const deliver = page.locator('input[type="month"]').nth(1);
  // The input's own `min` is one month past the grid end, i.e. horizon 1 —
  // the shortest window there is, and well inside MIN_HORIZON_MONTHS (12).
  // Using it directly avoids reimplementing month arithmetic here (that
  // arithmetic now lives, tested, in lib/dcEscalation.ts as addMonths).
  const min = await deliver.getAttribute("min");
  expect(min).toBeTruthy();
  await deliver.fill(min!);

  // Bases still apply at a short horizon; the band does not, and the page
  // must say so rather than silently omitting it (spec §5.3.1's last bullet).
  await expect(page.getByText("No realized band here")).toBeVisible();
  await expect(page.getByText("overlapping windows")).toHaveCount(0);

  // A longer delivery (the input's own max) gets the band instead of the
  // explanation — the two are mutually exclusive, not both/neither.
  const max = await deliver.getAttribute("max");
  await deliver.fill(max!);
  await expect(page.getByText("overlapping windows")).toBeVisible();
  await expect(page.getByText("No realized band here")).toHaveCount(0);
});

test("escalation shows a paired-leg grade for the selected basis", async ({
  page,
}) => {
  await page.goto("/escalation");
  await expect(page.getByText("Total escalation")).toBeVisible();

  // Set a delivery month 36 months past the grid end — the 36-month graded
  // horizon, where the strict leg withholds (published_horizons is [12, 24]
  // only) and the extended leg grades, exercising the paired withheld/graded
  // render in one shot. Derived from the picker's own min, not a fixed month:
  // the intent is "36 months out", and that must survive the grid advancing.
  const delivery = page.locator('input[type="month"]').last();
  await delivery.fill(await deliveryAtHorizon(delivery, 36));
  await delivery.blur();

  // The verdict must name BOTH samples — never one alone. Default CARRY
  // selection on load is "Trailing 3yr", which has a grading counterpart
  // (trailing_3yr), so this exercises the graded/withheld paired render,
  // not the ungradeable-scenario note.
  const verdict = page.getByTestId("basis-grade");
  await expect(verdict).toBeVisible();
  await expect(verdict).toContainText("vintage-true sample");
  await expect(verdict).toContainText("deeper sample");
  await expect(page.getByRole("link", { name: /how each basis has held up/i }))
    .toBeVisible();
});

test("escalation renders the ungradeable note for a hindsight-selected regime", async ({
  page,
}) => {
  await page.goto("/escalation");
  await expect(page.getByText("Total escalation")).toBeVisible();

  const delivery = page.locator('input[type="month"]').last();
  await delivery.fill(await deliveryAtHorizon(delivery, 36));
  await delivery.blur();

  // Switch CARRY to one of the two absolute, hand-picked historical windows
  // (GFC / COVID) — dcContingency.ts's BASES — which have no counterpart in
  // dcGrades.ts's rule vocabulary by design. Selecting one must swap the
  // paired verdict for the ungradeable note, never leave a verdict or a
  // blank behind.
  await page.locator("select").selectOption("gfc");

  const verdict = page.getByTestId("basis-grade");
  await expect(verdict).toBeVisible();
  await expect(verdict).toContainText("hindsight-selected historical episode");
  await expect(verdict).not.toContainText("vintage-true sample");
  await expect(verdict).not.toContainText("deeper sample");
  await expect(page.getByRole("link", { name: /the bases that do/i }))
    .toBeVisible();
});

test("datacenter renders the power-nowcast grade from the artifact", async ({
  page,
}) => {
  await page.goto("/datacenter");
  await expect(page.getByText(/like-month year-ratio nowcast/)).toBeVisible();
  // the stale hardcoded pair must be gone, from anywhere on the page
  await expect(page.getByText("best MAE 8.5 vs 5.2 YoY pts")).toHaveCount(0);
  // and the live figures must be present with an as-of
  const grade = page.getByTestId("power-nowcast-grade");
  await expect(grade).toBeVisible();
  await expect(grade).toContainText("MAE");
  await expect(grade).toContainText("as of");
  // The verdict itself must be on the page, and the English beside it must be
  // the clause for THAT verdict — the claim used to be a hardcoded "it lost",
  // which a flip to PASS would have left standing next to correct numbers.
  await expect(grade).toContainText(/FAIL|PASS|INSUFFICIENT/);
  const text = (await grade.textContent()) ?? "";
  if (text.includes("FAIL")) {
    expect(text).toContain("failed the pre-registered backtest gate");
  } else {
    expect(text).not.toContain("failed the pre-registered backtest gate");
  }
  // No verdict may claim a specific losing comparison -- FAIL does not
  // guarantee which of the gate's three conditions missed.
  expect(text).not.toContain("lost to simple carry-forward");
});

test("dc-scoreboard never renders the lead-lag verdict without its caveats and conclusion", async ({
  page,
}) => {
  await page.goto("/dc-scoreboard");
  // Rule 2 of the grades feature: the verdict / weight_stable figure and the
  // gate's caveats + standing conclusion live in ONE visual block -- a reader
  // must not be able to screenshot the positive alone. Pin the adjacency by
  // asserting all three render inside the same featured container.
  const block = page
    .locator(".section-featured")
    .filter({ hasText: "Verdict:" });
  await expect(block).toBeVisible();
  await expect(block).toContainText("Conclusion:");
  await expect(block).toContainText("No forward model is warranted");
  // A positive verdict must carry at least one caveat list item beside it.
  const verdictText = (await block.textContent()) ?? "";
  if (verdictText.includes("stable lead was found")) {
    await expect(block.locator("li").first()).toBeVisible();
  }
});

test("dc-scoreboard's cross-horizon means name the horizons they cover", async ({
  page,
}) => {
  await page.goto("/dc-scoreboard");
  // The inversion's means are page-level aggregates, so the page must say
  // which horizons they span — and they must span the SAME set on both legs.
  const inversion = page.getByText(/Every mean in this section covers/);
  await expect(inversion).toBeVisible();
  await expect(inversion).toContainText("both legs publish");
  // The 286 anchor rows are not serialized into this page; they are linked.
  await expect(
    page.getByRole("link", { name: "/data/dc_grades.json" })
  ).toBeVisible();
  // The lead-lag coverage sentence states BOTH shares against Build weight —
  // "of that weight" would make the cleared share read ~2.2x too small.
  await expect(page.getByText(/of Build weight cleared the pre-registered gate/))
    .toBeVisible();
});

test("datacenter long-lead strip links to the board", async ({ page }) => {
  await page.goto("/datacenter");
  const strip = page.getByTestId("longlead-strip");
  await expect(strip).toBeVisible();
  await strip.getByRole("link", { name: /long-lead board/i }).click();
  await expect(page).toHaveURL(/\/longlead\/?$/);
});

test("mobile header is compact, sticky, and opens an accordion navigation sheet", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");

  const header = page.locator(".site-header");
  const menuButton = page.getByRole("button", { name: "Open navigation" });
  expect((await header.boundingBox())?.height).toBe(56);
  expect((await menuButton.boundingBox())?.height).toBe(44);
  await expect(page.locator(".nav-items")).not.toBeVisible();

  await page.evaluate(() => window.scrollTo(0, 500));
  expect((await header.boundingBox())?.y).toBe(0);

  await menuButton.click();
  await expect(page.getByRole("button", { name: "AI Infra" })).toBeVisible();
  await page.getByRole("button", { name: "AI Infra" }).click();
  const sheet = page.locator(".nav-items");
  await expect(sheet.getByRole("link", { name: "Data Centers" })).toBeVisible();
  await expect(sheet.getByRole("link", { name: "Long-Lead Board" })).toBeVisible();
});

test("header self-test severity distinguishes advisory and critical failures", async ({
  page,
}) => {
  await page.goto("/");
  const failed = qa.checks.filter((check) => !check.pass);
  const critical = failed.filter((check) => check.critical).length;
  const advisory = failed.length - critical;
  const pill = page.locator(".site-header .status-pill");

  if (critical > 0) {
    await expect(pill).toHaveClass(/status-pill-critical/);
    await expect(pill).toContainText(`${critical} critical`);
  } else if (advisory > 0) {
    await expect(pill).toHaveClass(/status-pill-advisory/);
    await expect(pill).toContainText(
      `${advisory} advisor${advisory === 1 ? "y" : "ies"}`,
    );
  } else {
    await expect(pill).toHaveClass(/status-pill-ok/);
    await expect(pill).toContainText(`Self-test ${qa.passed}/${qa.total}`);
  }
});

test("project-controls toolkit precedes data-center KPIs and links all four tools", async ({
  page,
}) => {
  await page.goto("/datacenter");
  const cards = page.locator(".project-tool-card");
  await expect(cards).toHaveCount(4);
  await expect(cards).toHaveText([
    /Escalation calculator/,
    /Market tightness/,
    /AI capacity/,
    /Long-lead board/,
  ]);
  const toolkitBox = (await page.locator(".project-toolkit").boundingBox())!;
  const kpiTop = (await page.locator(".kpi-row").first().boundingBox())!.y;
  expect(toolkitBox.y + toolkitBox.height).toBeLessThan(kpiTop);
});

test("capacity KPI cards form one desktop row and equal mobile columns", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/capacity");
  const cards = page.locator(".kpi-row").first().locator(".kpi-card");
  const desktopBoxes = await cards.evaluateAll((nodes) =>
    nodes.map((node) => node.getBoundingClientRect().toJSON()),
  );
  expect(new Set(desktopBoxes.map((box) => Math.round(box.y))).size).toBe(1);

  await page.setViewportSize({ width: 390, height: 844 });
  const mobileBoxes = await cards.evaluateAll((nodes) =>
    nodes.map((node) => node.getBoundingClientRect().toJSON()),
  );
  expect(new Set(mobileBoxes.map((box) => Math.round(box.width))).size).toBe(1);
  expect(mobileBoxes.every((box) => box.width >= 340)).toBe(true);
});

test("tapping page content closes the mobile navigation sheet", async ({
  browser,
}) => {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    hasTouch: true,
  });
  const page = await context.newPage();
  await page.goto("/");
  await page.getByRole("button", { name: "Open navigation" }).click();
  const sheet = page.locator(".nav-items");
  await expect(sheet).toBeVisible();
  await page.touchscreen.tap(200, 800);
  await expect(sheet).not.toBeVisible();
  await context.close();
});

test("mouse hover does not toggle accordion groups inside the mobile sheet", async ({
  page,
}) => {
  await page.setViewportSize({ width: 600, height: 900 });
  await page.goto("/");
  await page.getByRole("button", { name: "Open navigation" }).click();
  const group = page.locator(".nav-group").first();
  await group.hover();
  await expect(group).not.toHaveClass(/open/);
  await page.mouse.move(5, 850);
  await expect(group).not.toHaveClass(/open/);
});

test("mobile header keeps both headline metric pills above the fold", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/markets");
  const strip = page.locator(".mobile-metrics");
  await expect(strip).toBeVisible();
  await expect(strip).toContainText("DC BUILD");
  await expect(strip).toContainText("MACROGAUGE");
  const box = (await strip.boundingBox())!;
  expect(box.y + box.height).toBeLessThan(844);
});

test("home headline grid leaves no empty cells at tablet widths", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1024, height: 900 });
  await page.goto("/");
  const grid = (await page.locator(".headline-grid").boundingBox())!;
  const boxes = await page
    .locator(".headline-grid .kpi-card")
    .evaluateAll((nodes) => nodes.map((n) => n.getBoundingClientRect().toJSON()));
  expect(boxes).toHaveLength(5);
  const primary = boxes[0];
  expect(Math.round(primary.width)).toBe(Math.round(grid.width));
  const comparators = boxes.slice(1);
  expect(new Set(comparators.map((b) => Math.round(b.y))).size).toBe(1);
  const right = Math.max(...comparators.map((b) => b.x + b.width));
  expect(Math.round(right)).toBe(Math.round(grid.x + grid.width));
});

test("single-card KPI rows stay content-sized on desktop", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/stress");
  const card = (await page.locator(".kpi-row .kpi-card").first().boundingBox())!;
  expect(card.width).toBeLessThan(700);
});

test("home hero chart payload is cut to the 24-month window", async ({
  request,
}) => {
  // ECharts sizes the y-axis from every point it is handed, so the fix is to
  // hand it only the window: the pre-window daily dates must not reach the page.
  const html = await (await request.get("/")).text();
  const first = gaugeDaily.variants.gauge.dates[0];
  const last = gaugeDaily.variants.gauge.dates.at(-1)!;
  expect(first < "2019-01-01").toBe(true);
  expect(html).not.toContain(first);
  expect(html).toContain(last);
});
