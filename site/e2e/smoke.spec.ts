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
  ["/matrix", "Nowcast Matrix"],
  ["/gap", "Gauge Gap"],
  ["/vs-bls", "Macrogauge vs BLS"],
  ["/next-print", "who’s where"],
  ["/heatcheck", "Economy Heat Check"],
  ["/stress", "Consumer Stress Index"],
  ["/recession", "six transparent signals"],
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
