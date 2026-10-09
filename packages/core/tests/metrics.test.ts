import { describe, expect, it } from "vitest";
import { runBacktest } from "../src/backtest.js";
import type { Candle, StrategyDefinition } from "../src/types.js";

const candles: Candle[] = [
  { timestamp: 1_700_000_000_000, open: 100, high: 101, low: 99, close: 100, volume: 10 },
  { timestamp: 1_700_000_060_000, open: 100, high: 111, low: 99, close: 110, volume: 10 },
];

const alwaysLong: StrategyDefinition = {
  id: "metrics-test-long",
  name: "Metrics test long",
  version: "test",
  description: "Test-only fixed signal",
  defaults: {},
  signalAt: () => "long",
};

const baseInput = {
  candles,
  symbol: "BTC/USDT",
  timeframe: "1m" as const,
  datasetId: "metrics-fixture",
  strategy: alwaysLong,
  parameters: {},
  config: { initialCapital: 10_000, positionFraction: 0.5, feeRate: 0, slippageRate: 0, allowShorts: false },
  resultId: "metrics-test",
  createdAt: "2026-10-09T00:00:00.000Z",
};

describe("backtest metric and protective-level validation", () => {
  it("does not count the initial equity point as an artificial zero-period Sharpe return", () => {
    const result = runBacktest(baseInput);
    expect(result.equityCurve[0]?.equity).toBe(10_000);
    expect(result.equityCurve[1]?.equity).toBe(10_500);
    expect(result.metrics.sharpeRatio).toBeNull();
  });

  it("rejects non-positive short take-profit targets", () => {
    expect(() => runBacktest({
      ...baseInput,
      config: { ...baseInput.config, allowShorts: true, takeProfitPct: 1 },
    })).toThrow("Short take-profit percentage must be less than 1");
  });
});
