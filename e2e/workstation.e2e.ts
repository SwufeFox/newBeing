import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { expect, test } from "@playwright/test";
import { installApiMocks } from "./api-mocks.js";
import {
  assertTrainingLedger, commandTraining, queueTraining, readJson, reloadTraining,
  REPLAY_INTERVAL, REPLAY_MARKET, seedTraining, setTrainingWorkspace, stepTraining,
  trainingCandles, trainingAmounts, TRAINING_CONFIG, type ReplaySeed, type ReplaySnapshot,
} from "./replay-api.js";

async function activate(locator: import("@playwright/test").Locator, keyboard: boolean): Promise<void> {
  if (keyboard) {
    await locator.focus();
    await locator.press("Enter");
  } else {
    await locator.click();
  }
}

test.beforeAll({ timeout: 360_000 }, async ({ request }) => {
  if (process.env.PLAYWRIGHT_API_STUBS === "1") return;
  // Compile the dev routes before browser actions; a cold route can trigger a
  // Fast Refresh reload that interrupts an in-flight UI request.
  test.setTimeout(360_000);
  for (const path of ["/", "/api/strategies", "/api/backtests", "/api/paper", "/api/replay", "/api/replay/e2e-warmup"]) {
    const response = await request.get(path);
    expect(response.status(), `Warm-up ${path}`).toBeLessThan(500);
    await response.dispose();
  }
});

test("chart, backtest, source draft, Paper order, Replay and workspace sync use local fixtures", async ({ page }) => {
  // This case includes cold route compilation and several complete UI workflows.
  test.setTimeout(360_000);
  const apiMock = process.env.PLAYWRIGHT_API_STUBS === "1" ? await installApiMocks(page) : null;
  const useKeyboard = apiMock !== null;
  if (!apiMock) await setTrainingWorkspace(page.request);
  const marketData = page.waitForResponse((response) => {
    const url = new URL(response.url());
    return url.pathname === "/api/market" && (url.searchParams.get("kind") ?? "candles") === "candles" && response.request().method() === "GET";
  });
  await page.goto("/");
  const marketResponse = await marketData;
  expect(marketResponse.ok()).toBeTruthy();
  expect((await marketResponse.json()).source).toBe("Deterministic test fixture");
  const chart = page.getByRole("region", { name: "Interactive market chart" });
  await expect(chart).toBeVisible();
  await expect(page.getByText("TEST FIXTURE", { exact: true })).toBeVisible();
  await expect(chart.locator("canvas").first()).toBeVisible();

  await activate(page.getByRole("tab", { name: "Strategy lab" }), useKeyboard);
  await expect(page.getByText("SIMULATION ASSUMPTIONS")).toBeVisible();

  // Research owns the backtest now (the separate Backtest workspace was merged
  // into it), so the run is launched from the merged workspace and its result
  // board is a dock tab there.
  await activate(page.getByTestId("workspace-research"), useKeyboard);
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

  await activate(page.getByTestId("workspace-terminal"), useKeyboard);
  await activate(page.getByRole("tab", { name: "Order book" }), useKeyboard);
  await page.getByRole("spinbutton", { name: "QUANTITY · BTC" }).fill("0.001");
  const paperOrder = page.waitForResponse((response) => response.url().endsWith("/api/paper") && response.request().method() === "POST");
  await activate(page.getByRole("button", { name: "Buy" }), useKeyboard);
  expect((await paperOrder).ok()).toBeTruthy();

  await activate(page.getByTestId("workspace-replay"), useKeyboard);
  const replayStart = page.waitForResponse((response) => response.url().endsWith("/api/replay") && response.request().method() === "POST");
  await activate(page.getByRole("button", { name: /Seed .* · .*/ }), useKeyboard);
  expect((await replayStart).ok()).toBeTruthy();
  await expect(page.getByRole("button", { name: "Step" })).toBeEnabled();
  const replayStep = page.waitForResponse((response) => /\/api\/replay\/[^/?]+/.test(new URL(response.url()).pathname) && response.request().method() === "POST");
  await activate(page.getByRole("button", { name: "Step" }), useKeyboard);
  expect((await replayStep).ok()).toBeTruthy();

  await activate(page.getByTestId("workspace-research"), useKeyboard);
  if (apiMock) {
    await expect.poll(() => apiMock.workspace.activeWorkspace).toBe("research");
  } else {
    await expect.poll(async () => {
      const response = await page.request.get("/api/workspace");
      const state = await response.json();
      return state.state?.activeWorkspace;
    }, { timeout: 15_000 }).toBe("research");
  }
});

test("Paper full close uses the position and disabled sell shortcuts do not submit", async ({ page, baseURL }) => {
  test.skip(process.env.PLAYWRIGHT_API_STUBS === "1", "This test exercises the fixture Paper ledger.");
  await setTrainingWorkspace(page.request);
  const opened = await readJson<{ portfolio: { baseBalance: number }; order: { status: string } }>(await page.request.post("/api/paper", {
    headers: { origin: new URL(baseURL!).origin },
    data: { clientOrderId: randomUUID(), symbol: "BTC/USDT", exchange: "binance", side: "buy", quantity: 0.002, mode: "paper" },
  }), 201);
  expect(opened.order.status).toBe("filled");
  const position = opened.portfolio.baseBalance;

  await page.goto("/");
  await page.getByRole("tab", { name: "Order book" }).click();
  const ticket = page.locator(".paper-ticket");
  const close = ticket.getByRole("button", { name: "Close 100%" });
  await expect(close).toBeVisible();
  const quantity = ticket.getByTestId("paper-quantity");
  await quantity.fill(String(position + 1));
  await expect(ticket.getByRole("button", { name: "Sell", exact: true })).toBeDisabled();

  const submissions: unknown[] = [];
  page.on("request", (request) => {
    if (new URL(request.url()).pathname === "/api/paper" && request.method() === "POST") submissions.push(request.postDataJSON());
  });
  await ticket.locator(".ticket-heading").click();
  await page.keyboard.press("s");
  await quantity.fill(String(position / 2));
  const closing = page.waitForResponse((response) => new URL(response.url()).pathname === "/api/paper" && response.request().method() === "POST");
  await close.click();
  const response = await closing;
  expect(response.ok()).toBeTruthy();
  const result = await response.json() as { order: { status: string }; portfolio: { baseBalance: number } };
  expect(result.order.status).toBe("filled");
  expect(result.portfolio.baseBalance).toBe(0);
  expect(submissions).toHaveLength(1);
});

