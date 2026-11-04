import { expect, test } from "@playwright/test";
import { installApiMocks } from "./api-mocks.js";

/* Coarse pointers have no hover and cannot reliably hit a 22px control. Keep
   the tablet-width rail visible so the watchlist and chart controls are
   measurable in their real layout. */
test.use({ hasTouch: true, viewport: { width: 1024, height: 900 } });

test("touch controls stay visible and reach a 44px target without hover", async ({ page }) => {
  await installApiMocks(page);
  await page.goto("/");

  const watchlist = page.locator(".watchlist-panel");
  await expect(watchlist).toBeVisible();
  const add = page.getByRole("button", { name: "Add a symbol" });
  const remove = watchlist.getByRole("button", { name: "Remove BTC/USDT from watchlist" });
  await expect(remove).toHaveCount(1);
  expect(await remove.evaluate((element) => getComputedStyle(element).opacity)).toBe("1");

  const controls = [
    ["add", add],
    ["remove", remove],
    ["indicator", page.locator(".indicator-toggles button").first()],
  ] as const;
  for (const [name, control] of controls) {
    const box = await control.boundingBox();
    expect(box, `${name} control should have a box`).not.toBeNull();
    expect(box!.width, `${name} width`).toBeGreaterThanOrEqual(44);
    expect(box!.height, `${name} height`).toBeGreaterThanOrEqual(44);
  }

  await remove.click();
  await expect(watchlist.getByRole("button", { name: "Remove BTC/USDT from watchlist" })).toHaveCount(0);
});

test("backtest trade filters stay tappable on coarse pointers", async ({ page }) => {
  await installApiMocks(page);
  await page.goto("/");
  await page.getByTestId("workspace-research").click();

  const backtestRequest = page.waitForResponse((response) => response.url().endsWith("/api/backtests") && response.request().method() === "POST");
  const runBacktest = page.getByRole("button", { name: "Run backtest" }).first();
  await runBacktest.focus();
  await runBacktest.press("Enter");
  expect((await backtestRequest).ok()).toBeTruthy();
  await page.getByRole("tab", { name: "Results" }).click();

  const filters = page.locator(".backtest-trade-filters");
  for (const mode of ["all", "long", "short", "win", "loss"] as const) {
    const button = filters.getByRole("button", { name: mode, exact: true });
    await expect(button).toBeVisible();
    const box = await button.boundingBox();
    expect(box, `${mode} filter should have a box`).not.toBeNull();
    expect(box!.width, `${mode} filter width`).toBeGreaterThanOrEqual(44);
    expect(box!.height, `${mode} filter height`).toBeGreaterThanOrEqual(44);
  }
});

test("hides desktop market statistics without mobile horizontal overflow", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await installApiMocks(page);
  await page.goto("/");

  await expect(page.locator(".summary-stats")).toBeHidden();
  const shell = page.locator(".application-shell");
  await expect.poll(() => shell.evaluate((element) => {
    const container = element as HTMLElement;
    return container.scrollWidth - container.clientWidth;
  })).toBe(0);
});
