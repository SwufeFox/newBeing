import { describe, expect, it } from "vitest";
import { completedBarsThrough, findCandleGaps, mergeCandles, nextCompletedBarAfter, reconnectDelayMs, removeFormingCandles } from "../src/index.js";
import type { Candle } from "@newbeing/core";

const candle = (timestamp: number, close: number): Candle => ({ timestamp, open: close, high: close, low: close, close, volume: 1 });

describe("market data normalization", () => {
  it("deduplicates websocket updates and uses the incoming value for the same bucket", () => {
    expect(mergeCandles([candle(0, 1), candle(60_000, 2)], [candle(60_000, 3), candle(120_000, 4)]))
      .toEqual([candle(0, 1), candle(60_000, 3), candle(120_000, 4)]);
  });

  it("detects missing timeframe buckets", () => {
    expect(findCandleGaps([candle(0, 1), candle(180_000, 2)], "1m"))
      .toEqual([{ from: 60_000, to: 120_000 }]);
  });

  it("drops the still-forming bar for reproducible research", () => {
    expect(removeFormingCandles([candle(0, 1), candle(60_000, 2)], "1m", 119_999)).toEqual([candle(0, 1)]);
  });

  it("returns only completed bars at or before the selected replay cutoff", () => {
    expect(completedBarsThrough([candle(0, 1), candle(60_000, 2), candle(120_000, 3)], "1m", 120_000, 500_000))
      .toEqual([candle(0, 1), candle(60_000, 2)]);
  });

  it("releases exactly one completed bar after the replay cursor", () => {
    const next = nextCompletedBarAfter([candle(60_000, 2), candle(120_000, 3), candle(180_000, 4)], "1m", 0, 300_000);
    expect(next).toEqual(candle(60_000, 2));
    expect(nextCompletedBarAfter([candle(60_000, 2)], "1m", 0, 119_999)).toBeNull();
  });

  it("uses bounded exponential reconnect backoff", () => {
    expect([0, 1, 2, 10, 99].map(reconnectDelayMs)).toEqual([500, 1_000, 2_000, 30_000, 30_000]);
  });
});
