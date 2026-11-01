import type { Candle, Timeframe } from "@newbeing/core";

export function timeframeMilliseconds(timeframe: Timeframe): number {
  const match = /^(\d+)(m|h|d)$/.exec(timeframe);
  if (!match) throw new Error(`Unsupported timeframe: ${timeframe}`);
  const amount = Number(match[1]);
  const unit = match[2];
  const multiplier = unit === "m" ? 60_000 : unit === "h" ? 3_600_000 : 86_400_000;
  return amount * multiplier;
}

function isCandleCompletedBy(candle: Candle, interval: number, cutoff: number): boolean {
  return candle.timestamp + interval <= cutoff;
}

/** Latest N completed fixed-duration UTC bars: [floor(now / d) * d - N*d, floor(now / d) * d). */
export function recentCompletedWindow(timeframe: Timeframe, limit: number, now = Date.now()): { since: number; through: number } {
  if (!Number.isSafeInteger(limit) || limit < 1 || !Number.isSafeInteger(now) || now < 0) throw new Error("Invalid candle window.");
  const interval = timeframeMilliseconds(timeframe);
  const through = Math.floor(now / interval) * interval;
  return { since: Math.max(0, through - limit * interval), through };
}

export function removeFormingCandles(candles: readonly Candle[], timeframe: Timeframe, now = Date.now()): Candle[] {
  const interval = timeframeMilliseconds(timeframe);
  return candles.filter((candle) => isCandleCompletedBy(candle, interval, now));
}

export function completedBarsThrough(candles: readonly Candle[], timeframe: Timeframe, endAt: number, now = Date.now()): Candle[] {
  const interval = timeframeMilliseconds(timeframe);
  const cutoff = Math.min(endAt, now);
  return candles.filter((candle) => isCandleCompletedBy(candle, interval, cutoff)).sort((a, b) => a.timestamp - b.timestamp);
}

export function nextCompletedBarAfter(candles: readonly Candle[], timeframe: Timeframe, cursor: number, now = Date.now()): Candle | null {
  const interval = timeframeMilliseconds(timeframe);
  let next: Candle | null = null;
  for (const candle of candles) {
    if (!(candle.timestamp > cursor && isCandleCompletedBy(candle, interval, now))) continue;
    if (!next || candle.timestamp < next.timestamp) next = candle;
  }
  return next;
}

export function mergeCandles(existing: readonly Candle[], incoming: readonly Candle[]): Candle[] {
  const byTimestamp = new Map<number, Candle>();
  for (const candle of existing) byTimestamp.set(candle.timestamp, candle);
  for (const candle of incoming) byTimestamp.set(candle.timestamp, candle);
  return [...byTimestamp.values()].sort((a, b) => a.timestamp - b.timestamp);
}

export function findCandleGaps(candles: readonly Candle[], timeframe: Timeframe): Array<{ from: number; to: number }> {
  const interval = timeframeMilliseconds(timeframe);
  const gaps: Array<{ from: number; to: number }> = [];
  for (let index = 1; index < candles.length; index += 1) {
    const previous = candles[index - 1];
    const current = candles[index];
    if (!previous || !current) continue;
    const gap = current.timestamp - previous.timestamp;
    if (gap > interval) gaps.push({ from: previous.timestamp + interval, to: current.timestamp - interval });
  }
  return gaps;
}

export function reconnectDelayMs(attempt: number): number {
  const exponent = Math.max(0, Math.min(10, Math.floor(attempt)));
  return Math.min(30_000, 500 * 2 ** exponent);
}
