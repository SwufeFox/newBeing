import type { Candle, Timeframe } from "@newbeing/core";
import type { ExchangeAdapter } from "./types.js";
import { recentCompletedWindow, timeframeMilliseconds } from "./utils.js";

/** Exact latest completed UTC window, pinned before the first asynchronous read. */
export async function fetchLatestCompletedCandles(adapter: ExchangeAdapter, symbol: string, timeframe: Timeframe, limit: number, now = Date.now()): Promise<Candle[]> {
  const { since, through } = recentCompletedWindow(timeframe, limit, now);
  const interval = timeframeMilliseconds(timeframe);
  const bars = new Map<number, Candle>();
  let cursor = since;
  while (cursor < through) {
    const page = await adapter.fetchOHLCVSince(symbol, timeframe, cursor, Math.min(1000, Math.ceil((through - cursor) / interval) + 1));
    let newest = cursor - interval;
    for (const candle of page) {
      if (candle.timestamp < since || candle.timestamp >= through) continue;
      if (!Number.isSafeInteger(candle.timestamp) || candle.timestamp % interval !== 0) throw new Error("Misaligned completed candle.");
      const previous = bars.get(candle.timestamp);
      if (previous && ["open", "high", "low", "close", "volume"].some((key) => previous[key as keyof Candle] !== candle[key as keyof Candle])) throw new Error("Conflicting completed candles.");
      bars.set(candle.timestamp, candle);
      newest = Math.max(newest, candle.timestamp);
    }
    if (newest < cursor) break;
    cursor = newest + interval;
  }
  const result = [...bars.values()].sort((a, b) => a.timestamp - b.timestamp);
  if (result.length !== limit || result.some((bar, index) => bar.timestamp !== since + index * interval)) throw new Error(`Expected exactly ${limit} latest completed bars; received ${result.length}. History or cache is insufficient or contains gaps.`);
  return result;
}
