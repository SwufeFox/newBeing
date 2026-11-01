import { expect, test, type Response } from "@playwright/test";
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

  const isRunHistoryResponse = (response: Response): boolean => {
    const url = new URL(response.url());
    return response.request().method() === "GET"
      && url.pathname === "/api/backtests"
      && url.searchParams.get("view") === "summary"
      && url.searchParams.get("limit") === "16";
  };
  const initialHistory = page.waitForResponse(isRunHistoryResponse);
  await page.goto("/");
  const initialHistoryResponse = await initialHistory;
  expect(initialHistoryResponse.ok()).toBeTruthy();
  const initialPayload = await initialHistoryResponse.json() as { items: Array<{ resultId: string }> };

  await expect(page.locator("main.mode-layout-research")).toBeVisible();
  const runHistory = page.locator(".rail-block").filter({ has: page.getByText("RUN HISTORY", { exact: true }) });
  const savedRuns = runHistory.locator(".rail-list button");
  const savedRunCount = Math.min(initialPayload.items.length, 16);
  await expect(savedRuns).toHaveCount(savedRunCount);
  await page.getByRole("tab", { name: "Strategy lab", exact: true }).click();

  const historyRefresh = page.waitForResponse(isRunHistoryResponse);
  const created = page.waitForResponse((response) =>
    new URL(response.url()).pathname === "/api/backtests" && response.request().method() === "POST",
  );
  await page.getByRole("button", { name: "Run backtest", exact: true }).click();
  const createdResponse = await created;
  expect(createdResponse.status()).toBe(201);
  const result = await createdResponse.json() as { resultId: string };
  const refreshedHistoryResponse = await historyRefresh;
  expect(refreshedHistoryResponse.ok()).toBeTruthy();
  const refreshedPayload = await refreshedHistoryResponse.json() as { items: Array<{ resultId: string }> };
  expect(refreshedPayload.items.some((item) => item.resultId === result.resultId)).toBe(true);

  await expect(savedRuns).toHaveCount(Math.min(savedRunCount + 1, 16));
  await expect(savedRuns.first().locator(".rail-item-main")).toContainText("sma crossover");
  await expect(page.getByText("No saved runs yet.", { exact: true })).toHaveCount(0);
});
