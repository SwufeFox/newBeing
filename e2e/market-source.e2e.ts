import { expect, test, type WebSocketRoute } from "@playwright/test";
import { installApiMocks } from "./api-mocks.js";

const BINANCE_STREAM = /^wss:\/\/stream\.binance\.com(?::\d+)?\//;
const INTERVAL = 15 * 60_000;
const START = Date.UTC(2026, 10, 12);

for (const symbol of ["BTC/USDT", "ETH/USDT"]) {
  test(`${symbol} fixture chart keeps fixture prices through refreshes without opening Binance`, async ({ page }) => {
    const mock = await installApiMocks(page);
    mock.workspace.symbol = symbol;
    let candleRequests = 0;
    const connections: string[] = [];
    await page.routeWebSocket(BINANCE_STREAM, (socket) => { connections.push(socket.url()); });
    await page.route("**/api/market?**", async (route) => {
      const kind = new URL(route.request().url()).searchParams.get("kind");
      if (kind === "summary") {
        await route.fulfill({ json: { symbol, last: 3191.08, changePct24h: 0, timestamp: START, source: "Deterministic test fixture" } });
      } else if (kind === "candles") {
        candleRequests += 1;
        const candles = Array.from({ length: 60 }, (_, index) => ({ timestamp: START + index * INTERVAL, open: 3191, high: 3192, low: 3190, close: 3191.08, volume: 1 }));
        await route.fulfill({ json: { candles, gaps: [], source: "Deterministic test fixture" } });
      } else {
        await route.fallback();
      }
    });
    await page.clock.install();
    await page.goto("/w/markets");
    const chart = page.getByTestId("market-chart");
    await expect(chart.locator(".stream-indicator")).toHaveText("TEST FIXTURE");
    await expect(chart.locator(".chart-footer")).toContainText("UTC · TEST FIXTURE");
    await expect(chart.locator(".chart-meta-left b").nth(3)).toHaveText("3,191.08");
    await expect(chart).not.toContainText("public spot data");
    await expect(chart).not.toContainText("Realtime");
    const initialRequests = candleRequests;
    await page.clock.fastForward(65_000);
    await expect.poll(() => candleRequests).toBeGreaterThan(initialRequests);
    await expect(chart.locator(".chart-meta-left b").nth(3)).toHaveText("3,191.08");
    expect(connections).toEqual([]);
  });
}

test("Binance waits for candle provenance, streams public data, then closes when the source changes", async ({ page }) => {
  await installApiMocks(page);
  const sockets: WebSocketRoute[] = [];
  const closed: string[] = [];
  await page.routeWebSocket(BINANCE_STREAM, (socket) => {
    sockets.push(socket);
    socket.onClose(() => { closed.push(socket.url()); });
  });
  const { promise: sourceReady, resolve: releaseSource } = Promise.withResolvers<void>();
  let source = "Binance Spot via CCXT";
  await page.route("**/api/market?**", async (route) => {
    if (new URL(route.request().url()).searchParams.get("kind") !== "candles") return route.fallback();
    await sourceReady;
    const close = source === "Deterministic test fixture" ? 3191.08 : 1952;
    const candles = Array.from({ length: 60 }, (_, index) => ({ timestamp: START + index * INTERVAL, open: close, high: close + 1, low: close - 1, close, volume: 1 }));
    await route.fulfill({ json: { candles, gaps: [], source } });
  });
  await page.clock.install();
  await page.goto("/w/markets");
  const chart = page.getByTestId("market-chart");
  await expect(chart.getByRole("status")).toContainText("Loading BINANCE history");
  expect(sockets).toHaveLength(0);
  releaseSource();
  await expect(chart.locator(".stream-indicator")).toHaveText("Realtime");
  await expect.poll(() => sockets.length).toBe(1);
  sockets[0]!.send(JSON.stringify({ k: { t: START + 60 * INTERVAL, o: "1952", h: "1957", l: "1951", c: "1956", v: "2", x: false } }));
  await expect(chart.locator(".chart-meta-left b").nth(3)).toHaveText("1,956.00");

  source = "Deterministic test fixture";
  sockets[0]!.close();
  await expect(chart.locator(".stream-indicator")).toHaveText("Reconnecting…");
  await page.clock.fastForward(5_000);
  await expect(chart.locator(".stream-indicator")).toHaveText("TEST FIXTURE");
  await expect(chart.locator(".chart-meta-left b").nth(3)).toHaveText("3,191.08");
  await expect.poll(() => closed.length).toBeGreaterThan(0);
  await page.clock.fastForward(65_000);
  expect(sockets).toHaveLength(2);
  await expect(chart.locator(".chart-meta-left b").nth(3)).toHaveText("3,191.08");
});

for (const exchange of ["kraken", "binance"]) {
  test(`${exchange} public chart uses its transport and freezes in Replay`, async ({ page }) => {
    const mock = await installApiMocks(page);
    mock.workspace.exchange = exchange;
    mock.workspace.symbol = exchange === "kraken" ? "BTC/USD" : "BTC/USDT";
    const connections: string[] = [];
    const closed: string[] = [];
    await page.routeWebSocket(BINANCE_STREAM, (socket) => {
      connections.push(socket.url());
      socket.onClose(() => { closed.push(socket.url()); });
    });
    let candleRequests = 0;
    await page.route("**/api/market?**", async (route) => {
      if (new URL(route.request().url()).searchParams.get("kind") !== "candles") return route.fallback();
      candleRequests += 1;
      const candles = Array.from({ length: 60 }, (_, index) => ({ timestamp: START + index * INTERVAL, open: 85000, high: 85001, low: 84999, close: 85000, volume: 1 }));
      await route.fulfill({ json: { candles, gaps: [], source: exchange === "kraken" ? "Kraken Spot via CCXT" : "Binance Spot via CCXT" } });
    });
    await page.clock.install();
    await page.goto("/w/markets");
    const chart = page.getByTestId("market-chart");
    await expect(chart.locator(".stream-indicator")).toHaveText(exchange === "kraken" ? "60s refresh" : "Realtime");
    await expect(chart.locator(".chart-footer")).toContainText(`${exchange.toUpperCase()} public spot data`);
    const initialRequests = candleRequests;
    await page.clock.fastForward(65_000);
    if (exchange === "kraken") await expect.poll(() => candleRequests).toBeGreaterThan(initialRequests);
    expect(connections).toHaveLength(exchange === "kraken" ? 0 : 1);

    await page.getByTestId("workspace-replay").click();
    await expect(chart.locator(".stream-indicator")).toHaveText("Historical Replay");
    if (exchange === "binance") await expect.poll(() => closed.length).toBe(1);
    const requestsBeforeReplay = candleRequests;
    const legendBeforeReplay = await chart.locator(".chart-meta-left").innerText();
    await page.clock.fastForward(65_000);
    expect(candleRequests).toBe(requestsBeforeReplay);
    expect(connections).toHaveLength(exchange === "kraken" ? 0 : 1);
    await expect(chart.locator(".chart-meta-left")).toHaveText(legendBeforeReplay);
  });
}