test("watchlist adds a bare symbol with the selected venue's quote currency", async ({ page }) => {
  await installApiMocks(page);
  await page.goto("/");

  const watchlist = page.locator(".watchlist-panel");
  await expect(watchlist).toBeVisible();
  await page.getByRole("combobox", { name: "Exchange" }).selectOption("kraken");
  const addToggle = watchlist.getByRole("button", { name: "Add a symbol" });
  await addToggle.click();

  const symbolInput = watchlist.getByRole("textbox", { name: "Symbol to add" });
  await expect(symbolInput).toHaveAttribute("placeholder", "SOL or SOL/USD");
  await symbolInput.fill("ADA/");
  await symbolInput.press("Enter");
  await expect(watchlist.getByRole("alert")).toHaveText("Use a pair like SOL/USD or SOL/USDT.");

  await symbolInput.fill("ADA");
  await symbolInput.press("Enter");
  await expect(watchlist.locator(".watch-symbol").filter({ hasText: "ADA" })).toContainText("/USD");
});

test("collapsing the sidebar keeps the watchlist mounted with its draft intact", async ({ page }) => {
  await installApiMocks(page);
  await page.goto("/");

  const watchlist = page.locator(".watchlist-panel");
  await expect(watchlist).toBeVisible();

  await watchlist.getByRole("button", { name: "Add a symbol" }).click();
  const symbolInput = watchlist.getByRole("textbox", { name: "Symbol to add" });
  await symbolInput.fill("ADA/");

  await page.getByRole("button", { name: "Collapse sidebar" }).click();
  await expect(watchlist).toBeHidden();

  await page.getByRole("button", { name: "Expand sidebar" }).click();
  await expect(watchlist).toBeVisible();
  await expect(symbolInput).toHaveValue("ADA/");

  // The research rail is latched the same way, including the hotkey toggle.
  await page.getByTestId("workspace-research").click();
  const researchRail = page.locator(".primary-rail");
  await expect(researchRail).toBeVisible();
  await page.keyboard.press("Control+b");
  await expect(researchRail).toBeHidden();
  await page.keyboard.press("Control+b");
  await expect(researchRail).toBeVisible();
});

test("shows failed backtest reruns and Paper closes without replacing known state", async ({ page }) => {
  await installApiMocks(page);
  await page.route("**/api/backtests/*/rerun", (route) => route.fulfill({
    status: 503,
    contentType: "application/json",
    body: JSON.stringify({ error: "Saved rerun unavailable." }),
  }));
  await page.goto("/");
  await page.getByTestId("workspace-research").click();
  const backtestRequest = page.waitForResponse((response) => response.url().endsWith("/api/backtests") && response.request().method() === "POST");
  const runBacktest = page.getByRole("button", { name: "Run backtest" }).first();
  await runBacktest.focus();
  await runBacktest.press("Enter");
  expect((await backtestRequest).ok()).toBeTruthy();

  await page.getByRole("tab", { name: "Results" }).click();
  const resultView = page.locator(".backtest-view");
  await expect(resultView.getByText("+1.00%")).toBeVisible();
  await resultView.getByRole("button", { name: "Rerun backtest" }).click();
  await expect(resultView.getByRole("alert")).toHaveText("Saved rerun unavailable.");
  await expect(resultView.getByText("+1.00%")).toBeVisible();

  await page.route(/\/api\/paper(?:\?.*)?$/, async (route) => {
    if (route.request().method() === "POST") {
      await route.fulfill({ status: 422, contentType: "application/json", body: JSON.stringify({ error: "Paper close quote unavailable." }) });
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        portfolio: { quoteBalance: 9_915, baseBalance: 0.001, averageEntryPrice: 85_000, realizedPnl: 0, totalFees: 0 },
        orders: [],
        mode: "paper",
        exchange: "binance",
      }),
    });
  });
  await page.getByTestId("workspace-terminal").click();
  await page.getByRole("tab", { name: "Positions" }).click();
  const positionView = page.locator(".position-table-wrap");
  const closeButton = positionView.getByRole("button", { name: "Close" });
  await expect(closeButton).toBeVisible();
  await expect(positionView.getByText("0.00100", { exact: true })).toBeVisible();
  await closeButton.click();
  await expect(positionView.getByRole("alert")).toHaveText("Paper close quote unavailable.");
  await expect(positionView.getByText("0.00100", { exact: true })).toBeVisible();
  await expect(positionView.getByRole("status")).toContainText("Refresh the account");
  await expect(positionView.getByRole("button", { name: "Refresh required", exact: true })).toBeDisabled();
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(positionView.getByRole("alert")).toBeVisible();
  const dimensions = await page.evaluate(() => ({ viewportWidth: window.innerWidth, documentWidth: document.documentElement.scrollWidth }));
  expect(dimensions.documentWidth).toBeLessThanOrEqual(dimensions.viewportWidth);
});
test("recovers filtered-empty backtest trades and distinguishes no-trade runs", async ({ page }) => {
  await installApiMocks(page);
  await page.goto("/");
  await page.getByTestId("workspace-research").click();

  const backtestRequest = page.waitForResponse((response) => response.url().endsWith("/api/backtests") && response.request().method() === "POST");
  const runBacktest = page.getByRole("button", { name: "Run backtest" }).first();
  await runBacktest.focus();
  await runBacktest.press("Enter");
  const backtestResponse = await backtestRequest;
  expect(backtestResponse.ok()).toBeTruthy();
  const backtest = await backtestResponse.json() as {
    assumptions: { initialCapital: number };
    metrics: { finalEquity: number; totalReturn: number; sharpeRatio: number | null; maxDrawdown: number; winRate: number; profitFactor: number | null; tradeCount: number; totalFees: number };
    equityCurve: { timestamp: number; equity: number; drawdown: number }[];
  };

  await page.getByRole("tab", { name: "Results" }).click();
  const resultView = page.locator(".backtest-view");
  const tradeRow = resultView.getByRole("row").filter({ hasText: "LONG" });
  await expect(tradeRow).toBeVisible();
  const shortFilter = resultView.locator(".backtest-trade-filters").getByRole("button", { name: "short", exact: true });
  await shortFilter.click();
  await expect(shortFilter).toHaveAttribute("aria-pressed", "true");
  await expect(resultView.getByRole("status")).toContainText("No short trades match this filter.");

  await resultView.getByRole("button", { name: "Show all trades" }).click();
  await expect(resultView.locator(".backtest-trade-filters").getByRole("button", { name: "all", exact: true })).toHaveAttribute("aria-pressed", "true");
  await expect(tradeRow).toBeVisible();

  const initialCapital = backtest.assumptions.initialCapital;
  const noTradeResult = {
    ...backtest,
    metrics: {
      ...backtest.metrics,
      finalEquity: initialCapital,
      totalReturn: 0,
      sharpeRatio: null,
      maxDrawdown: 0,
      winRate: 0,
      profitFactor: null,
      tradeCount: 0,
      totalFees: 0,
    },
    equityCurve: backtest.equityCurve.map((point) => ({ ...point, equity: initialCapital, drawdown: 0 })),
    trades: [],
  };
  await page.route("**/api/backtests/*/rerun", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify(noTradeResult),
  }));
  await resultView.getByRole("button", { name: "Rerun backtest" }).click();
  await expect(resultView.getByRole("status")).toHaveText("No trades were generated by this backtest.");
  await expect(resultView.getByRole("button", { name: "Show all trades" })).toHaveCount(0);
});

