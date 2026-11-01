import { MAX_RESEARCH_BARS, type Candle, type Timeframe } from "@newbeing/core";
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

export const MAX_COMPLETED_CANDLE_RANGE_BARS = MAX_RESEARCH_BARS;

/** Fetches an exact UTC candle range [startAt, endAt), excluding forming/future bars. */
export async function fetchCompletedCandlesRange(adapter: ExchangeAdapter, symbol: string, timeframe: Timeframe, startAt: number, endAt?: number, now = Date.now()): Promise<Candle[]> {
  const interval = timeframeMilliseconds(timeframe);
  const latestThrough = Math.floor(now / interval) * interval;
  const through = endAt ?? latestThrough;
  if (!Number.isSafeInteger(startAt) || startAt < 0 || startAt % interval !== 0 || !Number.isSafeInteger(now) || now < 0) throw new Error("Historical candle start and clock must be aligned UTC millisecond values.");
  if (!Number.isSafeInteger(through) || through <= startAt || through % interval !== 0 || through > latestThrough) throw new Error("Historical candle end must be an aligned completed UTC boundary after startAt.");
  const expected = (through - startAt) / interval;
  if (!Number.isSafeInteger(expected) || expected < 1) throw new Error("Historical candle range is empty or invalid.");
  if (expected > MAX_COMPLETED_CANDLE_RANGE_BARS) throw new Error(`Historical candle range exceeds ${MAX_COMPLETED_CANDLE_RANGE_BARS} bars; choose a coarser timeframe or shorter range.`);

  const bars = new Map<number, Candle>();
  let cursor = startAt;
  while (cursor < through) {
    const remaining = Math.ceil((through - cursor) / interval);
    const page = await adapter.fetchOHLCVSince(symbol, timeframe, cursor, Math.min(1000, remaining + 1));
    let newest = cursor - interval;
    for (const candle of page) {
      if (candle.timestamp < startAt || candle.timestamp >= through) continue;
      if (!Number.isSafeInteger(candle.timestamp) || candle.timestamp < 0 || candle.timestamp % interval !== 0) throw new Error("Misaligned historical candle.");
      const previous = bars.get(candle.timestamp);
      if (previous && ["open", "high", "low", "close", "volume"].some((key) => previous[key as keyof Candle] !== candle[key as keyof Candle])) throw new Error("Conflicting historical candles.");
      bars.set(candle.timestamp, candle);
      newest = Math.max(newest, candle.timestamp);
    }
    if (newest < cursor) break;
    cursor = newest + interval;
  }

  const result = [...bars.values()].sort((a, b) => a.timestamp - b.timestamp);
  if (result.length !== expected || result.some((bar, index) => bar.timestamp !== startAt + index * interval)) throw new Error(`Expected exactly ${expected} completed candles in [${startAt}, ${through}); received ${result.length}. Exchange history is insufficient or contains gaps.`);
  return result;
}
