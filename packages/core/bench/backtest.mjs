import { performance } from "node:perf_hooks";
import { getStrategy, runBacktest, strategySignalSides } from "../dist/index.js";

function integerSetting(name, fallback, minimum) {
  const value = Number(process.env[name] ?? fallback);
  if (!Number.isInteger(value) || value < minimum) {
    throw new Error(`${name} must be an integer >= ${minimum}.`);
  }
  return value;
}

const sizes = (process.env.BENCH_SIZES ?? "1000,10000,100000")
  .split(",")
  .map((value) => Number(value.trim()));
if (sizes.length === 0 || sizes.some((value) => !Number.isInteger(value) || value <= 0)) {
  throw new Error("BENCH_SIZES must be a comma-separated list of positive integers.");
}

const warmups = integerSetting("BENCH_WARMUPS", 2, 0);
const repetitions = integerSetting("BENCH_REPEATS", 5, 1);
const positionFraction = Number(process.env.BENCH_POSITION_FRACTION ?? 0.1);
if (!Number.isFinite(positionFraction) || positionFraction <= 0 || positionFraction > 1) {
  throw new Error("BENCH_POSITION_FRACTION must be in (0, 1].");
}
const feeRate = 0.001;
const slippageRate = 0.0005;
const initialCapital = 10_000;
const cases = [
  ["sma-crossover", { fastPeriod: 20, slowPeriod: 50, allowShorts: false }],
  ["rsi-mean-reversion", { period: 14, oversold: 30, exitLong: 50, overbought: 70, exitShort: 50, allowShorts: false }],
  ["momentum-reversal", { lookback: 20, thresholdPct: 2, reversal: false, allowShorts: false }],
];
const mb = (bytes) => Number((bytes / 1_048_576).toFixed(2));

function median(values) {
  const ordered = [...values].sort((a, b) => a - b);
  const middle = Math.floor(ordered.length / 2);
  return ordered.length % 2 === 0
    ? (ordered[middle - 1] + ordered[middle]) / 2
    : ordered[middle];
}

for (const size of sizes) {
  const candles = Array.from({ length: size }, (_, index) => {
    const close = 100 + Math.sin(index / 29) * 7 + Math.sin(index / 7) * 2;
    return { timestamp: index * 60_000, open: close, high: close + 1, low: close - 1, close, volume: 10 };
  });

  for (const [strategyId, parameters] of cases) {
    const elapsedSamples = [];
    const heapDeltaSamples = [];
    let finalResult;
    for (let iteration = 0; iteration < warmups + repetitions; iteration++) {
      if (typeof globalThis.gc === "function") globalThis.gc();
      const before = process.memoryUsage();
      const started = performance.now();
      const result = runBacktest({
        candles,
        symbol: "BTC/USDT",
        timeframe: "1m",
        datasetId: "synthetic-bounded-sine-v1",
        strategy: getStrategy(strategyId),
        parameters,
        config: { initialCapital, positionFraction, feeRate, slippageRate, allowShorts: false },
        resultId: `${strategyId}-${size}-${iteration}`,
        createdAt: "2026-01-01T00:00:00.000Z",
      });
      const elapsedMs = performance.now() - started;
      const after = process.memoryUsage();
      if (iteration >= warmups) {
        elapsedSamples.push(elapsedMs);
        heapDeltaSamples.push(after.heapUsed - before.heapUsed);
      }
      finalResult = result;
    }

    const signalSamples = [];
    let finalSignal = "flat";
    for (let iteration = 0; iteration < warmups + repetitions; iteration++) {
      if (typeof globalThis.gc === "function") globalThis.gc();
      const started = performance.now();
      const signals = strategySignalSides(getStrategy(strategyId), candles, parameters);
      const elapsedMs = performance.now() - started;
      if (iteration >= warmups) signalSamples.push(elapsedMs);
      finalSignal = signals.at(-1) ?? "flat";
    }

    console.log(JSON.stringify({
      strategy: strategyId,
      bars: size,
      syntheticProfile: "bounded-sine-v1",
      initialCapital,
      positionFraction,
      feeRate,
      slippageRate,
      warmups,
      repetitions,
      elapsedMs: {
        median: Number(median(elapsedSamples).toFixed(2)),
        min: Number(Math.min(...elapsedSamples).toFixed(2)),
        max: Number(Math.max(...elapsedSamples).toFixed(2)),
      },
      signalElapsedMs: {
        median: Number(median(signalSamples).toFixed(2)),
        min: Number(Math.min(...signalSamples).toFixed(2)),
        max: Number(Math.max(...signalSamples).toFixed(2)),
      },
      lastSignal: finalSignal,
      heapDeltaMedianMB: mb(median(heapDeltaSamples)),
      trades: finalResult.trades.length,
      finalEquity: finalResult.metrics.finalEquity,
    }));
  }
}
