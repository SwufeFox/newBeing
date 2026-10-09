import { describe, expect, it } from "vitest";
import { runBacktest, strategySignals, type Candle, type StrategyDefinition } from "../src/index.js";

function candle(timestamp: number, open: number, high: number, low: number, close: number): Candle {
  return { timestamp, open, high, low, close, volume: 10 };
}

const alwaysLongFromFirst: StrategyDefinition = {
  id: "test-long",
  name: "Test Long",
  version: "1",
  description: "Deterministic fixture.",
  defaults: {},
  signalAt(candles, index) {
    return index >= 0 && (candles[index]?.close ?? 0) > 100 ? "long" : "flat";
  },
};

const config = { initialCapital: 1_000, positionFraction: 1, feeRate: 0, slippageRate: 0, allowShorts: false };

describe("event-driven backtest", () => {
  it("fills a close-generated signal at the next bar open, never at the same close", () => {
    const result = runBacktest({
      candles: [candle(0, 100, 112, 99, 110), candle(60_000, 120, 132, 118, 130)],
      symbol: "BTC/USDT",
      timeframe: "1m",
      datasetId: "dataset-a",
      strategy: alwaysLongFromFirst,
      parameters: {},
      config,
      resultId: "result-a",
      createdAt: "2026-01-01T00:00:00.000Z",
    });
    expect(result.trades).toHaveLength(1);
    expect(result.trades[0]?.entryTime).toBe(60_000);
    expect(result.trades[0]?.entryPrice).toBe(120);
    expect(result.trades[0]?.exitReason).toBe("end-of-data");
    expect(result.trades[0]?.netPnl).toBeCloseTo(1_000 * (130 / 120 - 1));
  });

  it("uses stop-first when both stop and target are inside one OHLC bar", () => {
    const result = runBacktest({
      candles: [candle(0, 100, 101, 99, 101), candle(60_000, 100, 120, 80, 100)],
      symbol: "BTC/USDT",
      timeframe: "1m",
      datasetId: "dataset-b",
      strategy: alwaysLongFromFirst,
      parameters: {},
      config: { ...config, stopLossPct: 0.05, takeProfitPct: 0.1 },
      resultId: "result-b",
    });
    expect(result.trades[0]?.exitReason).toBe("stop-loss");
    expect(result.trades[0]?.exitPrice).toBe(95);
  });

  it("charges both-side fees and adverse slippage", () => {
    const result = runBacktest({
      candles: [candle(0, 100, 112, 99, 110), candle(60_000, 120, 132, 118, 130)],
      symbol: "BTC/USDT",
      timeframe: "1m",
      datasetId: "dataset-c",
      strategy: alwaysLongFromFirst,
      parameters: {},
      config: { ...config, feeRate: 0.001, slippageRate: 0.002 },
      resultId: "result-c",
    });
    expect(result.metrics.totalFees).toBeGreaterThan(0);
    expect(result.trades[0]?.entryPrice).toBeGreaterThan(120);
    expect(result.trades[0]?.exitPrice).toBeLessThan(130);
    expect(result.trades[0]?.netPnl).toBeLessThan(1_000 * (130 / 120 - 1));
  });

  it("rejects duplicate/out-of-order bars and invalid OHLC ranges", () => {
    const base = {
      symbol: "BTC/USDT",
      timeframe: "1m" as const,
      datasetId: "dataset-d",
      strategy: alwaysLongFromFirst,
      parameters: {},
      config,
      resultId: "result-d",
    };
    expect(() => runBacktest({ ...base, candles: [candle(1, 10, 11, 9, 10), candle(1, 10, 11, 9, 10)] })).toThrow(/increasing/);
    expect(() => runBacktest({ ...base, candles: [candle(1, 10, 9, 8, 10), candle(2, 10, 11, 9, 10)] })).toThrow(/OHLC/);
  });

  it("keeps signals and earlier fills invariant when only future bars change", () => {
    const candles = Array.from({ length: 80 }, (_, index) => {
      const close = 100 + Math.sin(index / 5) * 10 + index * 0.05;
      return candle(index * 60_000, close, close + 1, close - 1, close);
    });
    const changedFuture = candles.map((bar, index) => index < 45 ? bar : { ...bar, close: bar.close * 10, high: bar.high * 10, low: bar.low * 10, open: bar.open * 10 });
    const first = strategySignals(alwaysLongFromFirst, candles, {});
    const second = strategySignals(alwaysLongFromFirst, changedFuture, {});
    expect(second.slice(0, 45)).toEqual(first.slice(0, 45));
  });

  it("is repeatable for identical inputs when run metadata is pinned", () => {
    const input = {
      candles: [candle(0, 100, 112, 99, 110), candle(60_000, 120, 132, 118, 130)],
      symbol: "BTC/USDT",
      timeframe: "1m" as const,
      datasetId: "dataset-repeatable",
      strategy: alwaysLongFromFirst,
      parameters: {},
      config,
      resultId: "repeatable-id",
      createdAt: "2026-01-01T00:00:00.000Z",
    };
    expect(runBacktest(input)).toEqual(runBacktest(input));
  });
});
