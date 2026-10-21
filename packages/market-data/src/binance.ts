import ccxt, { type MarketInterface, type OHLCV, type OrderBook as CcxtOrderBook, type Trade as CcxtTrade } from "ccxt";
import type { Candle, ExchangeId, Timeframe } from "@newbeing/core";
import { EXCHANGE_TIMEFRAMES, instrumentId } from "@newbeing/core";
import { coalesceRequest } from "./coalesce.js";
import { findCandleGaps, mergeCandles, reconnectDelayMs, removeFormingCandles, timeframeMilliseconds } from "./utils.js";
import type { ExchangeAdapter, MarketSummary, MarketSymbol, OrderBookSnapshot, RecentTrade } from "./types.js";

const EXCHANGE_IDS: readonly ExchangeId[] = ["binance", "coinbaseexchange", "okx", "kraken"];

function validSymbol(symbol: string): string {
  const value = symbol.trim().toUpperCase();
  if (!/^[A-Z0-9]{2,20}\/[A-Z0-9]{2,20}$/.test(value)) throw new Error("Invalid spot symbol.");
  return value;
}

function finiteOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export class CcxtSpotAdapter implements ExchangeAdapter {
  readonly id: ExchangeId;
  private readonly exchange: InstanceType<typeof ccxt.binance>;

  constructor(id: ExchangeId) {
    if (!EXCHANGE_IDS.includes(id)) throw new Error(`Unsupported exchange: ${id}`);
    this.id = id;
    const Exchange = ccxt[id] as typeof ccxt.binance;
    this.exchange = new Exchange({ enableRateLimit: true, options: { defaultType: "spot", adjustForTimeDifference: true }, timeout: 12_000 });
  }

  getConnectorMetadata() {
    const capabilities: Record<string, boolean | "emulated"> = {};
    for (const name of ["fetchOHLCV", "fetchTicker", "fetchTickers", "fetchOrderBook", "fetchTrades"]) {
      const supported = this.exchange.has[name];
      capabilities[name] = supported === "emulated" ? "emulated" : supported === true;
    }
    return { id: this.id, name: this.exchange.name ?? this.id, timeframes: Object.keys(this.exchange.timeframes ?? {}).filter((value) => EXCHANGE_TIMEFRAMES[this.id].includes(value as Timeframe)), capabilities, realExecution: false as const,
      untrustedJavaScript: { enabled: false as const, blocker: "Secure OS process isolation and resource limits are not configured. Only built-in strategies can execute." } };
  }

  async getInstrument(symbol: string) {
    await this.exchange.loadMarkets();
    const market = this.exchange.market(validSymbol(symbol));
    if (!market.spot || !market.id) throw new Error("A native spot instrument is required.");
    return { id: instrumentId(this.id, market.id), venue: this.id, nativeId: market.id, symbol: market.symbol, base: market.base, quote: market.quote, marketType: "spot" as const, active: market.active !== false,
      precision: { amount: finiteOrNull(market.precision?.amount), price: finiteOrNull(market.precision?.price), mode: finiteOrNull(this.exchange.precisionMode) },
      limits: { amount: { min: finiteOrNull(market.limits?.amount?.min), max: finiteOrNull(market.limits?.amount?.max) }, cost: { min: finiteOrNull(market.limits?.cost?.min), max: finiteOrNull(market.limits?.cost?.max) } } };
  }

  async searchSymbols(query: string, limit = 60): Promise<MarketSymbol[]> {
    const markets: Record<string, MarketInterface | undefined> = await this.exchange.loadMarkets();
    const normalized = query.trim().toUpperCase().replace(/[^A-Z0-9/]/g, "");
    return Object.values(markets)
      .filter((market): market is MarketInterface => market !== undefined)
      .filter((market) => market.spot && market.active !== false)
      .filter((market) => normalized.length === 0 || market.symbol.includes(normalized) || market.base.includes(normalized) || market.quote.includes(normalized))
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
    if (!EXCHANGE_TIMEFRAMES[this.id].includes(timeframe)) throw new Error(`${this.id} does not support ${timeframe} candles.`);
    const normalized = validSymbol(symbol);
    const safeLimit = Math.max(2, Math.min(1000, Number.isFinite(limit) ? Math.floor(limit) : 500));
    const key = `${this.id}|ohlcv|${normalized}|${timeframe}|${since ?? "latest"}|${safeLimit}`;
    return coalesceRequest(key, async () => {
      await this.exchange.loadMarkets();
      /* CCXT 4.5.85 implements deterministic OHLCV pagination for Coinbase
         (300 candles per request) and Kraken (720). Keep the requested total
         limit and let that implementation page, including when `since` is set. */
      const params = this.id === "coinbaseexchange" || this.id === "kraken" ? { paginate: true } : {};
      const rows: OHLCV[] = await this.exchange.fetchOHLCV(normalized, timeframe, since, safeLimit, params);
      return rows.map((row) => {
        const [timestamp, open, high, low, close, volume] = row;
        if (typeof timestamp !== "number" || typeof open !== "number" || typeof high !== "number" || typeof low !== "number" || typeof close !== "number" || typeof volume !== "number"
          || ![timestamp, open, high, low, close, volume].every(Number.isFinite)) throw new Error(`${this.id} returned an invalid OHLCV row.`);
        return { timestamp, open, high, low, close, volume };
      });
    });
  }

  async fetchSummary(symbol: string): Promise<MarketSummary> {
    const normalized = validSymbol(symbol);
    const ticker = await coalesceRequest(`${this.id}|ticker|${normalized}`, async () => {
      await this.exchange.loadMarkets();
      return this.exchange.fetchTicker(normalized);
    });
    /* Some venues (Kraken) return a ticker with no timestamp at all. Downstream
       quote-freshness checks reject a missing timestamp, which would make those
       venues unusable for paper fills. Fall back to the most recent trade time —
       an observed exchange value, not a locally invented clock — and leave it
       null if the venue cannot supply that either. */
    const timestamp = finiteOrNull(ticker.timestamp) ?? await this.recentTradeTimestamp(normalized);
    return { symbol: normalized, last: finiteOrNull(ticker.last), changePct24h: finiteOrNull(ticker.percentage), high24h: finiteOrNull(ticker.high), low24h: finiteOrNull(ticker.low), quoteVolume24h: finiteOrNull(ticker.quoteVolume), bid: finiteOrNull(ticker.bid), ask: finiteOrNull(ticker.ask), timestamp };
  }

  /** Timestamp of the newest reported trade, or null when unavailable. */
  private async recentTradeTimestamp(symbol: string): Promise<number | null> {
    try {
      const trades = await coalesceRequest(`${this.id}|lasttrade|${symbol}`, () => this.exchange.fetchTrades(symbol, undefined, 1));
      const newest = trades.at(-1);
      return newest ? finiteOrNull(newest.timestamp) : null;
    } catch {
      return null;
    }
  }

  async fetchSummaries(symbols: readonly string[]): Promise<MarketSummary[]> {
    const normalized = [...new Set(symbols.map(validSymbol))].slice(0, 40);
    if (normalized.length === 0) return [];
    await this.exchange.loadMarkets();
    if (!this.exchange.has.fetchTickers) return Promise.all(normalized.map((symbol) => this.fetchSummary(symbol)));
    const tickers = await this.exchange.fetchTickers(normalized);
    return normalized.flatMap((symbol) => {
      const ticker = tickers[symbol];
      return ticker ? [{ symbol, last: finiteOrNull(ticker.last), changePct24h: finiteOrNull(ticker.percentage), high24h: finiteOrNull(ticker.high), low24h: finiteOrNull(ticker.low), quoteVolume24h: finiteOrNull(ticker.quoteVolume), bid: finiteOrNull(ticker.bid), ask: finiteOrNull(ticker.ask), timestamp: finiteOrNull(ticker.timestamp) }] : [];
    });
  }

  async fetchOrderBook(symbol: string, limit = 20): Promise<OrderBookSnapshot> {
    const normalized = validSymbol(symbol);
    await this.exchange.loadMarkets();
    const book: CcxtOrderBook = await this.exchange.fetchOrderBook(normalized, Math.max(5, Math.min(100, limit)));
    return { symbol: normalized, timestamp: finiteOrNull(book.timestamp), bids: book.bids.map(([price, amount]) => ({ price: price ?? 0, amount: amount ?? 0 })), asks: book.asks.map(([price, amount]) => ({ price: price ?? 0, amount: amount ?? 0 })) };
  }

  async fetchRecentTrades(symbol: string, limit = 20): Promise<RecentTrade[]> {
    const normalized = validSymbol(symbol);
    await this.exchange.loadMarkets();
    const trades = await this.exchange.fetchTrades(normalized, undefined, Math.max(5, Math.min(100, limit)));
    return trades.flatMap((trade: CcxtTrade) => {
      if (typeof trade.timestamp !== "number" || typeof trade.price !== "number" || typeof trade.amount !== "number" || ![trade.timestamp, trade.price, trade.amount].every(Number.isFinite)) return [];
      return [{ id: typeof trade.id === "string" ? trade.id : `${trade.timestamp}-${trade.price}-${trade.amount}`, timestamp: trade.timestamp, side: trade.side === "buy" || trade.side === "sell" ? trade.side : "unknown", price: trade.price, amount: trade.amount }];
    });
  }

  async close(): Promise<void> { await this.exchange.close(); }
}

export class BinanceSpotAdapter extends CcxtSpotAdapter {
  constructor() { super("binance"); }
}

const adapters = new Map<ExchangeId, CcxtSpotAdapter>();
export function getExchangeAdapter(id: ExchangeId = "binance"): CcxtSpotAdapter {
  let adapter = adapters.get(id);
  if (!adapter) {
    adapter = id === "binance" ? new BinanceSpotAdapter() : new CcxtSpotAdapter(id);
    adapters.set(id, adapter);
  }
  return adapter;
}
export function getBinanceAdapter(): BinanceSpotAdapter { return getExchangeAdapter("binance") as BinanceSpotAdapter; }

export { findCandleGaps, mergeCandles, reconnectDelayMs, removeFormingCandles, timeframeMilliseconds } from "./utils.js";
