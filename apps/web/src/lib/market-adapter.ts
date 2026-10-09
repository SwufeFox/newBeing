import {
  getBinanceAdapter,
  timeframeMilliseconds,
  type ExchangeAdapter,
  type MarketSummary,
  type MarketSymbol,
  type OrderBookSnapshot,
  type RecentTrade,
} from "@newbeing/market-data";
import type { Candle, Timeframe } from "@newbeing/core";

const SYMBOLS: MarketSymbol[] = [
  { symbol: "BTC/USDT", base: "BTC", quote: "USDT", active: true },
  { symbol: "ETH/USDT", base: "ETH", quote: "USDT", active: true },
  { symbol: "BNB/USDT", base: "BNB", quote: "USDT", active: true },
  { symbol: "SOL/USDT", base: "SOL", quote: "USDT", active: true },
  { symbol: "XRP/USDT", base: "XRP", quote: "USDT", active: true },
];

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
    timestamp: last?.timestamp ?? null,
  };
}

const fixtureAdapter: ExchangeAdapter = {
  id: "binance",
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
let realAdapter: ExchangeAdapter | undefined;

export function getWebMarketAdapter(): ExchangeAdapter {
  if (isFixtureMode) return fixtureAdapter;
  realAdapter ??= getBinanceAdapter();
  return realAdapter;
}

export function marketDataSourceLabel(): string {
  return isFixtureMode ? "Deterministic test fixture" : "Binance Spot via CCXT";
}
