import type { Page } from "@playwright/test";

const BASE_TIME = Date.UTC(2026, 9, 3, 19, 0, 0);
const INTERVAL = 15 * 60_000;
const SYMBOL = "BTC/USDT";
const TIMEFRAME = "15m";

export interface ApiMockState {
  workspace: Record<string, unknown>;
}

function fixtureCandles() {
  return Array.from({ length: 500 }, (_, index) => {
    const close = 85_000 * (1 + Math.sin(index / 17) * 0.035 + Math.sin(index / 5) * 0.009);
    const open = close * (1 + Math.sin(index * 1.7) * 0.0012);
    return {
      timestamp: BASE_TIME + index * INTERVAL,
      open,
      high: Math.max(open, close) + 170,
      low: Math.min(open, close) - 170,
      close,
      volume: 10 + (index % 23),
    };
  });
}

export async function installApiMocks(page: Page): Promise<ApiMockState> {
  const candles = fixtureCandles();
  const last = candles.at(-1)!;
  const summary = {
    symbol: SYMBOL,
    last: last.close,
    changePct24h: 1.25,
    high24h: last.close * 1.01,
    low24h: last.close * 0.99,
    quoteVolume24h: 4_200_000,
    bid: last.close * 0.9999,
    ask: last.close * 1.0001,
    timestamp: last.timestamp,
  };
  const workspace: Record<string, unknown> = {
    symbol: SYMBOL,
    timeframe: TIMEFRAME,
    exchange: "binance",
    mode: "paper",
    activeWorkspace: "terminal",
    selectedStrategyId: "sma-crossover",
    activeBacktestId: null,
    activeReplayId: null,
    visibleRange: { from: null, to: null },
    layout: { watchlistWidth: 220, inspectorWidth: 300, bottomHeight: 224 },
  };
  const state: ApiMockState = { workspace };
  const portfolio = { quoteBalance: 10_000, baseBalance: 0, averageEntryPrice: null, realizedPnl: 0, totalFees: 0 };
  let draft: Record<string, unknown> | null = null;
  let replay = {
    id: "e2e-replay-fixture",
    symbol: SYMBOL,
    timeframe: TIMEFRAME,
    startAt: candles[0]!.timestamp,
    cursor: candles[0]!.timestamp,
    bars: [candles[0]!],
    status: "active",
    createdAt: "2026-10-09T00:00:00.000Z",
    updatedAt: "2026-10-09T00:00:00.000Z",
  };

  await page.context().routeWebSocket(/^wss:\/\/stream\.binance\.com(?::\d+)?\//, () => {});
  await page.route("https://api.binance.com/**", (route) => route.abort());
  await page.route("**/api/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const method = request.method().toUpperCase();
    const path = url.pathname;
    const json = (body: unknown, status = 200) => route.fulfill({
      status,
      contentType: "application/json",
      body: JSON.stringify(body),
    });

    if (path === "/api/workspace") {
      if (method === "PUT") {
        const body = request.postDataJSON() as Record<string, unknown>;
        Object.assign(workspace, (body.state as Record<string, unknown> | undefined) ?? body);
      }
      return json({ state: workspace, updatedAt: 1_800_000_000_000 });
    }

    if (path === "/api/markets") {
      return json({ items: [{ symbol: SYMBOL, base: "BTC", quote: "USDT", active: true }], source: "Deterministic test fixture" });
    }

    if (path === "/api/market") {
      const kind = url.searchParams.get("kind");
      if (kind === "summary") return json({ ...summary, source: "Deterministic test fixture" });
      if (kind === "book") {
        return json({
          symbol: SYMBOL,
          timestamp: last.timestamp,
          bids: [{ price: summary.bid, amount: 1 }, { price: summary.bid * 0.999, amount: 2 }],
          asks: [{ price: summary.ask, amount: 1 }, { price: summary.ask * 1.001, amount: 2 }],
          source: "Deterministic test fixture",
        });
      }
      if (kind === "trades") {
        return json({ items: [{ id: "fixture-trade-1", timestamp: last.timestamp, side: "buy", price: last.close, amount: 0.01 }], source: "Deterministic test fixture" });
      }
      if (kind === "tickers") return json({ items: [summary], source: "Deterministic test fixture" });
      return json({ candles, completed: candles, gaps: [], source: "Deterministic test fixture" });
    }

    if (path === "/api/strategies") {
      if (method === "POST") {
        const body = request.postDataJSON() as Record<string, unknown>;
        draft = { ...body, id: "custom-e2e-draft", executable: false, updatedAt: "2026-10-09T00:00:00.000Z" };
        return json({ strategy: draft, executable: false }, 201);
      }
      return json({ items: draft ? [draft] : [], strategies: draft ? [draft] : [] });
    }

    if (path === "/api/backtests" && method === "POST") {
      const parameters = { fastPeriod: 20, slowPeriod: 50, allowShorts: false };
      const equityCurve = candles.map((candle, index) => ({
        timestamp: candle.timestamp,
        equity: 10_000 + index * 0.2,
        drawdown: 0,
      }));
      const result = {
        resultId: "e2e-backtest-fixture",
        datasetId: "e2e-dataset-fixture",
        symbol: SYMBOL,
        timeframe: TIMEFRAME,
        strategyId: "sma-crossover",
        strategyVersion: "1.0.0",
        parameters,
        assumptions: { initialCapital: 10_000, positionFraction: 0.25, feeRate: 0.001, slippageRate: 0.0005, allowShorts: false },
        execution: { signalTiming: "bar close", fillTiming: "next bar open", intrabarStops: "stop before target", endOfData: "close at final bar", sharpeMethod: "per-bar" },
        engineVersion: "0.1.0",
        createdAt: "2026-10-09T00:00:00.000Z",
        metrics: { initialCapital: 10_000, finalEquity: 10_100, totalReturn: 0.01, sharpeRatio: 0.8, maxDrawdown: 0.02, winRate: 0.6, profitFactor: 1.4, tradeCount: 1, totalFees: 2 },
        equityCurve,
        trades: [{ id: "e2e-trade-1", side: "long", entryTime: candles[10]!.timestamp, exitTime: candles[20]!.timestamp, entryPrice: 85_000, exitPrice: 85_300, quantity: 0.1, grossPnl: 30, fees: 2, netPnl: 28, returnPct: 0.0033, exitReason: "signal" }],
        signals: candles.map((candle, index) => ({ timestamp: candle.timestamp, side: index < 50 ? "flat" : "long" })),
      };
      return json(result, 201);
    }

    if (path === "/api/paper") {
      if (method === "POST") {
        const body = request.postDataJSON() as Record<string, unknown>;
        const order = { clientOrderId: "e2e-paper-order", symbol: SYMBOL, side: body.side ?? "buy", quantity: Number(body.quantity ?? 0.001), fillPrice: last.close, status: "filled", createdAt: "2026-10-09T00:00:00.000Z" };
        return json({ order, portfolio: { ...portfolio, quoteBalance: 9_915, baseBalance: 0.001, averageEntryPrice: last.close } });
      }
      return json({ portfolio, orders: [], previews: [] });
    }

    if (path === "/api/order-previews") return json({ previews: [], items: [] });

    if (path === "/api/replay" && method === "POST") {
      const body = request.postDataJSON() as Record<string, unknown>;
      replay = { ...replay, symbol: String(body.symbol ?? SYMBOL), timeframe: String(body.timeframe ?? TIMEFRAME), startAt: Number(body.startAt ?? replay.startAt) };
      return json({ session: replay, portfolio, source: "Deterministic test fixture historical bars", futureBarsLoaded: 0 }, 201);
    }

    if (path.startsWith("/api/replay/")) {
      if (method === "POST") {
        const nextBar = candles[Math.min(replay.bars.length, candles.length - 1)]!;
        replay = { ...replay, cursor: nextBar.timestamp, bars: [...replay.bars, nextBar], updatedAt: "2026-10-09T00:01:00.000Z" };
      }
      return json({ session: replay, portfolio, orders: [], hasNext: true });
    }

    if (path === "/api/experiments" || path === "/api/events") return json({ items: [], events: [] });
    return json({ items: [], data: [], ok: true });
  });

  return state;
}
