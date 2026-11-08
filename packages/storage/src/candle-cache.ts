import { and, asc, eq, gte, lte, lt, sql } from "drizzle-orm";
import type { Candle, ExchangeId, Timeframe } from "@newbeing/core";
import { getDatabase } from "./db.js";
import { candleCache } from "./schema.js";

export const INTERVALS: Record<Timeframe, number> = { "1m": 60000, "5m": 300000, "15m": 900000, "30m": 1800000, "1h": 3600000, "4h": 14400000, "1d": 86400000 };

const CANDLE_CACHE_TTL_MS = 30 * 24 * 60 * 60 * 1000;

export function saveCachedCandles(exchange: ExchangeId, symbol: string, timeframe: Timeframe, candles: readonly Candle[]): void {
  const now = Date.now();
  /* A forming candle is filtered out below, so a poll made entirely of the
     current bar would otherwise open a transaction just to run TTL cleanup. */
  const settled = candles.filter((candle) => candle.timestamp + INTERVALS[timeframe] <= now);
  if (settled.length === 0) return;
  const db = getDatabase();
  db.transaction((tx) => {
    for (const candle of settled) {
      tx.insert(candleCache).values({ exchange, symbol, timeframe, ...candle, cachedAt: now })
        .onConflictDoUpdate({
          target: [candleCache.exchange, candleCache.symbol, candleCache.timeframe, candleCache.timestamp],
          set: { open: candle.open, high: candle.high, low: candle.low, close: candle.close, volume: candle.volume, cachedAt: now },
        }).run();
    }
    tx.delete(candleCache).where(lt(candleCache.cachedAt, now - CANDLE_CACHE_TTL_MS)).run();
  });
}

export function getCachedCandles(exchange: ExchangeId, symbol: string, timeframe: Timeframe, since: number, limit: number, through = Number.MAX_SAFE_INTEGER): { candles: Candle[]; cachedAt: number | null } {
  const rows = getDatabase().select().from(candleCache).where(and(
    eq(candleCache.exchange, exchange), eq(candleCache.symbol, symbol), eq(candleCache.timeframe, timeframe),
    sql`${candleCache.cachedAt} >= ${candleCache.timestamp} + ${INTERVALS[timeframe]}`,
    lte(candleCache.timestamp, Date.now() - INTERVALS[timeframe]),
    gte(candleCache.timestamp, since), lte(candleCache.timestamp, through), gte(candleCache.cachedAt, Date.now() - CANDLE_CACHE_TTL_MS),
  )).orderBy(asc(candleCache.timestamp)).limit(limit).all();
  const candles: Candle[] = [];
  let cachedAt = Number.POSITIVE_INFINITY;
  for (const row of rows) {
    candles.push({ timestamp: row.timestamp, open: row.open, high: row.high, low: row.low, close: row.close, volume: row.volume });
    cachedAt = Math.min(cachedAt, row.cachedAt);
  }
  return { candles, cachedAt: rows.length ? cachedAt : null };
}
