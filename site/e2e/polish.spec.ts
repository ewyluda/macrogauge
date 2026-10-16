import { expect, test } from "@playwright/test";
import grades from "../public/data/dc_grades.json";

/** Live-site polish review 2026-10-15: the eight P1s, pinned. */

test.describe("phone (390px)", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test("opening a nav group keeps the menu one column wide", async ({ page }) => {
    await page.goto("/");
    await page.locator(".mobile-menu-toggle").click();
    await page.getByRole("button", { name: /AI Infra/ }).click();
    // a wrapping column under max-height spilled the open group into an
    // off-screen second column (scrollWidth 754 at 390)
    const { sw, iw } = await page.locator(".nav-items").evaluate((n) => ({ sw: n.scrollWidth, iw: window.innerWidth }));
    expect(sw).toBeLessThanOrEqual(iw);
  });

  test("/status stacks each self-test check instead of squeezing the detail", async ({ page }) => {
    await page.goto("/status");
    const rows = page.locator("table.data-table").first().locator("tbody tr:not(.status-group)");
    const sizes = await rows.evaluateAll((trs) => trs.map((tr) => ({
      h: tr.getBoundingClientRect().height,
      w: tr.querySelector("td:last-child")!.getBoundingClientRect().width,
    })));
    expect(sizes.length).toBeGreaterThan(10);
    // was: detail column 69px wide, one row 6,577px tall
    for (const s of sizes) {
      expect(s.h).toBeLessThan(400);
      expect(s.w).toBeGreaterThan(250);
    }
  });

  test("/capacity valuation scatter is legible on a phone", async ({ page }) => {
    await page.goto("/capacity");
    const tick = page.locator(".cap-viz svg .cap-tick").first();
    await expect(tick).toBeVisible();
    // a 1000-wide viewBox drew 5px text at phone width
    const h = await tick.evaluate((t) => t.getBoundingClientRect().height);
    expect(h).toBeGreaterThanOrEqual(10);
  });
});

test("forecaster number line keeps every call's name and value clear of its neighbours", async ({ page }) => {
  await page.goto("/");
  const calls = page.locator(".numline-call");
  test.skip((await calls.count()) < 2, "fewer than two live calls on this publish");
  // each call's text box: the union of its name and its value
  const labels = await calls.evaluateAll((cs) => cs.map((c) => {
    const [n, v] = [".numline-name", ".numline-val"].map((s) => c.querySelector(s)!.getBoundingClientRect());
    return { left: Math.min(n.left, v.left), right: Math.max(n.right, v.right),
      top: Math.min(n.top, v.top), bottom: Math.max(n.bottom, v.bottom) };
  }));
  for (let i = 0; i < labels.length; i++) {
    for (let j = i + 1; j < labels.length; j++) {
      const a = labels[i], b = labels[j];
      const overlap = a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
      expect(overlap, `calls ${i} and ${j} overlap`).toBe(false);
    }
  }
});

test("/methodology changelog wraps its prose instead of running off the card", async ({ page }) => {
  await page.goto("/methodology");
  const card = page.locator(".table-card", { has: page.locator("th", { hasText: "What changed" }) });
  // the global last-column nowrap made this card 7,137px wide
  const { sw, cw } = await card.evaluate((c) => ({ sw: c.scrollWidth, cw: c.clientWidth }));
  expect(sw).toBeLessThanOrEqual(cw + 1);
});

test("/revisions prints mean |revision| unsigned, bias signed", async ({ page }) => {
  await page.goto("/revisions");
  const values = await page.locator(".kpi-row .kpi-card").evaluateAll((cs) =>
    cs.map((c) => c.textContent ?? ""));
  expect(values.length).toBeGreaterThan(0);
  for (const v of values) {
    expect(v).toContain("mean |revision|");
    // "+76k" beside "bias −68k" read as a direction
    expect(v).not.toMatch(/revision[+−]/);
  }
});

test("/datacenter states the storage tail the backtest actually allows", async ({ page }) => {
  await page.goto("/datacenter");
  const text = (await page.locator("#dc-method").innerText()).replace(/\s+/g, " ");
  const sn = (grades as { storage_nowcast?: { tail_active: boolean; verdict: string } | null }).storage_nowcast;
  expect(text).toContain("graded for a market-data tail");
  if (sn?.tail_active) expect(text).toContain("so the tail is live");
  else expect(text).not.toContain("so the tail is live");
  if (sn?.verdict === "FAIL") expect(text).toContain("currently official-only");
});
