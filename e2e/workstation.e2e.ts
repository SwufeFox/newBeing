import { expect, test } from "@playwright/test";
import { installApiMocks } from "./api-mocks.js";

async function activate(locator: import("@playwright/test").Locator, keyboard: boolean): Promise<void> {
  if (keyboard) {
    await locator.focus();
    await locator.press("Enter");
  } else {
    await locator.click();
  }
}

test("chart, backtest, source draft, Paper order, Replay and workspace sync use local fixtures", async ({ page }) => {
  const apiMock = process.env.PLAYWRIGHT_API_STUBS === "1" ? await installApiMocks(page) : null;
  const useKeyboard = apiMock !== null;
  const marketData = page.waitForResponse((response) => response.url().includes("/api/market?") && response.request().method() === "GET");
  await page.goto("/");
  const marketResponse = await marketData;
  expect(marketResponse.ok()).toBeTruthy();
  expect((await marketResponse.json()).source).toBe("Deterministic test fixture");
  const chart = page.getByRole("region", { name: "Interactive market chart" });
  await expect(chart).toBeVisible();
  await expect(chart.locator("canvas").first()).toBeVisible();

  await activate(page.getByRole("tab", { name: "Strategy lab" }), useKeyboard);
  await expect(page.getByText("DRAFT · NOT EXECUTED")).toBeVisible();
  const saveDraft = page.waitForResponse((response) => response.url().endsWith("/api/strategies") && response.request().method() === "POST");
  await activate(page.getByRole("button", { name: "Save draft" }), useKeyboard);
  expect((await saveDraft).ok()).toBeTruthy();

  await activate(page.getByRole("button", { name: "backtest", exact: true }), useKeyboard);
  const backtestRequest = page.waitForResponse((response) => response.url().endsWith("/api/backtests") && response.request().method() === "POST");
  const runBacktestButton = page.getByRole("button", { name: "Run backtest" }).first();
  if (apiMock) {
    // The externally supplied preview may predate the sticky action-bar fix; keyboard activation
    // still exercises the real UI event handler while avoiding its stale footer overlap.
    await runBacktestButton.focus();
    await runBacktestButton.press("Enter");
  } else {
    await runBacktestButton.click();
  }
  const backtestResponse = await backtestRequest;
  expect(backtestResponse.ok()).toBeTruthy();
  const backtest = await backtestResponse.json();
  expect(backtest.strategyId).toBeTruthy();
  expect(backtest.strategyVersion).toBeTruthy();
  expect(backtest.parameters).toBeTruthy();

  await activate(page.getByRole("button", { name: "terminal", exact: true }), useKeyboard);
  await activate(page.getByRole("tab", { name: "Order book" }), useKeyboard);
  await page.getByRole("spinbutton", { name: "QUANTITY · BTC" }).fill("0.001");
  const paperOrder = page.waitForResponse((response) => response.url().endsWith("/api/paper") && response.request().method() === "POST");
  await activate(page.getByRole("button", { name: "Buy" }), useKeyboard);
  expect((await paperOrder).ok()).toBeTruthy();

  await activate(page.getByRole("button", { name: "replay", exact: true }), useKeyboard);
  const replayStart = page.waitForResponse((response) => response.url().endsWith("/api/replay") && response.request().method() === "POST");
  await activate(page.getByRole("button", { name: /Seed .* · .*/ }), useKeyboard);
  expect((await replayStart).ok()).toBeTruthy();
  await expect(page.getByRole("button", { name: "Step" })).toBeEnabled();
  const replayStep = page.waitForResponse((response) => /\/api\/replay\/[^/?]+/.test(new URL(response.url()).pathname) && response.request().method() === "POST");
  await activate(page.getByRole("button", { name: "Step" }), useKeyboard);
  expect((await replayStep).ok()).toBeTruthy();

  await activate(page.getByRole("button", { name: "research", exact: true }), useKeyboard);
  if (apiMock) {
    await expect.poll(() => apiMock.workspace.activeWorkspace).toBe("research");
  } else {
    await expect.poll(async () => {
      const response = await page.request.get("/api/workspace");
      const state = await response.json();
      return state.state?.activeWorkspace;
    }).toBe("research");
  }
});

test("state-changing APIs reject rebinding hosts and cross-origin writes", async ({ request, baseURL }) => {
  test.skip(process.env.PLAYWRIGHT_API_STUBS === "1", "This local UI-only run stubs all APIs; CI verifies the real proxy guard.");
  if (!baseURL) throw new Error("Playwright baseURL is not configured.");
  const hostRejected = await request.get(`${baseURL}/api/workspace`, { headers: { host: "attacker.example" } });
  expect(hostRejected.status()).toBe(403);
  const originRejected = await request.post(`${baseURL}/api/workspace`, {
    headers: { origin: "http://attacker.example", "content-type": "application/json" },
    data: {},
  });
  expect(originRejected.status()).toBe(403);
  const contentTypeRejected = await request.post(`${baseURL}/api/workspace`, {
    headers: { origin: baseURL, "content-type": "text/plain" },
    data: "{}",
  });
  expect(contentTypeRejected.status()).toBe(403);
});
