import { getStrategy, runBacktest, type BacktestConfig, type BacktestMetrics, type Candle, type ExchangeId, type StrategyParameters, type Timeframe } from "@newbeing/core";
import { findCandleGaps, getExchangeAdapter, removeFormingCandles, type ExchangeAdapter } from "@newbeing/market-data";
import { getWorkspaceState } from "@newbeing/storage";
import { randomUUID } from "node:crypto";

/** Hard ceiling on how many runs one sweep may perform. */
export const SWEEP_MAX_RUNS = 40;

export interface SweepRequest {
  exchange?: ExchangeId;
  symbol: string;
  timeframe: Timeframe;
  strategyId: string;
  /** Parameters held fixed for every run. The swept one is overridden per run. */
  parameters: StrategyParameters;
  config: BacktestConfig;
  /** The single parameter to vary. */
  parameter: string;
  from: number;
  to: number;
  step: number;
  limit?: number;
}

export interface SweepRun {
  value: number;
  metrics: BacktestMetrics;
}

export interface SweepResult {
  sweepId: string;
  exchange: ExchangeId;
  symbol: string;
  timeframe: Timeframe;
  strategyId: string;
  strategyVersion: string;
  parameter: string;
  /** The values actually run, in the order they were run. */
  values: number[];
  runs: SweepRun[];
  /** Fixed inputs, echoed so a result can be reproduced from it alone. */
  parameters: StrategyParameters;
  config: BacktestConfig;
  datasetId: string;
  bars: number;
  createdAt: string;
}

/** Enumerate from..to by step without ever producing a fractional mess. */
export function sweepValues(from: number, to: number, step: number): number[] {
  if (!Number.isFinite(from) || !Number.isFinite(to) || !Number.isFinite(step)) {
    throw new Error("Sweep range must be numbers.");
  }
  if (step <= 0) throw new Error("Sweep step must be greater than zero.");
  if (to < from) throw new Error("Sweep end must not be below its start.");
  const span = to - from;
  const count = Math.floor(span / step + 1e-9) + 1;
  if (count > SWEEP_MAX_RUNS) {
    throw new Error(`That range needs ${count} runs; the limit is ${SWEEP_MAX_RUNS}. Widen the step.`);
  }
  const values: number[] = [];
  for (let index = 0; index < count; index += 1) {
    // Round to kill floating-point drift (0.1 steps producing 0.30000000000004).
    const raw = from + index * step;
    const decimals = Math.max(0, String(step).split(".")[1]?.length ?? 0);
    values.push(Number(raw.toFixed(decimals)));
  }
  return values;
}

/**
 * Vary one strategy parameter across a range and report every outcome.
 *
 * The candles are fetched ONCE and reused for every run. That is not just
 * faster: comparing runs is only meaningful if they all saw identical data, and
 * re-fetching per run would let the live bar change mid-sweep on a short
 * timeframe.
 */
export async function runBacktestSweep(
  request: SweepRequest,
  dependencies: { marketAdapter?: ExchangeAdapter } = {},
): Promise<SweepResult> {
  if (getWorkspaceState().state.activeWorkspace === "replay") {
    throw new Error("Backtests are disabled while Replay is active, to avoid exposing future-derived results.");
  }
  const strategy = getStrategy(request.strategyId);
  if (!strategy) throw new Error(`Unknown built-in strategy: ${request.strategyId}`);
  if (!(request.parameter in strategy.defaults)) {
    throw new Error(`${request.strategyId} has no parameter named "${request.parameter}".`);
  }

  const values = sweepValues(request.from, request.to, request.step);
  const exchange = request.exchange ?? getWorkspaceState().state.exchange;
  const adapter = dependencies.marketAdapter ?? getExchangeAdapter(exchange);
  const raw = await adapter.fetchOHLCV(request.symbol, request.timeframe, request.limit ?? 600);
  const candles: readonly Candle[] = removeFormingCandles(raw, request.timeframe);
  if (candles.length < 2) throw new Error(`${exchange} returned fewer than two completed bars; nothing was swept.`);
  const gaps = findCandleGaps(candles, request.timeframe);
  if (gaps.length > 0) {
    throw new Error(`Dataset contains ${gaps.length} missing interval(s); a sweep on incomplete data is not comparable.`);
  }
  const datasetId = `${request.symbol.replaceAll("/", "-")}_${request.timeframe}_${candles[0]?.timestamp ?? 0}_${candles.at(-1)?.timestamp ?? 0}`;

  const runs: SweepRun[] = [];
  for (const value of values) {
    // Clamp to what the engine will accept so one bad value cannot abort the run.
    const parameters: StrategyParameters = { ...strategy.defaults, ...request.parameters, [request.parameter]: value };
    const result = runBacktest({
      candles,
      symbol: request.symbol,
      timeframe: request.timeframe,
      exchange,
      datasetId,
      strategy,
      parameters,
      config: request.config,
      resultId: randomUUID(),
    });
    runs.push({ value, metrics: result.metrics });
  }

  return {
    sweepId: randomUUID(),
    exchange,
    symbol: request.symbol,
    timeframe: request.timeframe,
    strategyId: strategy.id,
    strategyVersion: strategy.version,
    parameter: request.parameter,
    values,
    runs,
    parameters: { ...strategy.defaults, ...request.parameters },
    config: { ...request.config },
    datasetId,
    bars: candles.length,
    createdAt: new Date().toISOString(),
  };
}
