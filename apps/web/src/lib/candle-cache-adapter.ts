import type { Candle, ExchangeId, Timeframe } from "@newbeing/core";
import { timeframeMilliseconds } from "@newbeing/market-data/utils";
import type { ExchangeAdapter } from "@newbeing/market-data";
import { getCachedCandles, saveCachedCandles } from "@newbeing/storage";

export interface CandleCacheMetadata {
  cached: boolean;
  cachedAt: string | null;
  fallback: boolean;
}

export interface CandleFetchResult {
  candles: Candle[];
  source: "live" | "local-cache";
  cache: CandleCacheMetadata;
}

/** Create one wrapper per request so provenance cannot leak across concurrent calls. */
export function createCandleCacheAdapter(exchange: ExchangeId, adapter: ExchangeAdapter) {
  let lastResult: CandleFetchResult | null = null;

  async function fetch(
    symbol: string,
    timeframe: Timeframe,
    since: number,
    limit: number,
    fetchOnline: () => Promise<Candle[]>,
    through = Number.MAX_SAFE_INTEGER,
  ): Promise<Candle[]> {
    let candles: Candle[];
    try {
      candles = (await fetchOnline()).filter((candle) => candle.timestamp >= since && (through === Number.MAX_SAFE_INTEGER || candle.timestamp + timeframeMilliseconds(timeframe) <= Math.min(through, Date.now()))).slice(0, limit);
    } catch (error) {
      const cached = getCachedCandles(exchange, symbol, timeframe, since, limit, Math.min(through, Date.now()) - timeframeMilliseconds(timeframe));
      if (cached.candles.length === 0) throw error;
      lastResult = {
        candles: cached.candles,
        source: "local-cache",
        cache: { cached: true, cachedAt: cached.cachedAt === null ? null : new Date(cached.cachedAt).toISOString(), fallback: true },
      };
      return cached.candles;
    }
    let cachedSuccessfully = true;
    try {
      saveCachedCandles(exchange, symbol, timeframe, candles.filter((candle) => candle.timestamp + timeframeMilliseconds(timeframe) <= Math.min(through, Date.now())));
    } catch {
      cachedSuccessfully = false;
    }
    lastResult = { candles, source: "live", cache: { cached: cachedSuccessfully, cachedAt: cachedSuccessfully ? new Date().toISOString() : null, fallback: false } };
    return candles;
  }

  return {
    adapter: {
      getInstrument: adapter.getInstrument?.bind(adapter),
      getConnectorMetadata: adapter.getConnectorMetadata?.bind(adapter),
      id: adapter.id,
      searchSymbols: adapter.searchSymbols.bind(adapter),
      fetchSummary: adapter.fetchSummary.bind(adapter),
      fetchSummaries: adapter.fetchSummaries.bind(adapter),
      fetchOrderBook: adapter.fetchOrderBook.bind(adapter),
      fetchRecentTrades: adapter.fetchRecentTrades.bind(adapter),
      close: adapter.close.bind(adapter),
      fetchOHLCV(symbol: string, timeframe: Timeframe, limit = 500) {
        const since = Date.now() - timeframeMilliseconds(timeframe) * limit;
        return fetch(symbol, timeframe, since, limit, () => adapter.fetchOHLCV(symbol, timeframe, limit));
      },
      fetchOHLCVSince(symbol: string, timeframe: Timeframe, since: number, limit = 500) {
        return fetch(symbol, timeframe, since, limit, () => adapter.fetchOHLCVSince(symbol, timeframe, since, limit));
      },
      fetchOHLCVSinceThrough(symbol: string, timeframe: Timeframe, since: number, limit: number, through: number) {
        return fetch(symbol, timeframe, since, limit, () => adapter.fetchOHLCVSince(symbol, timeframe, since, limit), through);
      },

    } as ExchangeAdapter & {
      fetchOHLCVSinceThrough(symbol: string, timeframe: Timeframe, since: number, limit: number, through: number): Promise<Candle[]>;
    },
    getLastResult(): CandleFetchResult | null {
      return lastResult;
    },
  };
}

