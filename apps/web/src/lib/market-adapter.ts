import {
  getExchangeAdapter,
  timeframeMilliseconds,
  type ExchangeAdapter,
  type MarketSummary,
  type MarketSymbol,
  type OrderBookSnapshot,
  type RecentTrade,
} from "@newbeing/market-data";
import type { Candle, ExchangeId, Timeframe } from "@newbeing/core";

const SYMBOLS: MarketSymbol[] = [
  { symbol: "BTC/USDT", base: "BTC", quote: "USDT", active: true },
  { symbol: "ETH/USDT", base: "ETH", quote: "USDT", active: true },
  { symbol: "BNB/USDT", base: "BNB", quote: "USDT", active: true },
  { symbol: "SOL/USDT", base: "SOL", quote: "USDT", active: true },
  { symbol: "XRP/USDT", base: "XRP", quote: "USDT", active: true },
];

const FIXTURE_NATIVE_IDS: Record<string, string> = {
  "BTC/USDT": "BTCUSDT", "ETH/USDT": "ETHUSDT", "BNB/USDT": "BNBUSDT", "SOL/USDT": "SOLUSDT", "XRP/USDT": "XRPUSDT",
};

const prices: Record<string, number> = {
  "BTC/USDT": 85_000,
  "ETH/USDT": 3_100,
  "BNB/USDT": 620,
  "SOL/USDT": 180,
  "XRP/USDT": 2.4,
};

function buildFixtureBars(symbol: string, timeframe: Timeframe): Candle[] {
  const interval = timeframeMilliseconds(timeframe);
  const latestCompletedStart = Math.floor(Date.now() / interval) * interval - interval;
  const base = prices[symbol] ?? 100;
  return Array.from({ length: 1_000 }, (_, index) => {
    const close = base * (1 + Math.sin(index / 17) * 0.035 + Math.sin(index / 5) * 0.009 + index * 0.00001);
    const open = close * (1 + Math.sin(index * 1.7) * 0.0012);
    const spread = base * 0.002;
    return {
      timestamp: latestCompletedStart - (999 - index) * interval,
      open,
      high: Math.max(open, close) + spread,
      low: Math.min(open, close) - spread,
      close,
      volume: 10 + (index % 23),
    };
  });
}

function summary(symbol: string, bars: readonly Candle[]): MarketSummary {
  const last = bars.at(-1);
  const recent = bars.slice(-Math.min(bars.length, 96));
  const first = recent[0];
  const high = recent.length > 0 ? Math.max(...recent.map((bar) => bar.high)) : null;
  const low = recent.length > 0 ? Math.min(...recent.map((bar) => bar.low)) : null;
  const changePct24h = first && last ? ((last.close / first.close) - 1) * 100 : null;
  return {
    symbol,
    last: last?.close ?? null,
    changePct24h,
    high24h: high,
    low24h: low,
    quoteVolume24h: recent.reduce((total, bar) => total + bar.volume * bar.close, 0),
    bid: last?.close ? last.close * 0.9999 : null,
    ask: last?.close ? last.close * 1.0001 : null,
    timestamp: Date.now(),
  };
}

const fixtureAdapter: ExchangeAdapter = {
  id: "binance",
  async getInstrument(symbol) {
    const market = SYMBOLS.find((item) => item.symbol === symbol);
    const nativeId = FIXTURE_NATIVE_IDS[symbol];
    if (!market || !nativeId) throw new Error("Unknown deterministic fixture instrument.");
    return { ...market, id: `binance:spot:${nativeId}`, venue: "binance", nativeId, marketType: "spot", precision: { amount: 0.00001, price: 0.01, mode: 4 }, limits: { amount: { min: 0.00001, max: 1000 }, cost: { min: 5, max: null } } };
  },
  getConnectorMetadata() {
    return { id: "binance", name: "Deterministic Binance Spot fixture", timeframes: ["1m", "5m", "15m", "30m", "1h", "4h", "1d"], capabilities: { fetchOHLCV: true, fetchTicker: true, fetchOrderBook: true, fetchTrades: true }, realExecution: false, untrustedJavaScript: { enabled: false, blocker: "Fixture connector does not execute strategies." } };
  },
  async searchSymbols(query, limit = 60) {
    const normalized = query.trim().toUpperCase();
    return SYMBOLS.filter((item) => !normalized || item.symbol.includes(normalized) || item.base.includes(normalized)).slice(0, limit);
  },
  async fetchOHLCV(symbol, timeframe, limit = 500) {
    return buildFixtureBars(symbol, timeframe).slice(-limit);
  },
  async fetchOHLCVSince(symbol, timeframe, since, limit = 500) {
    return buildFixtureBars(symbol, timeframe).filter((candle) => candle.timestamp >= since).slice(0, limit);
  },
  async fetchSummary(symbol) {
    return summary(symbol, buildFixtureBars(symbol, "15m"));
  },
  async fetchSummaries(symbols) {
    return Promise.all(symbols.map((symbol) => this.fetchSummary(symbol)));
  },
  async fetchOrderBook(symbol, limit = 16): Promise<OrderBookSnapshot> {
    const current = (await this.fetchSummary(symbol)).last ?? prices[symbol] ?? 100;
    return {
      symbol,
      timestamp: Date.now(),
      bids: Array.from({ length: limit }, (_, index) => ({ price: current * (1 - (index + 1) * 0.0001), amount: 0.1 + index * 0.01 })),
      asks: Array.from({ length: limit }, (_, index) => ({ price: current * (1 + (index + 1) * 0.0001), amount: 0.1 + index * 0.01 })),
    };
  },
  async fetchRecentTrades(symbol, limit = 24): Promise<RecentTrade[]> {
    const current = (await this.fetchSummary(symbol)).last ?? prices[symbol] ?? 100;
    return Array.from({ length: limit }, (_, index) => ({
      id: `fixture-${symbol.replace("/", "-")}-${index}`,
      timestamp: Date.now() - index * 1_000,
      side: index % 2 === 0 ? "buy" : "sell",
      price: current * (1 + Math.sin(index) * 0.0002),
      amount: 0.01 + index * 0.001,
    }));
  },
  async close() {},
};

const isFixtureMode = process.env.NEWBEING_E2E_FIXTURES === "1" && process.env.NODE_ENV !== "production";
export function getWebMarketAdapter(exchange: ExchangeId = "binance"): ExchangeAdapter {
  if (isFixtureMode && exchange === "binance") return fixtureAdapter;
  return getExchangeAdapter(exchange);
}

/* The venue label map lives in ./exchanges.ts, not here: this module pulls in
   ccxt (a server-only dependency), so importing it from a client component
   would try to bundle the whole exchange library into the browser. Re-exported
   for existing server-side callers. */
export { EXCHANGE_LABELS } from "./exchanges";
import { EXCHANGE_LABELS } from "./exchanges";

export function marketDataSourceLabel(exchange: ExchangeId = "binance"): string {
  return isFixtureMode && exchange === "binance" ? "Deterministic test fixture" : `${EXCHANGE_LABELS[exchange]} via CCXT`;
}