test("experiment history explains comparison selection requirements", async ({ page }) => {
  await installApiMocks(page);
  const items = [
    {
      resultId: "e2e-history-one",
      strategyId: "sma-crossover",
      createdAt: "2026-11-03T12:00:00.000Z",
      symbol: "BTC/USDT",
      timeframe: "15m",
      metrics: { totalReturn: 0.01, maxDrawdown: 0.02, tradeCount: 2, sharpeRatio: 0.8, winRate: 0.5 },
    },
    {
      resultId: "e2e-history-two",
      strategyId: "sma-crossover",
      createdAt: "2026-11-02T12:00:00.000Z",
      symbol: "BTC/USDT",
      timeframe: "15m",
      metrics: { totalReturn: 0.02, maxDrawdown: 0.03, tradeCount: 3, sharpeRatio: 0.9, winRate: 0.6 },
    },
  ];
  await page.route(/\/api\/backtests\?view=summary/, (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({ items }),
  }));
  await page.goto("/");
  await page.getByTestId("workspace-research").click();
  await page.getByRole("tab", { name: "Experiments" }).click();

  const history = page.locator(".dock-content");
  const status = history.getByRole("status");
  const compare = history.getByRole("button", { name: "Compare selected" });
  await expect(status).toContainText("0 runs selected");
  await expect(status).toContainText("Select at least 2 runs to compare.");
  await expect(compare).toBeDisabled();

  const selections = history.getByRole("checkbox");
  await selections.nth(0).check();
  await expect(status).toContainText("1 run selected");
  await expect(status).toContainText("Select one more run to compare.");
  await expect(compare).toBeDisabled();

  await selections.nth(1).check();
  await expect(status).toContainText("2 runs selected");
  await expect(status).toContainText("Compare runs from the same data snapshot, venue, symbol, timeframe, engine version, and fixed assumptions.");
  await expect(compare).toBeEnabled();
});



test("announces backtest progress while the request is pending", async ({ page }) => {
  await installApiMocks(page);
  let resumeBacktest = () => {};
  const backtestGate = new Promise<void>((resolve) => { resumeBacktest = resolve; });
  await page.route("**/api/backtests", async (route) => {
    if (route.request().method() !== "POST") {
      await route.fallback();
      return;
    }
    await backtestGate;
    await route.fallback();
  });

  await page.goto("/");
  await page.getByTestId("workspace-research").click();
  const runBacktest = page.getByRole("button", { name: "Run backtest" }).first();
  await runBacktest.focus();
  await runBacktest.press("Enter");

  try {
    const status = page.locator(".run-status");
    await expect(status).toHaveAttribute("role", "status");
    await expect(status).toContainText("Fetching");
  } finally {
    resumeBacktest();
  }
  await expect(page.locator(".backtest-view")).toBeVisible();
});

test("announces invalid SMA periods and links the error to both fields", async ({ page }) => {
  await installApiMocks(page);
  await page.goto("/");
  await page.getByTestId("workspace-research").click();

  const fastPeriod = page.getByRole("spinbutton", { name: "Fast Period" });
  const slowPeriod = page.getByRole("spinbutton", { name: "Slow Period" });
  const runBacktest = page.getByRole("button", { name: "Run backtest" }).first();
  const validation = page.locator("#strategy-sma-validation");
  await fastPeriod.fill("50");
  await expect(validation).toHaveAttribute("role", "alert");
  await expect(validation).toHaveText("Fast period must be lower than slow period.");
  for (const field of [fastPeriod, slowPeriod]) {
    await expect(field).toHaveAttribute("aria-invalid", "true");
    await expect(field).toHaveAttribute("aria-describedby", "strategy-sma-validation");
  }
  await expect(runBacktest).toBeDisabled();

  await fastPeriod.fill("20");
  await expect(validation).toHaveCount(0);
  await expect(runBacktest).toBeEnabled();
});

test("announces a successful strategy preset reset", async ({ page }) => {
  await installApiMocks(page);
  await page.goto("/");
  await page.getByTestId("workspace-research").click();

  const fastPeriod = page.getByRole("spinbutton", { name: "Fast Period" });
  await fastPeriod.fill("25");
  const resetDefaults = page.getByRole("button", { name: "Reset Defaults" });
  await expect(resetDefaults).toBeEnabled();
  await resetDefaults.click();

  await expect(page.locator(".strategy-lab").getByRole("status")).toHaveText("Reset to defaults");
  await expect(fastPeriod).toHaveValue("20");
});

test("keeps Research header controls inside a 1024px viewport", async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 900 });
  await installApiMocks(page);
  await page.goto("/");
  await page.getByTestId("workspace-research").click();

  const shell = page.locator(".application-shell");
  await expect.poll(() => shell.evaluate((element) => {
    const container = element as HTMLElement;
    return container.scrollWidth - container.clientWidth;
  })).toBe(0);
  await expect(page.getByRole("button", { name: "Terminal shortcuts" })).toBeVisible();
  await expect(page.getByRole("button", { name: /^(Collapse|Expand) sidebar$/ })).toBeVisible();
});

