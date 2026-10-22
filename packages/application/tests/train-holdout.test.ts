import { beforeEach, describe, expect, it, vi } from "vitest";

// Exercise current core source, without building or reading concurrently written dist artifacts.
vi.mock("@newbeing/core", async () => {
  const core = await import("../../core/src/index.js");
  return { ...core, runBacktest: vi.fn(core.runBacktest) };
});
import { runBacktest, type Candle } from "@newbeing/core";
import { runTrainHoldout, type TrainHoldoutInput } from "../src/train-holdout.js";
import { sweepValues } from "../src/sweep-values.js";

const start = 1_700_000_040_000;
function bars(prices: number[]): readonly Readonly<Candle>[] {
  return Object.freeze(prices.map((price, index) => Object.freeze({ timestamp: start + index * 60_000, open: price, high: price + 1, low: price - 1, close: price, volume: 10 })));
}
function input(): TrainHoldoutInput {
  return {
    candles: bars(Array.from({ length: 24 }, (_, i) => 100 + i * 10)), datasetId: "immutable-caller-snapshot",
    exchange: "binance", symbol: "BTC/USDT", timeframe: "1m", strategyId: "momentum-reversal",
    candidates: Object.freeze([Object.freeze({ lookback: 2, thresholdPct: 1 }), Object.freeze({ lookback: 2, thresholdPct: 50 })]),
    config: Object.freeze({ accountMode: "spot", initialCapital: 1000, positionFraction: 0.8, feeRate: 0.001, slippageRate: 0.002, allowShorts: false }), splitIndex: 12,
  };
}
const calls = vi.mocked(runBacktest);
beforeEach(() => { calls.mockClear(); });

