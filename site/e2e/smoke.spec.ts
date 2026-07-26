import { expect, test } from "@playwright/test";

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