test("Paper recovery stays mounted when a successful response is malformed", async ({ page }) => {
  await installApiMocks(page);
  await page.route("**/api/paper/recovery", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({}),
  }));

  await page.goto("/");
  const recoveryPanel = page.getByTestId("paper-recovery");
  await expect(recoveryPanel).toBeVisible();
  await expect(recoveryPanel).toContainText("Pending Paper status unavailable.");
  await expect(recoveryPanel).toHaveAttribute("data-loaded", "false");
});
test("applies an authoritative filled Paper close from a non-2xx response", async ({ page }) => {
  await installApiMocks(page);
  const filledOrder = {
    clientOrderId: "close-filled-http-error",
    symbol: "BTC/USDT",
    side: "sell",
    quantity: 0.001,
    status: "filled",
    fillPrice: 85_000,
    fee: 0.085,
    createdAt: new Date().toISOString(),
  };
  let account: { portfolio: { quoteBalance: number; baseBalance: number; averageEntryPrice: number | null; realizedPnl: number; totalFees: number; feeRate: number }; orders: typeof filledOrder[]; mode: string; exchange: string } = {
    portfolio: { quoteBalance: 9_915, baseBalance: 0.001, averageEntryPrice: 85_000, realizedPnl: 0, totalFees: 0, feeRate: 0.001 },
    orders: [],
    mode: "paper",
    exchange: "binance",
  };
  let submitted = false;
  await page.route(/\/api\/paper(?:\?.*)?$/, async (route) => {
    if (route.request().method() === "POST") {
      submitted = true;
      account = {
        portfolio: { quoteBalance: 9_999.915, baseBalance: 0, averageEntryPrice: null, realizedPnl: -0.085, totalFees: 0.085, feeRate: 0.001 },
        orders: [filledOrder],
        mode: "paper",
        exchange: "binance",
      };
      await route.fulfill({ status: 422, contentType: "application/json", body: JSON.stringify({ error: "Response delivery failed after fill.", order: filledOrder, portfolio: account.portfolio }) });
      return;
    }
    if (submitted) {
      await route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: "Order history unavailable." }) });
      return;
    }
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(account) });
  });

  await page.goto("/");
  await page.getByRole("tab", { name: "Positions" }).click();
  const positionView = page.locator(".position-table-wrap");
  await expect(positionView.getByRole("button", { name: "Close" })).toBeVisible();
  await positionView.getByRole("button", { name: "Close" }).click();
  await expect(positionView.getByRole("alert")).toHaveText("Response delivery failed after fill. Refreshed order history is unavailable; the confirmed portfolio is shown.");
  await expect(positionView.getByText("No open Paper position for BTC.")).toBeVisible();
  await expect(positionView.getByRole("button", { name: "Close" })).toHaveCount(0);
});

test("workspace panels remain side-by-side on desktop and stack on mobile", async ({ page }) => {
  await installApiMocks(page);
  await page.goto("/");
  await expect(page.getByRole("region", { name: "Interactive market chart" })).toBeVisible();

  const chartColumn = page.locator(".chart-column");
  const inspectorSlot = page.locator(".inspector-slot");
  const resultsSlot = page.locator(".dock-slot");
  const viewportMeasurements = async () => page.evaluate(() => ({
    viewportWidth: window.innerWidth,
    documentWidth: document.documentElement.scrollWidth,
  }));
  const assertNoHorizontalOverflow = async () => {
    const { viewportWidth, documentWidth } = await viewportMeasurements();
    expect(documentWidth).toBeLessThanOrEqual(viewportWidth);
    return { viewportWidth, documentWidth };
  };

  const desktopChart = await chartColumn.boundingBox();
  const desktopInspector = await inspectorSlot.boundingBox();
  expect(desktopChart).not.toBeNull();
  expect(desktopInspector).not.toBeNull();
  expect(Math.abs(desktopChart!.y - desktopInspector!.y)).toBeLessThan(5);
  expect(desktopChart!.x + desktopChart!.width).toBeLessThanOrEqual(desktopInspector!.x);
  const desktopViewport = await assertNoHorizontalOverflow();
  console.log("Desktop workspace measurements", {
    viewport: `${desktopViewport.viewportWidth}px`,
    document: `${desktopViewport.documentWidth}px`,
    chart: `${Math.round(desktopChart!.width)}×${Math.round(desktopChart!.height)}px`,
    inspector: `${Math.round(desktopInspector!.width)}×${Math.round(desktopInspector!.height)}px`,
  });

  await page.setViewportSize({ width: 390, height: 844 });
  const mobileChart = await chartColumn.boundingBox();
  const mobileInspector = await inspectorSlot.boundingBox();
  const mobileResults = await resultsSlot.boundingBox();
  expect(mobileChart).not.toBeNull();
  expect(mobileInspector).not.toBeNull();
  expect(mobileResults).not.toBeNull();
  expect(mobileChart!.width).toBeGreaterThan(350);
  expect(mobileInspector!.width).toBeGreaterThan(350);
  expect(mobileInspector!.y).toBeGreaterThanOrEqual(mobileChart!.y + mobileChart!.height);
  expect(mobileResults!.y).toBeGreaterThanOrEqual(mobileInspector!.y + mobileInspector!.height);
  const mobileViewport = await assertNoHorizontalOverflow();
  console.log("Mobile workspace measurements", {
    viewport: `${mobileViewport.viewportWidth}px`,
    document: `${mobileViewport.documentWidth}px`,
    chart: `${Math.round(mobileChart!.width)}×${Math.round(mobileChart!.height)}px`,
    inspector: `${Math.round(mobileInspector!.width)}×${Math.round(mobileInspector!.height)}px`,
    results: `${Math.round(mobileResults!.width)}×${Math.round(mobileResults!.height)}px`,
  });
});

test("kept-alive inspector tabs pause hidden polling and reopen with data", async ({ page }) => {
  await installApiMocks(page);
  await page.goto("/");
  await page.getByRole("tab", { name: "Order book", exact: true }).click();
  const book = page.locator(".orderbook-panel");
  await expect(book).toBeVisible();
  await expect(book).toContainText("PRICE (USDT)");

  let bookRequests = 0;
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (url.pathname === "/api/market" && url.searchParams.get("kind") === "book") bookRequests += 1;
  });
  await page.getByRole("tab", { name: "AI context", exact: true }).click();
  await expect(book).toBeHidden();
  const settled = bookRequests;
  // The order book polls every three seconds; a hidden panel must not keep doing so.
  await page.waitForTimeout(3_400);
  expect(bookRequests).toBe(settled);

  await page.getByRole("tab", { name: "Order book", exact: true }).click();
  await expect(book).toBeVisible();
  await expect(book).toContainText("PRICE (USDT)");
  await expect(page.getByText("Loading public depth…")).toHaveCount(0);
});

