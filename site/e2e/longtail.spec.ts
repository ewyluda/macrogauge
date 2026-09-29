import { test, expect } from "@playwright/test";
import grocery from "../public/data/grocery_basket.json";
import geo from "../public/data/geo.json";
import metros from "../public/data/metros.json";
import { grocerySlug, metroSlug, stateSlug } from "../src/lib/longtail";

const pages = [
  `/grocery/${grocerySlug(grocery.items[0].name)}`,
  `/states/${stateSlug(geo.states[0].state)}`,
  `/metros/${metroSlug(metros.metros[0].name)}`,
];

for (const path of pages) {
  test(`long-tail page ${path} renders with its own title and no console errors`, async ({ page }) => {
    const errors: string[] = [];
    page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
    const res = await page.goto(path);
    expect(res?.status()).toBe(200);
    await expect(page.locator("h1")).toBeVisible();
    await expect(page.locator(".kpi-row").first()).toBeVisible();
    expect(await page.title()).not.toBe("macrogauge — daily US inflation & macro");
    expect(errors).toEqual([]);
  });
}

test("index pages link to the detail pages", async ({ page }) => {
  await page.goto("/states");
  await page.getByRole("link", { name: geo.states[0].name, exact: true }).first().click();
  await expect(page).toHaveURL(new RegExp(`/states/${stateSlug(geo.states[0].state)}`));
});

test("badges are SVG and per-route social cards are PNG", async ({ request }) => {
  for (const b of ["/badge/gauge.svg", "/badge/dc-build.svg"]) {
    const r = await request.get(b);
    expect(r.status()).toBe(200);
    expect((await r.text()).startsWith("<svg")).toBe(true);
  }
  for (const og of ["/cpi-preview/opengraph-image", "/datacenter/opengraph-image", "/components/fuel/opengraph-image"]) {
    const r = await request.get(og);
    expect(r.status()).toBe(200);
    const body = await r.body();
    expect(body.subarray(1, 4).toString()).toBe("PNG");
  }
});

test("sitemap lists the long-tail pages", async ({ request }) => {
  const sm = await (await request.get("/sitemap.xml")).text();
  for (const p of pages) expect(sm).toContain(p);
});
