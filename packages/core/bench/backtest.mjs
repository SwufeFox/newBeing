import { performance } from "node:perf_hooks";
import { getStrategy, runBacktest } from "../dist/index.js";

const sizes = (process.env.BENCH_SIZES ?? "1000,10000,100000")
  .split(",")
  .map((value) => Number(value.trim()))
  .filter((value) => Number.isInteger(value) && value > 0);
const cases = [
  ["sma-crossover", { fastPeriod: 20, slowPeriod: 50, allowShorts: false }],
  ["rsi-mean-reversion", { period: 14, oversold: 30, exitLong: 50, overbought: 70, exitShort: 50, allowShorts: false }],
  ["momentum-reversal", { lookback: 20, thresholdPct: 2, reversal: false, allowShorts: false }],
];
const mb = (bytes) => Number((bytes / 1_048_576).toFixed(2));

for (const size of sizes) {
  const candles = Array.from({ length: size }, (_, index) => {
    const close = 100 + Math.sin(index / 29) * 7 + Math.sin(index / 7) * 2 + index * 0.0001;
    return { timestamp: index * 60_000, open: close, high: close + 1, low: close - 1, close, volume: 10 };
  });
  for (const [strategyId, parameters] of cases) {
    if (typeof globalThis.gc === "function") globalThis.gc();
    const before = process.memoryUsage();
    const started = performance.now();
    const result = runBacktest({
      candles,
      symbol: "BTC/USDT",
      timeframe: "1m",
      datasetId: "synthetic-wave-v1",
      strategy: getStrategy(strategyId),
      parameters,
      config: { initialCapital: 10_000, positionFraction: 1, feeRate: 0.001, slippageRate: 0.0005, allowShorts: false },
      resultId: `${strategyId}-${size}`,
      createdAt: "2026-01-01T00:00:00.000Z",
    });
    const elapsedMs = Number((performance.now() - started).toFixed(2));
    const after = process.memoryUsage();
    const maxRss = process.resourceUsage().maxRSS;
    console.log(JSON.stringify({
      strategy: strategyId,
      bars: size,
      elapsedMs,
      heapUsedBeforeMB: mb(before.heapUsed),
      heapUsedAfterMB: mb(after.heapUsed),
      rssBeforeMB: mb(before.rss),
      rssAfterMB: mb(after.rss),
      processMaxRssMB: mb(maxRss * 1024),
      trades: result.trades.length,
    }));
  }
}
