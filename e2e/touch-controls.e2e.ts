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
