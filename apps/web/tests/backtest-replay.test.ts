import { describe, expect, it } from "vitest";
import type { BacktestResult, EquityPoint } from "@newbeing/core";
import { backtestReplayRequest } from "../src/lib/backtest-replay.js";

const INTERVAL = 60_000;
const DATASET = `sha256:${"a".repeat(64)}`;

function result(bars: number, overrides: Partial<BacktestResult> = {}): BacktestResult {
  const equityCurve: EquityPoint[] = Array.from({ length: bars }, (_, index) => ({
    timestamp: index * INTERVAL, equity: 10_000, price: 100, drawdown: 0,
  }));
  return {
    resultId: "result-1", datasetId: DATASET, exchange: "binance", symbol: "BTC/USDT",
    timeframe: "1m", strategyId: "sma-crossover", strategyVersion: "1", parameters: {},
    assumptions: { initialCapital: 10_000, positionFraction: 0.5, feeRate: 0.001, slippageRate: 0.0005, allowShorts: false, accountMode: "spot" },
    execution: {} as BacktestResult["execution"], engineVersion: "0.2.0", createdAt: "2026-10-22T00:00:00.000Z",
    metrics: {} as BacktestResult["metrics"], equityCurve, trades: [], signals: [],
    ...overrides,
  } as BacktestResult;
}

describe("backtest to frozen Replay handoff", () => {
  it("freezes on the result's own dataset and keeps practice bars ahead of the seed", () => {
    const body = backtestReplayRequest(result(600));
    expect(body.datasetId).toBe(DATASET);
    expect(body.limit).toBe(200);
    // Seed ends before the last scored bar, so bars remain to practise on.
    expect(body.endAt).toBe(200 * INTERVAL);
    expect(body.endAt).toBeLessThan(600 * INTERVAL);
  });

  it("carries the backtest cost assumptions into the session", () => {
    const body = backtestReplayRequest(result(200));
    expect(body.initialCapital).toBe(10_000);
    expect(body.feeRate).toBe(0.001);
    expect(body.slippageRate).toBe(0.0005);
    // Half the dataset is the most a seed may reveal.
    expect(body.limit).toBe(100);
    expect(body.endAt).toBe(100 * INTERVAL);
  });

  it("refuses a legacy result with no canonical snapshot instead of refetching history", () => {
    expect(() => backtestReplayRequest(result(600, { datasetId: "dataset-legacy" }))).toThrow(/canonical dataset snapshot/);
  });

  it("refuses a result too short to leave practice bars", () => {
    expect(() => backtestReplayRequest(result(99))).toThrow(/at least 100/);
  });

  it("refuses a discontinuous window rather than freezing a broken session", () => {
    const broken = result(600);
    broken.equityCurve[10] = { ...broken.equityCurve[10]!, timestamp: broken.equityCurve[10]!.timestamp + 1 };
    expect(() => backtestReplayRequest(broken)).toThrow(/continuous/);
  });
});
