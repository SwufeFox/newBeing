import type { BacktestResult } from "@newbeing/core";

const INTERVALS = { "1m": 60_000, "5m": 300_000, "15m": 900_000, "30m": 1_800_000, "1h": 3_600_000, "4h": 14_400_000, "1d": 86_400_000 };

export function backtestReplayRequest(backtest: BacktestResult) {
  if (!/^sha256:[a-f0-9]{64}$/.test(backtest.datasetId)) {
    throw new Error("This legacy result has no canonical dataset snapshot. Run a new backtest before starting frozen Replay.");
  }
  const points = backtest.equityCurve;
  // The start API requires limit >= 50. Keep at least half the dataset hidden.
  if (points.length < 100) throw new Error("Frozen Replay needs at least 100 historical bars: 50 seed bars and 50 future practice bars.");
  const limit = Math.min(200, Math.floor(points.length / 2));
  const seed = points[limit - 1]!;
  const interval = INTERVALS[backtest.timeframe];
  if (points.some((point, index) => !Number.isFinite(point.timestamp) || (index > 0 && point.timestamp - points[index - 1]!.timestamp !== interval))) {
    throw new Error("Frozen Replay needs a continuous historical bar sequence.");
  }
  return {
    datasetId: backtest.datasetId, exchange: backtest.exchange, symbol: backtest.symbol, timeframe: backtest.timeframe,
    endAt: seed.timestamp + interval, limit,
    initialCapital: backtest.assumptions.initialCapital,
    feeRate: backtest.assumptions.feeRate,
    slippageRate: backtest.assumptions.slippageRate,
  };
}
