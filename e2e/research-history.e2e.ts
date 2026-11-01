import { expect, test } from "@playwright/test";
import { readJson, setTrainingWorkspace } from "./replay-api.js";

test("research run history refreshes when a backtest completes", async ({ page, request }) => {
  test.skip(process.env.PLAYWRIGHT_API_STUBS === "1", "This regression requires the fixture-backed real API.");

  await setTrainingWorkspace(request);
  const workspaceResponse = await request.get("/api/workspace");
  const { state } = await readJson<{ state: Record<string, unknown> }>(workspaceResponse);
  await readJson(await request.put("/api/workspace", {
    headers: { origin: new URL(workspaceResponse.url()).origin },
    data: { ...state, activeWorkspace: "research", activeReplayId: null, activeBacktestId: null },
  }));

  await page.goto("/");
  await expect(page.locator("main.mode-layout-research")).toBeVisible();
  const runHistory = page.locator(".rail-block").filter({ has: page.getByText("RUN HISTORY", { exact: true }) });
  const savedRuns = runHistory.locator(".rail-list button");
  const savedRunCount = await savedRuns.count();
  await page.getByRole("tab", { name: "Strategy lab", exact: true }).click();
  const created = page.waitForResponse((response) =>
    new URL(response.url()).pathname === "/api/backtests" && response.request().method() === "POST",
  );
  await page.getByRole("button", { name: "Run backtest", exact: true }).click();
  expect((await created).status()).toBe(201);

  await expect(savedRuns).toHaveCount(savedRunCount + 1);
  await expect(savedRuns.first().locator(".rail-item-main")).toContainText("sma crossover");
  await expect(page.getByText("No saved runs yet.", { exact: true })).toHaveCount(0);
});
