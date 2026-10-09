import ccxt, { type MarketInterface, type OHLCV, type OrderBook as CcxtOrderBook, type Trade as CcxtTrade } from "ccxt";
import type { Candle, Timeframe } from "@newbeing/core";
import { findCandleGaps, mergeCandles, reconnectDelayMs, removeFormingCandles, timeframeMilliseconds } from "./utils.js";
import type {
  ExchangeAdapter,
  MarketSummary,
  MarketSymbol,
  OrderBookSnapshot,
  RecentTrade,
} from "./types.js";

const SUPPORTED_TIMEFRAMES = new Set<Timeframe>(["1m", "5m", "15m", "30m", "1h", "4h", "1d"]);

function validSymbol(symbol: string): string {
  const value = symbol.trim().toUpperCase();
  if (!/^[A-Z0-9]{2,20}\/[A-Z0-9]{2,20}$/.test(value)) throw new Error("Invalid spot symbol.");
  return value;
}

function finiteOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export class BinanceSpotAdapter implements ExchangeAdapter {
  readonly id = "binance" as const;
  private readonly exchange: InstanceType<typeof ccxt.binance>;

  constructor() {
    this.exchange = new ccxt.binance({
      enableRateLimit: true,
      options: { defaultType: "spot", adjustForTimeDifference: true },
      timeout: 12_000,
    });
  }

  async searchSymbols(query: string, limit = 60): Promise<MarketSymbol[]> {
    const markets: Record<string, MarketInterface | undefined> = await this.exchange.loadMarkets();
    const normalized = query.trim().toUpperCase().replace(/[^A-Z0-9/]/g, "");
    const marketList = Object.values(markets).filter((market): market is MarketInterface => market !== undefined);
    return marketList
      .filter((market) => market.spot && market.quote === "USDT" && market.active !== false)
      .filter((market) => normalized.length === 0 || market.symbol.includes(normalized) || market.base.includes(normalized))
      .sort((a, b) => a.symbol.localeCompare(b.symbol))
      .slice(0, Math.max(1, Math.min(100, limit)))
      .map((market) => ({ symbol: market.symbol, base: market.base, quote: market.quote, active: market.active !== false }));
  }

  async fetchOHLCV(symbol: string, timeframe: Timeframe, limit = 500): Promise<Candle[]> {
    return this.fetchOHLCVFrom(symbol, timeframe, undefined, limit);
  }

  async fetchOHLCVSince(symbol: string, timeframe: Timeframe, since: number, limit = 500): Promise<Candle[]> {
    if (!Number.isFinite(since) || since < 0) throw new Error("OHLCV start timestamp must be a non-negative UTC millisecond value.");
    return this.fetchOHLCVFrom(symbol, timeframe, since, limit);
  }

  private async fetchOHLCVFrom(symbol: string, timeframe: Timeframe, since: number | undefined, limit: number): Promise<Candle[]> {
    if (!SUPPORTED_TIMEFRAMES.has(timeframe)) throw new Error("Unsupported timeframe.");
    await this.exchange.loadMarkets();
    const normalized = validSymbol(symbol);
    const rows: OHLCV[] = await this.exchange.fetchOHLCV(normalized, timeframe, since, Math.max(2, Math.min(1000, limit)));
    return rows.map((row: OHLCV) => {
      const [timestamp, open, high, low, close, volume] = row;
      if (typeof timestamp !== "number" || typeof open !== "number" || typeof high !== "number" || typeof low !== "number" || typeof close !== "number" || typeof volume !== "number"
        || ![timestamp, open, high, low, close, volume].every(Number.isFinite)) {
        throw new Error("Binance returned an invalid OHLCV row.");
      }
      return { timestamp, open, high, low, close, volume };
    });
  }

  async fetchSummary(symbol: string): Promise<MarketSummary> {
    const normalized = validSymbol(symbol);
    const ticker = await this.exchange.fetchTicker(normalized);
    return {
      symbol: normalized,
      last: finiteOrNull(ticker.last),
      changePct24h: finiteOrNull(ticker.percentage),
      high24h: finiteOrNull(ticker.high),
      low24h: finiteOrNull(ticker.low),
      quoteVolume24h: finiteOrNull(ticker.quoteVolume),
      bid: finiteOrNull(ticker.bid),
      ask: finiteOrNull(ticker.ask),
      timestamp: finiteOrNull(ticker.timestamp),
    };
  }

  async fetchSummaries(symbols: readonly string[]): Promise<MarketSummary[]> {
    const normalized = [...new Set(symbols.map(validSymbol))].slice(0, 40);
    if (normalized.length === 0) return [];
    const tickers = await this.exchange.fetchTickers(normalized);
    return normalized.flatMap((symbol) => {
      const ticker = tickers[symbol];
      if (!ticker) return [];
      return [{
        symbol,
        last: finiteOrNull(ticker.last),
        changePct24h: finiteOrNull(ticker.percentage),
        high24h: finiteOrNull(ticker.high),
        low24h: finiteOrNull(ticker.low),
        quoteVolume24h: finiteOrNull(ticker.quoteVolume),
        bid: finiteOrNull(ticker.bid),
        ask: finiteOrNull(ticker.ask),
        timestamp: finiteOrNull(ticker.timestamp),
      }];
    });
  }

  async fetchOrderBook(symbol: string, limit = 20): Promise<OrderBookSnapshot> {
    const normalized = validSymbol(symbol);
    const book: CcxtOrderBook = await this.exchange.fetchOrderBook(normalized, Math.max(5, Math.min(100, limit)));
    return {
      symbol: normalized,
      timestamp: finiteOrNull(book.timestamp),
      bids: book.bids.map(([price, amount]) => ({ price: price ?? 0, amount: amount ?? 0 })),
      asks: book.asks.map(([price, amount]) => ({ price: price ?? 0, amount: amount ?? 0 })),
    };
  }

  async fetchRecentTrades(symbol: string, limit = 20): Promise<RecentTrade[]> {
    const normalized = validSymbol(symbol);
    const trades = await this.exchange.fetchTrades(normalized, undefined, Math.max(5, Math.min(100, limit)));
    return trades.flatMap((trade: CcxtTrade) => {
      if (typeof trade.timestamp !== "number" || typeof trade.price !== "number" || typeof trade.amount !== "number"
        || ![trade.timestamp, trade.price, trade.amount].every(Number.isFinite)) return [];
      return [{
        id: typeof trade.id === "string" ? trade.id : `${trade.timestamp}-${trade.price}-${trade.amount}`,
        timestamp: trade.timestamp,
        side: trade.side === "buy" || trade.side === "sell" ? trade.side : "unknown",
        price: trade.price,
        amount: trade.amount,
      }];
    });
  }

  async close(): Promise<void> {
    await this.exchange.close();
  }
}

let singleton: BinanceSpotAdapter | undefined;

export function getBinanceAdapter(): BinanceSpotAdapter {
  singleton ??= new BinanceSpotAdapter();
  return singleton;
}

export { findCandleGaps, mergeCandles, reconnectDelayMs, removeFormingCandles, timeframeMilliseconds } from "./utils.js";