describe("single train/holdout evaluation", () => {
  it("selects solely on training and evaluates exactly one holdout after all training runs", () => {
    const request = input();
    const first = runTrainHoldout(request);
    expect(first.selectedParameters.thresholdPct).toBe(1);
    expect(first.training[0]!.result.metrics.totalReturn).toBeGreaterThan(first.training[1]!.result.metrics.totalReturn);
    expect(calls).toHaveBeenCalledTimes(3);
    expect(calls.mock.calls.map(([call]) => call.candles[0]!.timestamp)).toEqual([start, start, start + 12 * 60_000]);
    const changed = runTrainHoldout({ ...request, candles: bars(Array.from({ length: 24 }, (_, i) => i < 12 ? 100 + i * 10 : 1000 - (i - 12) * 50)) });
    expect(changed.selectedParameters).toEqual(first.selectedParameters);
    expect(changed.training.map((run) => run.result.metrics)).toEqual(first.training.map((run) => run.result.metrics));
    expect(changed.training.map((run) => run.result.signals)).toEqual(first.training.map((run) => run.result.signals));
    expect(changed.holdout.metrics).not.toEqual(first.holdout.metrics);
  });

  it("has disjoint exact boundaries, fresh cash and indicator state, and no pending train signal", () => {
    const request = input();
    const result = runTrainHoldout(request);
    expect(result.trainingBoundary).toEqual({ startIndex: 0, endIndexExclusive: 12, bars: 12, startTime: start, lastBarTime: start + 11 * 60_000, endTimeExclusive: start + 12 * 60_000 });
    expect(result.holdoutBoundary).toEqual({ startIndex: 12, endIndexExclusive: 24, bars: 12, startTime: start + 12 * 60_000, lastBarTime: start + 23 * 60_000, endTimeExclusive: start + 24 * 60_000 });
    expect(result.initialization).toBe("cold-start/no-carry-positions");
    expect(result.evaluation).toBe("single-holdout");
    expect(result.holdout.equityCurve[0]!.equity).toBe(request.config.initialCapital);
    expect(result.holdout.signals.slice(0, 2).map((signal) => signal.side)).toEqual(["flat", "flat"]);
    expect(result.holdout.trades[0]!.entryTime).toBe(start + 15 * 60_000);
    for (const run of result.training) {
      expect(run.result.signals.every((signal) => signal.timestamp < result.holdoutBoundary.startTime)).toBe(true);
      expect(run.result.trades.every((trade) => trade.exitTime < result.holdoutBoundary.startTime)).toBe(true);
    }
    expect(result.holdout.signals.every((signal) => signal.timestamp >= result.holdoutBoundary.startTime)).toBe(true);
    expect(result.holdout.trades.every((trade) => trade.entryTime > result.holdoutBoundary.startTime)).toBe(true);
    expect(result.training[0]!.result.trades.at(-1)!.exitReason).toBe("end-of-data");
    const direct = runBacktest({ ...calls.mock.calls[2]![0], candles: request.candles.slice(12), resultId: result.holdout.resultId, createdAt: result.holdout.createdAt });
    expect(result.holdout).toEqual(direct);
  });

  it("preserves prefix signals when future bars inside a segment change", () => {
    const request = input();
    const first = runTrainHoldout(request);
    const changedPrices = Array.from({ length: 24 }, (_, i) => i < 8 ? 100 + i * 10 : 500 - i * 5);
    const changed = runTrainHoldout({ ...request, candles: bars(changedPrices) });
    for (let i = 0; i < 2; i += 1) {
      expect(changed.training[i]!.result.signals.slice(0, 8)).toEqual(first.training[i]!.result.signals.slice(0, 8));
      expect(changed.training[i]!.result.equityCurve.slice(0, 8)).toEqual(first.training[i]!.result.equityCurve.slice(0, 8));
    }
  });

  it("passes all costs/protection settings to real spot core on both partitions", () => {
    const request = input();
    const config = { ...request.config, stopLossPct: 0.2, takeProfitPct: 0.5 };
    const result = runTrainHoldout({ ...request, config });
    for (const [call] of calls.mock.calls) expect(call.config).toEqual(config);
    for (const run of [result.training[0]!.result, result.holdout]) {
      expect(run.assumptions).toEqual(config);
      expect(run.executionPolicy).toBeDefined();
      expect(run.metrics.totalFees).toBeGreaterThan(0);
      expect(run.trades[0]!.entryPrice).toBeCloseTo(request.candles.find((bar) => bar.timestamp === run.trades[0]!.entryTime)!.open * 1.002, 8);
      expect(run.trades.every((trade) => trade.side === "long")).toBe(true);
    }
    const free = runTrainHoldout({ ...request, config: { ...config, feeRate: 0, slippageRate: 0 } });
    expect(free.holdout.metrics.totalFees).toBe(0);
    expect(result.holdout.metrics.finalEquity).toBeLessThan(free.holdout.metrics.finalEquity);
    expect(result.training[0]!.result.metrics.finalEquity).toBeLessThan(free.training[0]!.result.metrics.finalEquity);
  });

  it("breaks exact ties by canonical resolved parameters independent of candidate/key order", () => {
    const request = input();
    const candidates = [{ thresholdPct: 80, lookback: 2 }, { lookback: 2, thresholdPct: 70 }];
    const first = runTrainHoldout({ ...request, candidates });
    const reverse = runTrainHoldout({ ...request, candidates: [...candidates].reverse() });
    expect(first.training.map((run) => run.result.metrics.totalReturn)).toEqual([0, 0]);
    expect(first.selectedParameters).toEqual(reverse.selectedParameters);
    expect(first.selectedParameters.thresholdPct).toBe(70);
    expect(first.selectedCandidateIndex).toBe(1);
    expect(reverse.selectedCandidateIndex).toBe(0);
  });

  it("accepts 1 and 40 candidates, exact decimal sweeps, and a minimum 2/2 split", () => {
    const request = input();
    const candidates = sweepValues(0.05, 3.95, 0.1).map((thresholdPct) => ({ thresholdPct, lookback: 2 }));
    expect(candidates).toHaveLength(40);
    expect(runTrainHoldout({ ...request, candidates }).training).toHaveLength(40);
    const small = runTrainHoldout({ ...request, candles: request.candles.slice(0, 4), splitIndex: 2, candidates: [request.candidates[0]!] });
    expect(small.training).toHaveLength(1);
    expect(small.holdout.equityCurve).toHaveLength(2);
  });

  const invalid: Array<[string, (request: TrainHoldoutInput) => TrainHoldoutInput]> = [
    ["empty candidates", (r) => ({ ...r, candidates: [] })],
    ["41 candidates", (r) => ({ ...r, candidates: Array.from({ length: 41 }, (_, thresholdPct) => ({ thresholdPct })) })],
    ["duplicate defaults", (r) => ({ ...r, candidates: [{}, { lookback: 20 }] })],
    ["duplicate key order", (r) => ({ ...r, candidates: [{ lookback: 2, thresholdPct: 1 }, { thresholdPct: 1, lookback: 2 }] })],
    ["unknown parameter", (r) => ({ ...r, candidates: [{ arbitraryCode: 1 }] })],
    ["wrong parameter type", (r) => ({ ...r, candidates: [{ lookback: true }] })],
    ["NaN parameter", (r) => ({ ...r, candidates: [{ thresholdPct: NaN }] })],
    ["clamped period", (r) => ({ ...r, candidates: [{ lookback: 1 }] })],
    ["fractional period", (r) => ({ ...r, candidates: [{ lookback: 2.5 }] })],
    ["negative threshold", (r) => ({ ...r, candidates: [{ thresholdPct: -1 }] })],
    ["candidate shorts", (r) => ({ ...r, candidates: [{ allowShorts: true }] })],
    ["unknown strategy", (r) => ({ ...r, strategyId: "eval(code)" })],
    ["unsupported exchange", (r) => ({ ...r, exchange: "unknown" as TrainHoldoutInput["exchange"] })],
    ["unsupported venue timeframe", (r) => ({ ...r, exchange: "coinbaseexchange", timeframe: "4h" })],
    ["derivative symbol", (r) => ({ ...r, symbol: "BTC/USDT:USDT" })],
    ["missing snapshot", (r) => ({ ...r, datasetId: " " })],
    ["legacy margin", (r) => ({ ...r, config: { ...r.config, accountMode: "legacy-margin" } })],
    ["config shorts", (r) => ({ ...r, config: { ...r.config, allowShorts: true } })],
    ...[-1, 0, 1, 23, 24, 25, 2.5, NaN, Infinity].map((splitIndex): [string, (r: TrainHoldoutInput) => TrainHoldoutInput] => [`split ${splitIndex}`, (r) => ({ ...r, splitIndex })]),
    ["out of order", (r) => ({ ...r, candles: [r.candles[1]!, r.candles[0]!, ...r.candles.slice(2)] })],
    ["duplicate timestamp", (r) => ({ ...r, candles: [r.candles[0]!, r.candles[0]!, ...r.candles.slice(2)] })],
    ["gap inside train", (r) => ({ ...r, candles: r.candles.filter((_, i) => i !== 5) })],
    ["gap at split", (r) => ({ ...r, candles: r.candles.filter((_, i) => i !== 12) })],
    ["gap inside holdout", (r) => ({ ...r, candles: r.candles.filter((_, i) => i !== 20) })],
    ["unaligned time", (r) => ({ ...r, candles: r.candles.map((bar) => ({ ...bar, timestamp: bar.timestamp + 1 })) })],
    ["invalid holdout OHLC", (r) => ({ ...r, candles: r.candles.map((bar, i) => i === 20 ? { ...bar, high: 1 } : bar) })],
    ["nonfinite volume", (r) => ({ ...r, candles: r.candles.map((bar, i) => i === 20 ? { ...bar, volume: Infinity } : bar) })],
    ["invalid SMA periods", (r) => ({ ...r, strategyId: "sma-crossover", candidates: [{ fastPeriod: 5, slowPeriod: 3 }] })],
    ["clamped RSI levels", (r) => ({ ...r, strategyId: "rsi-mean-reversion", candidates: [{ oversold: 0 }] })],
  ];
  it.each(invalid)("rejects %s before any core run", (_, change) => {
    expect(() => runTrainHoldout(change(input()))).toThrow();
    expect(calls).not.toHaveBeenCalled();
  });

  it.each([
    { initialCapital: 0 }, { initialCapital: 1000.000000001 }, { feeRate: 0.051 }, { feeRate: NaN },
    { slippageRate: -0.1 }, { positionFraction: 0 }, { stopLossPct: 1 }, { takeProfitPct: 10 },
  ])("propagates core config validation %j without running holdout", (config) => {
    const request = input();
    expect(() => runTrainHoldout({ ...request, config: { ...request.config, ...config } })).toThrow();
    expect(calls).toHaveBeenCalledTimes(1);
    expect(calls.mock.calls[0]![0].candles).toHaveLength(12);
  });
});
