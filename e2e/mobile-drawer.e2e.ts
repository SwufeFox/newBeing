import { expect, test } from "@playwright/test";
import { installApiMocks } from "./api-mocks.js";

/* Below 920px the grid rails are display:none; the drawer must make the
   watchlist (Markets) and research rail (Research) reachable on a phone. */
test.use({ hasTouch: true, viewport: { width: 390, height: 844 } });

test("mobile drawer opens the watchlist over the layout and closes", async ({ page }) => {
  await installApiMocks(page);
  await page.goto("/");

  const toggle = page.getByRole("button", { name: "Open watchlist drawer" });
  await expect(toggle).toBeVisible();
  await expect(page.locator(".left-rail")).toBeHidden();

  await toggle.click();
  const drawer = page.locator(".left-rail");
  await expect(drawer).toBeVisible();
  await expect(drawer.locator(".watchlist-panel")).toBeVisible();
  const dimensions = await page.evaluate(() => ({ viewportWidth: window.innerWidth, documentWidth: document.documentElement.scrollWidth }));
  expect(dimensions.documentWidth).toBeLessThanOrEqual(dimensions.viewportWidth);

  await page.keyboard.press("Escape");
  await expect(drawer).toBeHidden();

  await toggle.click();
  await expect(drawer).toBeVisible();
  await page.locator(".mobile-rail-backdrop").click({ position: { x: 370, y: 400 } });
  await expect(drawer).toBeHidden();
});

test("mobile drawer exposes the research rail in Research", async ({ page }) => {
  await installApiMocks(page);
  await page.goto("/");

  // Below 760px the topbar nav is hidden; navigation lives in the bottom bar.
  await page.locator(".mobile-mode-nav").getByRole("button", { name: "Research" }).click();
  const toggle = page.getByRole("button", { name: "Open watchlist drawer" });
  await expect(toggle).toBeVisible();
  await expect(page.locator(".primary-rail")).toBeHidden();

  await toggle.click();
  const drawer = page.locator(".primary-rail");
  await expect(drawer).toBeVisible();
  await expect(drawer).toContainText("RESEARCH · WORKSPACE");
  await drawer.getByRole("button", { name: "Close list drawer" }).click();
  await expect(drawer).toBeHidden();
});
