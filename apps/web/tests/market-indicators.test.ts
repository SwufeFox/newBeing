import { describe, expect, it } from "vitest";
import type { Candle } from "@newbeing/core";
import { calculateSMA, calculateEMA, calculateBollingerBands, sanitizeCandlesForChart, floorToDecimals } from "../src/lib/indicators.js";

function makeCandles(closes: number[], startSec = 1700000000): Candle[] {
  return closes.map((close, i) => ({
    timestamp: (startSec + i * 60) * 1000,
    open: close,
    high: close + 1,
    low: close - 1,
    close,
    volume: 100,
  }));
}

describe("market indicator calculations and candle sanitization", () => {
  it("sanitizes candles by filtering out NaN/invalids and deduplicating by second", () => {
    const raw: Candle[] = [
      { timestamp: 1700000060000, open: 100, high: 105, low: 95, close: 102, volume: 10 },
      { timestamp: 1700000000000, open: 100, high: 105, low: 95, close: 101, volume: 10 },
      { timestamp: 1700000000500, open: 101, high: 106, low: 96, close: 103, volume: 10 }, // duplicate second
      { timestamp: 0, open: 100, high: 105, low: 95, close: 100, volume: 10 }, // invalid 0 timestamp
      { timestamp: 1700000120000, open: NaN, high: 105, low: 95, close: 100, volume: 10 }, // NaN open
    ];
    const sanitized = sanitizeCandlesForChart(raw);
    expect(sanitized).toHaveLength(2);
    expect(sanitized[0]!.timestamp).toBe(1700000000500);
    expect(sanitized[0]!.close).toBe(103); // kept latest within same second
    expect(sanitized[1]!.timestamp).toBe(1700000060000);
  });

  it("sanitizes non-finite and negative volume to 0", () => {
    const raw: Candle[] = [
      { timestamp: 1700000000000, open: 100, high: 105, low: 95, close: 100, volume: NaN },
      { timestamp: 1700000060000, open: 100, high: 105, low: 95, close: 100, volume: -50 },
      { timestamp: 1700000120000, open: 100, high: 105, low: 95, close: 100, volume: 250 },
    ];
    const sanitized = sanitizeCandlesForChart(raw);
    expect(sanitized).toHaveLength(3);
    expect(sanitized[0]!.volume).toBe(0);
    expect(sanitized[1]!.volume).toBe(0);
    expect(sanitized[2]!.volume).toBe(250);
  });

  it("handles empty or insufficient candles safely across all indicators", () => {
    expect(calculateSMA([], 20)).toEqual([]);
    expect(calculateEMA([], 20)).toEqual([]);
    expect(calculateBollingerBands([], 20)).toEqual({ upper: [], lower: [] });

    const twoBars = makeCandles([100, 105]);
    expect(calculateSMA(twoBars, 20)).toEqual([]);
    expect(calculateEMA(twoBars, 20)).toEqual([]);
    expect(calculateBollingerBands(twoBars, 20)).toEqual({ upper: [], lower: [] });
  });

  it("safely rejects non-finite or non-positive periods without throwing or division by zero", () => {
    const bars = makeCandles([10, 11, 12, 13, 14, 15]);
    expect(calculateSMA(bars, 0)).toEqual([]);
    expect(calculateSMA(bars, -5)).toEqual([]);
    expect(calculateSMA(bars, NaN)).toEqual([]);

    expect(calculateEMA(bars, 0)).toEqual([]);
    expect(calculateEMA(bars, -1)).toEqual([]);
    expect(calculateEMA(bars, NaN)).toEqual([]);

    expect(calculateBollingerBands(bars, 0)).toEqual({ upper: [], lower: [] });
    expect(calculateBollingerBands(bars, -10)).toEqual({ upper: [], lower: [] });
    expect(calculateBollingerBands(bars, NaN)).toEqual({ upper: [], lower: [] });
  });

  it("safely handles non-integer float periods by flooring without crashing or accessing undefined indices", () => {
    const bars = makeCandles([10, 20, 30, 40, 50]);
    // Period 3.5 should floor to 3
    const sma = calculateSMA(bars, 3.5);
    expect(sma).toHaveLength(3);
    expect(sma[0]!.value).toBe(20);

    const ema = calculateEMA(bars, 3.8);
    expect(ema).toHaveLength(3);
    expect(ema[0]!.value).toBe(20);

    const bb = calculateBollingerBands(bars, 3.2, 2);
    expect(bb.upper).toHaveLength(3);
    expect(bb.lower).toHaveLength(3);
  });

  it("preserves high precision for sub-cent crypto token prices", () => {
    const microBars = makeCandles([0.00001234, 0.00001236, 0.00001238]);
    const sma = calculateSMA(microBars, 2);
    expect(sma).toHaveLength(2);
    expect(sma[0]!.value).toBe(0.00001235);
    expect(sma[1]!.value).toBe(0.00001237);
  });

  it("calculates SMA correctly with valid ascending timestamps", () => {
    const bars = makeCandles([10, 20, 30, 40, 50]);
    const sma = calculateSMA(bars, 3);
    expect(sma).toHaveLength(3);
    expect(sma[0]!.value).toBe(20); // (10+20+30)/3
    expect(sma[1]!.value).toBe(30); // (20+30+40)/3
    expect(sma[2]!.value).toBe(40); // (30+40+50)/3
    expect(sma[0]!.time).toBeLessThan(sma[1]!.time);
  });

  it("calculates EMA correctly and values remain strictly finite", () => {
    const bars = makeCandles([10, 20, 30, 40, 50]);
    const ema = calculateEMA(bars, 3);
    expect(ema).toHaveLength(3);
    expect(ema[0]!.value).toBe(20);
    expect(Number.isFinite(ema[1]!.value)).toBe(true);
    expect(Number.isFinite(ema[2]!.value)).toBe(true);
  });

  it("calculates Bollinger Bands correctly with variance non-negativity guard", () => {
    const identicalBars = makeCandles([50, 50, 50, 50, 50]);
    const bb = calculateBollingerBands(identicalBars, 3, 2);
    expect(bb.upper).toHaveLength(3);
    expect(bb.lower).toHaveLength(3);
    // When all values are identical, stdDev = 0, upper = lower = mean = 50
    expect(bb.upper[0]!.value).toBe(50);
    expect(bb.lower[0]!.value).toBe(50);
  });

  describe("floorToDecimals", () => {
    it("floors without rounding up to prevent balance overruns", () => {
      expect(floorToDecimals(0.0001538, 4)).toBe(0.0001);
      expect(floorToDecimals(0.0001999, 4)).toBe(0.0001);
      expect(floorToDecimals(1.234567, 2)).toBe(1.23);
      expect(floorToDecimals(0, 4)).toBe(0);
      expect(floorToDecimals(-1, 4)).toBe(0);
      expect(floorToDecimals(NaN, 4)).toBe(0);
    });
  });
});