test("backtest report export downloads a versioned research bundle", async ({ page }) => {
  await installApiMocks(page);
  await page.goto("/");
  await activate(page.getByTestId("workspace-research"), true);
  const runBacktestButton = page.getByRole("button", { name: "Run backtest" }).first();
  await runBacktestButton.focus();
  await runBacktestButton.press("Enter");
  await expect(page.locator(".backtest-view")).toBeVisible();

  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export report", exact: true }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/^research-sma-crossover-BTCUSDT-\d{4}-\d{2}-\d{2}-[0-9A-Za-z-]{8}\.json$/);
  const report = JSON.parse(readFileSync(await download.path(), "utf8"));
  expect(report.schemaVersion).toBe(1);
  expect(report.kind).toBe("newbeing-research-report");
  expect(report.provenance.resultId).toBe("e2e-backtest-fixture");
  expect(report.provenance.barRange.bars).toBeGreaterThan(0);
  expect(report.limitations.length).toBeGreaterThanOrEqual(3);
  expect(report.result.metrics.tradeCount).toBe(1);
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

test.describe("manual Replay training against the real API", () => {
  test.use({ extraHTTPHeaders: { origin: new URL(process.env.PLAYWRIGHT_BASE_URL ?? "http://127.0.0.1:3100").origin } });
  test.beforeEach(() => {
    test.skip(process.env.PLAYWRIGHT_API_STUBS === "1", "Training requires the real API and server candle fixtures; browser mocks cannot execute orders.");
  });

  test.afterEach(async ({ request }) => {
    if (process.env.PLAYWRIGHT_API_STUBS !== "1") await setTrainingWorkspace(request);
  });

  test("configure, queue, cancel, step, partially close, journal, reload and finish an isolated ledger", async ({ request }) => {
    const candles = await trainingCandles(request);
    const paperBefore = await readJson<{ portfolio: unknown }>(await request.get("/api/paper", { params: REPLAY_MARKET }));
    let state = await seedTraining(request, candles[600]!);
    const id = state.session.id;
    const firstAccount = state.execution.account.id;
    const endpoint = `/api/replay/${id}`;
    const seedCursor = state.session.cursor;
    assertTrainingLedger(state);

    await test.step("Replay exposes only the revealed prefix and suppresses live data and research", async () => {
      const visible = await readJson<{ candles: unknown[]; completed: unknown[]; futureBarsLoaded: number }>(
        await request.get("/api/market", { params: { ...REPLAY_MARKET, kind: "candles", since: seedCursor + REPLAY_INTERVAL } }),
      );
      expect(visible.candles).toEqual(state.session.bars);
      expect(visible.completed).toEqual(state.session.bars);
      expect(visible.futureBarsLoaded).toBe(0);
      for (const kind of ["summary", "book", "trades", "tickers"]) {
        expect((await request.get("/api/market", { params: { ...REPLAY_MARKET, kind } })).status()).toBe(409);
      }
      for (const mismatch of [{ exchange: "kraken" }, { symbol: "ETH/USDT" }, { timeframe: "1h" }]) {
        expect((await request.get("/api/market", { params: { ...REPLAY_MARKET, kind: "candles", ...mismatch } })).status()).toBe(409);
      }
      expect((await request.get("/api/backtests")).status()).toBe(409);
      expect((await request.get("/api/paper", { params: REPLAY_MARKET })).status()).toBe(409);
    });

    const entry = await queueTraining(request, state, { side: "buy", quantity: 0.02, type: "market" });
    state = entry.snapshot;
    await test.step("order retries preserve intent; incompatible IDs and stale revisions cannot mutate it", async () => {
      const retried = await commandTraining(request, state, entry.command);
      expect(retried).toEqual(state);
      expect((await request.post(endpoint, { data: { ...entry.command, quantity: 0.03 } })).status()).toBe(422);
      expect((await request.post(endpoint, { data: { action: "journal", notes: "stale", tags: [], expectedRevision: 0 } })).status()).toBe(409);
      expect(await reloadTraining(request, id)).toEqual(state);
    });

    const cancelled = await queueTraining(request, state, { side: "buy", quantity: 0.001, type: "limit", price: candles[601]!.low / 2 });
    state = await commandTraining(request, cancelled.snapshot, { action: "cancel", clientOrderId: cancelled.orderId });
    expect(state.orders.find((order) => order.clientOrderId === cancelled.orderId)?.status).toBe("cancelled");
    const beforeStep = state;
    state = await stepTraining(request, state);
    const entryBar = state.session.bars.at(-1)!;
    expect(entryBar).toEqual(candles[601]);
    const entryPrice = entryBar.open * (1 + TRAINING_CONFIG.slippageRate);
    expect(state.orders.find((order) => order.clientOrderId === entry.orderId)?.fillPrice).toBeCloseTo(entryPrice, 8);
    expect(state.execution.fills).toHaveLength(1);
    expect(state.execution.fills[0]).toMatchObject({ orderId: entry.orderId, timestamp: entryBar.timestamp, side: "buy", reason: "order", quantity: 0.02 });
    expect(state.execution.fills.some((fill) => fill.orderId === cancelled.orderId)).toBe(false);
    const entryCost = trainingAmounts(entryPrice, 0.02, TRAINING_CONFIG.feeRate).cost;
    expect(state.portfolio.averageEntryPrice).toBeCloseTo(entryCost / 0.02, 8);
    assertTrainingLedger(state);

    await test.step("lost step and order response retries cannot duplicate fills or advance the cursor", async () => {
      const retriedStep = await commandTraining(request, state, { action: "step", expectedCursor: beforeStep.session.cursor, expectedRevision: beforeStep.execution.revision });
      expect(retriedStep.deduplicated).toBe(true);
      expect(retriedStep.session).toEqual(state.session);
      expect(retriedStep.execution).toEqual(state.execution);
      const retriedOrder = await commandTraining(request, state, entry.command);
      expect(retriedOrder).toEqual(await reloadTraining(request, id));
      expect(retriedOrder.execution.fills).toHaveLength(1);
    });

    const close = await queueTraining(request, state, { side: "sell", quantity: 0.005, type: "market" });
    state = await stepTraining(request, close.snapshot);
    const exitPrice = state.session.bars.at(-1)!.open * (1 - TRAINING_CONFIG.slippageRate);
    expect(state.orders.find((order) => order.clientOrderId === close.orderId)?.fillPrice).toBeCloseTo(exitPrice, 8);
    expect(state.portfolio.baseBalance).toBeCloseTo(0.015, 12);
    const exitAmounts = trainingAmounts(exitPrice, 0.005, TRAINING_CONFIG.feeRate);
    const allocatedEntryUnits = Math.round(entryCost * 1e8 * 0.25);
    expect(state.portfolio.realizedPnl).toBe((exitAmounts.notionalUnits - exitAmounts.feeUnits - allocatedEntryUnits) / 1e8);
    assertTrainingLedger(state);
    const afterPartialClose = state.portfolio;

    const oversell = await queueTraining(request, state, { side: "sell", quantity: 1, type: "market" });
    const overbuy = await queueTraining(request, oversell.snapshot, { side: "buy", quantity: 1_000_000, type: "market" });
    state = await stepTraining(request, overbuy.snapshot);
    expect(state.orders.filter((order) => [oversell.orderId, overbuy.orderId].includes(order.clientOrderId)).map((order) => order.status)).toEqual(["rejected", "rejected"]);
    expect(state.execution.fills).toHaveLength(2);
    expect(state.portfolio).toEqual(afterPartialClose);
    expect(state.portfolio.baseBalance).toBeCloseTo(0.015, 12);
    assertTrainingLedger(state);

    state = await commandTraining(request, state, { action: "journal", notes: "Wait for the next bar; scale out and retain a runner.", tags: ["manual", "partial-close", "manual"] });
    expect(state.execution.tags).toEqual(["manual", "partial-close"]);
    expect((await reloadTraining(request, id)).execution).toEqual(state.execution);
    const pending = await queueTraining(request, state, { side: "buy", quantity: 0.001, type: "limit", price: candles[604]!.low / 2 });
    const beforeFinish = pending.snapshot;
    state = await commandTraining(request, beforeFinish, { action: "finish" });
    expect(state.session.status).toBe("finished");
    expect(state.session.cursor).toBe(beforeFinish.session.cursor);
    expect(state.execution.fills).toEqual(beforeFinish.execution.fills);
    expect(state.portfolio).toEqual(beforeFinish.portfolio);
    expect(state.orders.find((order) => order.clientOrderId === pending.orderId)?.status).toBe("cancelled");
    expect(state.report.notes).toContain("retain a runner");
    assertTrainingLedger(state);
    expect(await reloadTraining(request, id)).toEqual(state);
    expect((await request.post(endpoint, { data: { action: "step", expectedCursor: state.session.cursor, expectedRevision: state.execution.revision } })).status()).toBe(422);
    expect((await request.post(endpoint, { data: { action: "order", requestId: randomUUID(), side: "buy", quantity: 0.001, type: "market", expectedRevision: state.execution.revision } })).status()).toBe(422);
    expect(await reloadTraining(request, id)).toEqual(state);

    const second = await seedTraining(request, candles[600]!);
    expect(second.execution.account.id).not.toBe(firstAccount);
    expect(second.portfolio.baseBalance).toBe(0);
    expect(second.orders).toEqual([]);
    expect(await reloadTraining(request, id)).toEqual(state);
    await setTrainingWorkspace(request);
    const paperAfter = await readJson<{ portfolio: unknown }>(await request.get("/api/paper", { params: REPLAY_MARKET }));
    expect(paperAfter.portfolio).toEqual(paperBefore.portfolio);
  });

  test("limits and stop gaps use conservative prices from actual next-bar OHLC", async ({ request }) => {
    const candles = await trainingCandles(request);
    let state = await seedTraining(request, candles[600]!);
    const next = candles[601]!;
    // An already marketable buy limit still receives no better than its limit.
    const limit = next.high * 1.01;
    const resting = await queueTraining(request, state, { side: "buy", quantity: 0.001, type: "limit", price: next.low / 2 });
    const touched = await queueTraining(request, resting.snapshot, { side: "buy", quantity: 0.001, type: "limit", price: limit });
    // A buy stop below the next open gaps through its trigger and uses the adverse open.
    const stop = await queueTraining(request, touched.snapshot, { side: "buy", quantity: 0.001, type: "stop", price: next.low });
    state = await stepTraining(request, stop.snapshot);
    expect(state.orders.find((order) => order.clientOrderId === resting.orderId)).toMatchObject({ status: "submitted", fillPrice: null });
    expect(state.orders.find((order) => order.clientOrderId === touched.orderId)).toMatchObject({ status: "filled", fillPrice: limit });
    expect(state.orders.find((order) => order.clientOrderId === stop.orderId)?.fillPrice).toBeCloseTo(next.open * (1 + TRAINING_CONFIG.slippageRate), 8);
    expect(state.execution.fills.map((fill) => fill.orderId)).toEqual([touched.orderId, stop.orderId]);
    assertTrainingLedger(state);

    const sellLimitPrice = candles[602]!.low;
    const sellLimit = await queueTraining(request, state, { side: "sell", quantity: 0.001, type: "limit", price: sellLimitPrice });
    state = await stepTraining(request, sellLimit.snapshot);
    expect(state.orders.find((order) => order.clientOrderId === sellLimit.orderId)).toMatchObject({ status: "filled", fillPrice: sellLimitPrice });
    const sellStop = await queueTraining(request, state, { side: "sell", quantity: 0.001, type: "stop", price: candles[603]!.high });
    state = await stepTraining(request, sellStop.snapshot);
    expect(state.orders.find((order) => order.clientOrderId === sellStop.orderId)?.fillPrice).toBeCloseTo(candles[603]!.open * (1 - TRAINING_CONFIG.slippageRate), 8);
    expect(state.portfolio.baseBalance).toBeCloseTo(0, 12);
    assertTrainingLedger(state);
  });

  test("entry-bar stop protection wins and entry-bar targets wait for a later bar", async ({ request }) => {
    const candles = await trainingCandles(request);
    // Zero slippage makes the actual open an unambiguous bracket reference; fees still apply.
    const config = { ...TRAINING_CONFIG, slippageRate: 0 };
    const next = candles[601]!;
    let state = await seedTraining(request, candles[600]!, config);
    const bracket = await queueTraining(request, state, {
      side: "buy", quantity: 0.001, type: "market",
      stopLoss: (next.low + next.open) / 2, takeProfit: (next.high + next.open) / 2,
    });
    state = await stepTraining(request, bracket.snapshot);
    expect(state.execution.fills.map((fill) => fill.reason)).toEqual(["order", "stop-loss"]);
    expect(state.execution.fills[1]).toMatchObject({ orderId: bracket.orderId, timestamp: next.timestamp, side: "sell" });
    expect(state.execution.fills[1]!.price).toBeCloseTo((next.low + next.open) / 2, 8);
    expect(state.portfolio.baseBalance).toBe(0);
    assertTrainingLedger(state);

    // Keep the stop below the entry bar, then reveal a bar touching both exits.
    const ambiguousIndex = candles.findIndex((bar, i) => i >= 600 && i < 800 && candles[i + 1]!.low < bar.low && candles[i + 1]!.high > bar.open);
    expect(ambiguousIndex).toBeGreaterThanOrEqual(600);
    const protectedEntry = candles[ambiguousIndex]!;
    const ambiguousBar = candles[ambiguousIndex + 1]!;
    const stopLoss = (ambiguousBar.low + protectedEntry.low) / 2;
    const takeProfit = (protectedEntry.open + ambiguousBar.high) / 2;
    state = await seedTraining(request, candles[ambiguousIndex - 1]!, config);
    const protectedOrder = await queueTraining(request, state, { side: "buy", quantity: 0.001, type: "market", stopLoss, takeProfit });
    state = await stepTraining(request, protectedOrder.snapshot);
    expect(state.execution.fills.map((fill) => fill.reason)).toEqual(["order"]);
    state = await stepTraining(request, state);
    expect(state.execution.fills.map((fill) => fill.reason)).toEqual(["order", "stop-loss"]);
    expect(state.execution.fills[1]!.timestamp).toBe(ambiguousBar.timestamp);
    expect(state.execution.fills[1]!.price).toBeCloseTo(Math.min(ambiguousBar.open, stopLoss), 8);
    expect(state.portfolio.baseBalance).toBe(0);
    assertTrainingLedger(state);

    // Select a real pair of future bars where a valid target is touched on both.
    const index = candles.findIndex((bar, i) => i >= 600 && i < 800 && candles[i + 1]!.high > bar.open && bar.high > bar.open);
    expect(index).toBeGreaterThanOrEqual(600);
    const entryBar = candles[index]!;
    const laterBar = candles[index + 1]!;
    const target = (entryBar.open + Math.min(entryBar.high, laterBar.high)) / 2;
    state = await seedTraining(request, candles[index - 1]!, config);
    const targetOrder = await queueTraining(request, state, { side: "buy", quantity: 0.001, type: "market", takeProfit: target });
    state = await stepTraining(request, targetOrder.snapshot);
    expect(state.execution.fills.map((fill) => fill.reason)).toEqual(["order"]);
    expect(state.portfolio.baseBalance).toBe(0.001);
    state = await stepTraining(request, state);
    expect(state.execution.fills.map((fill) => fill.reason)).toEqual(["order", "take-profit"]);
    expect(state.execution.fills[1]!.timestamp).toBe(laterBar.timestamp);
    expect(state.execution.fills[1]!.price).toBeCloseTo(Math.max(laterBar.open, target), 8);
    assertTrainingLedger(state);
  });

  test("browser controls seed, queue, step, journal, restore and finish the real simulator", async ({ page, request }) => {
    const candles = await trainingCandles(request);
    await page.goto("/");
    await page.getByTestId("workspace-replay").click();
    await expect(page.getByTestId("replay-seed")).toHaveText("Seed BTC/USDT · 1d");
    const start = new Date(candles[600]!.timestamp + REPLAY_INTERVAL);
    const localStart = new Date(start.getTime() - start.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
    await page.getByLabel("START AT · LOCAL TIME").fill(localStart);
    await page.getByLabel("INITIAL CAPITAL · QUOTE").fill(String(TRAINING_CONFIG.initialCapital));
    await page.getByLabel("FEE RATE", { exact: true }).fill(String(TRAINING_CONFIG.feeRate));
    await page.getByLabel("SLIPPAGE RATE").fill(String(TRAINING_CONFIG.slippageRate));
    const seeded = page.waitForResponse((response) => new URL(response.url()).pathname === "/api/replay" && response.request().method() === "POST");
    await page.getByTestId("replay-seed").click();
    const seedResponse = await seeded;
    expect(seedResponse.status()).toBe(201);
    const seed = await seedResponse.json() as ReplaySeed;
    expect(seed.execution.config).toEqual(TRAINING_CONFIG);
    expect(seed.session.cursor).toBe(candles[600]!.timestamp);
    let state = await reloadTraining(request, seed.session.id);
    const endpoint = `/api/replay/${state.session.id}`;
    const ticket = page.locator(".replay-ticket");
    await expect(ticket.getByText("REPLAY SIMULATOR", { exact: true })).toBeVisible();
    const submit = async (button: import("@playwright/test").Locator, action: string): Promise<ReplaySnapshot> => {
      const responsePromise = page.waitForResponse((response) => new URL(response.url()).pathname === endpoint && response.request().method() === "POST" && response.request().postDataJSON().action === action);
      await button.click();
      const response = await responsePromise;
      expect(response.status()).toBe(200);
      const snapshot = await response.json() as ReplaySnapshot;
      await expect(page.getByTestId("replay-step")).toBeEnabled();
      return snapshot;
    };
    await ticket.getByLabel("QUANTITY · BTC").fill("0.002");
    state = await submit(ticket.getByRole("button", { name: "Queue buy", exact: true }), "order");
    expect(state.execution.fills).toEqual([]);
    expect(state.orders[0]?.status).toBe("submitted");
    await expect(ticket.getByRole("button", { name: "Cancel", exact: true })).toBeVisible();
    const queuedRevision = state.execution.revision;
    state = await submit(page.getByTestId("replay-step"), "step");
    expect(state.execution.revision).toBe(queuedRevision + 1);
    expect(state.session.cursor).toBe(candles[601]!.timestamp);
    expect(state.execution.fills).toHaveLength(1);
    expect(state.execution.fills[0]!.price).toBeCloseTo(candles[601]!.open * (1 + TRAINING_CONFIG.slippageRate), 8);
    await expect(ticket.getByText("0.002000 BTC", { exact: true })).toBeVisible();
    await ticket.getByLabel("QUANTITY · BTC").fill("1");
    await expect(ticket.getByRole("button", { name: "Queue sell", exact: true })).toBeDisabled();
    await ticket.getByText("REPLAY SIMULATOR", { exact: true }).click();
    await page.keyboard.press("s");
    const revisionBeforeJournal = state.execution.revision;
    await page.getByLabel("Replay speed").selectOption("2");
    await expect(page.getByLabel("Replay speed")).toHaveValue("2");
    await ticket.getByLabel("SESSION NOTES").fill("Browser training journal");
    await ticket.getByLabel("TAGS · COMMA SEPARATED").fill("browser, manual");
    state = await submit(ticket.getByRole("button", { name: "Save notes / tags", exact: true }), "journal");
    expect(state.execution.revision).toBe(revisionBeforeJournal + 1);
    expect(state.orders).toHaveLength(1);
    expect(state.report).toMatchObject({ notes: "Browser training journal", tags: ["browser", "manual"] });
    assertTrainingLedger(state);
    const saved = state;
    const restored = page.waitForResponse((response) => new URL(response.url()).pathname === endpoint && response.request().method() === "GET");
    await page.reload();
    expect((await restored).ok()).toBeTruthy();
    await expect(ticket.getByText("0.002000 BTC", { exact: true })).toBeVisible();
    expect((await reloadTraining(request, saved.session.id)).execution).toEqual(saved.execution);
    const finishedResponse = page.waitForResponse((response) => new URL(response.url()).pathname === endpoint && response.request().method() === "POST" && response.request().postDataJSON().action === "finish");
    await page.getByRole("button", { name: "Finish", exact: true }).click();
    const finished = await finishedResponse;
    expect(finished.status()).toBe(200);
    state = await finished.json() as ReplaySnapshot;
    expect(state.session.status).toBe("finished");
    expect(state.execution.fills).toEqual(saved.execution.fills);
    expect(state.portfolio).toEqual(saved.portfolio);
    assertTrainingLedger(state);
    await expect(page.getByTestId("replay-step")).toBeDisabled();
    await expect(ticket.getByRole("button", { name: "Queue buy", exact: true })).toBeDisabled();
    await expect(ticket.getByText("FINISHED", { exact: true })).toBeVisible();
    const downloading = page.waitForEvent("download");
    await ticket.getByRole("button", { name: "Export journal JSON", exact: true }).click();
    const download = await downloading;
    expect(download.suggestedFilename()).toBe(`replay-${state.session.id}.json`);
    const stream = await download.createReadStream();
    if (!stream) throw new Error("Replay journal download did not provide a stream.");
    const chunks: Buffer[] = [];
    for await (const chunk of stream) chunks.push(Buffer.from(chunk));
    const exported = JSON.parse(Buffer.concat(chunks).toString("utf8")) as Pick<ReplaySnapshot, "session" | "execution" | "report">;
    expect(exported).toEqual({ session: state.session, execution: state.execution, report: state.report });
    expect(exported.session.bars.every((bar) => bar.timestamp <= state.session.cursor)).toBe(true);
  });
});

test("Paper shows an interrupted intent from its original account and persists manual cancellation", async ({ page }, info) => {
  // playwright.config pins one directory for both the server and every worker,
  // so this is the database the API actually reads. Assert equality rather than
  // silently falling back to a directory the server never opened.
  const directory = process.env.NEWBEING_E2E_DATA_DIR;
  expect(directory, "Recovery E2E needs the isolated fixture database directory.").toBeTruthy();
  /* With an externally managed server (PLAYWRIGHT_BASE_URL) there is no webServer
     block to compare against; the seeded-intent read below is the real proof that
     the API opened this directory. Inline-server runs can state it up front. */
  const serverDirectory = info.config.webServer?.env?.NEWBEING_DATA_DIR;
  if (serverDirectory !== undefined) {
    expect(serverDirectory, "The dev server must use the same fixture database as this test.").toBe(directory);
  }
  const clientOrderId = `interrupted-${randomUUID()}`;
  const moduleUrl = pathToFileURL(resolve("packages/storage/dist/index.js")).href;
  const child = spawnSync(process.execPath, ["--input-type=module", "-e", `
    import * as s from ${JSON.stringify(moduleUrl)};
    s.beginPaperIntent({ clientOrderId: ${JSON.stringify(clientOrderId)}, symbol: 'BTC/USD', side: 'buy', quantity: 0.1 }, s.paperAccountId('BTC/USD', 'kraken'));
    s.markPaperIntentSubmitted(${JSON.stringify(clientOrderId)});
    process.exit(73);
  `], { env: { ...process.env, NEWBEING_DATA_DIR: directory }, encoding: "utf8", timeout: 15000 });
  expect(child.stderr).toBe("");
  expect(child.status).toBe(73);
  // Prove the server is reading the file this test just wrote, so a split
  // database surfaces here instead of as a confusing "card not found".
  const seeded = await readJson<{ pending: { clientOrderId: string }[] }>(await page.request.get("/api/paper/recovery"));
  expect(seeded.pending.some((order) => order.clientOrderId === clientOrderId),
    `Server did not see the seeded intent in ${directory}. The dev server and this test must share NEWBEING_DATA_DIR.`).toBe(true);
  await setTrainingWorkspace(page.request);
  const before = await readJson<{ portfolio: unknown }>(await page.request.get("/api/paper?symbol=BTC/USD&exchange=kraken"));
  await page.goto("/");
  const panel = page.getByTestId("paper-recovery");
  /* "0 pending" before the first read resolves is not an account state. Wait for
     the panel to actually report a completed read, so a slow first load surfaces
     as a load failure instead of being read as "the intent disappeared". */
  await expect(panel).toHaveAttribute("data-loaded", "true", { timeout: 20_000 });
  const card = panel.locator(".order-preview-card").filter({ hasText: clientOrderId });
  await expect(card).toContainText("paper:kraken-spot:BTC:USD");
  await expect(card).toContainText("submitted");
  const cancel = card.getByRole("button", { name: "Cancel pending Paper", exact: true });
  await expect(cancel).toBeDisabled();
  await card.getByRole("textbox").fill("Operator cancels interrupted fixture before any local fill.");
  const persisted = page.waitForResponse((response) => response.url().endsWith("/api/paper/recovery") && response.request().method() === "POST");
  await cancel.click();
  expect((await persisted).status()).toBe(200);
  await expect(card).toContainText("submitted → cancelled");
  await page.reload();
  await expect(panel.locator(".order-preview-card").filter({ hasText: clientOrderId })).toContainText("Operator cancels interrupted fixture");
  const after = await readJson<{ portfolio: unknown }>(await page.request.get("/api/paper?symbol=BTC/USD&exchange=kraken"));
  expect(after.portfolio).toEqual(before.portfolio);
  const state = await readJson<{ pending: { clientOrderId: string }[] }>(await page.request.get("/api/paper/recovery"));
  expect(state.pending.some((order) => order.clientOrderId === clientOrderId)).toBe(false);
});
