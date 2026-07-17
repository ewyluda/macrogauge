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

test("12-month outlook renders its summary and forward-driver receipts", async ({ page }) => {
  await page.goto("/");
  await page.waitForLoadState("networkidle");
  await expect(page.getByText("Macrogauge outlook — next 12 months")).toBeVisible();
  await expect(page.getByText("latest complete month", { exact: false })).toBeVisible();
  await expect(page.getByText("Fuel futures", { exact: false })).toBeVisible();
  await expect(page.getByText("realized-volatility band", { exact: false })).toBeVisible();
});
