import { randomUUID } from "node:crypto";
import { decimal, EXCHANGE_TIMEFRAMES, getStrategy, runBacktest, type BacktestConfig, type BacktestResult, type Candle, type ExchangeId, type StrategyParameters, type Timeframe } from "@newbeing/core";
import { SWEEP_MAX_RUNS } from "./sweep-values.js";

export interface TrainHoldoutInput {
  /** Complete immutable snapshot supplied by the caller; this module never fetches or persists data. */
  readonly candles: readonly Readonly<Candle>[];
  readonly datasetId: string;
  readonly exchange: ExchangeId;
  readonly symbol: string;
  readonly timeframe: Timeframe;
  /** Only registered built-ins are accepted, never executable strategy definitions. */
  readonly strategyId: string;
  readonly candidates: readonly Readonly<StrategyParameters>[];
  readonly config: Readonly<BacktestConfig>;
  /** First holdout bar, zero-based in the supplied snapshot. Train is [0, splitIndex). */
  readonly splitIndex: number;
}

export interface TrainHoldoutBoundary {
  startIndex: number;
  endIndexExclusive: number;
  bars: number;
  startTime: number;
  /** Last included candle's open timestamp. */
  lastBarTime: number;
  /** Last included candle's close boundary. All timestamps are epoch milliseconds. */
  endTimeExclusive: number;
}

export interface TrainHoldoutCandidateResult {
  candidateIndex: number;
  parameters: StrategyParameters;
  result: BacktestResult;
}

export interface TrainHoldoutResult {
  datasetId: string;
  trainingBoundary: TrainHoldoutBoundary;
  holdoutBoundary: TrainHoldoutBoundary;
  training: TrainHoldoutCandidateResult[];
  selectedCandidateIndex: number;
  selectedParameters: StrategyParameters;
  selectionRule: "training-totalReturn-desc/parameter-json-asc";
  initialization: "cold-start/no-carry-positions";
  /** A single fixed chronological split, not walk-forward validation. */
  evaluation: "single-holdout";
  holdout: BacktestResult;
}

const DURATION: Record<Timeframe, number> = { "1m": 60_000, "5m": 300_000, "15m": 900_000, "30m": 1_800_000, "1h": 3_600_000, "4h": 14_400_000, "1d": 86_400_000 };

function parameterKey(parameters: StrategyParameters): string {
  return JSON.stringify(Object.keys(parameters).sort().map((key) => [key, parameters[key]]));
}

/**
 * Select using training totalReturn only (net of configured costs). Exact ties use
 * ascending canonical parameter JSON by UTF-16 code units, independent of candidate order.
 * Each run gets fresh cash, zero positions and fresh indicators. No training bars,
 * pending signals or capital reach holdout. Core supplies next-open fills, spot
 * ledger rounding, fees, adverse slippage and end-of-segment liquidation.
 * This local spot simulation does not enforce venue lot sizes or model market impact.
 */
export function runTrainHoldout(input: TrainHoldoutInput): TrainHoldoutResult {
  const { candles, splitIndex, timeframe } = input;
  if (!Object.hasOwn(EXCHANGE_TIMEFRAMES, input.exchange) || !EXCHANGE_TIMEFRAMES[input.exchange].includes(timeframe)) throw new Error("Unsupported venue/timeframe.");
  if (!/^[A-Z0-9]{2,20}\/[A-Z0-9]{2,20}$/.test(input.symbol)) throw new Error("Spot requires a BASE/QUOTE symbol.");
  if (typeof input.datasetId !== "string" || !input.datasetId.trim()) throw new Error("A caller-owned snapshot datasetId is required.");
  if (!Array.isArray(candles) || !Number.isInteger(splitIndex) || splitIndex < 2 || splitIndex > candles.length - 2) throw new Error("Invalid split: training and holdout each require at least two bars.");
  if ((input.config.accountMode !== undefined && input.config.accountMode !== "spot") || input.config.allowShorts !== false) throw new Error("Train/holdout requires spot with shorts disabled.");
  const config: BacktestConfig = { ...input.config, accountMode: "spot" };
  const duration = DURATION[timeframe];
  for (let index = 0; index < candles.length; index += 1) {
    const bar = candles[index];
    if (!bar || ![bar.timestamp, bar.open, bar.high, bar.low, bar.close, bar.volume].every(Number.isFinite) || !Number.isSafeInteger(bar.timestamp) || bar.timestamp < 0 || bar.timestamp % duration !== 0 || !Number.isSafeInteger(bar.timestamp + duration) || Math.min(bar.open, bar.high, bar.low, bar.close) <= 0 || bar.volume < 0 || bar.high < Math.max(bar.open, bar.close, bar.low) || bar.low > Math.min(bar.open, bar.close, bar.high)) throw new Error(`Invalid OHLCV bar at index ${index}.`);
    if (index > 0 && bar.timestamp - candles[index - 1]!.timestamp !== duration) throw new Error("Candles must be ordered, unique and contiguous without gaps.");
  }
  const strategy = getStrategy(input.strategyId);
  if (!strategy) throw new Error("Unknown built-in strategy.");
  if (!Array.isArray(input.candidates) || input.candidates.length < 1 || input.candidates.length > SWEEP_MAX_RUNS) throw new Error(`Supply 1-${SWEEP_MAX_RUNS} candidates.`);
  const seen = new Set<string>();
  const candidates = Array.from(input.candidates, (candidate) => {
    if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) throw new Error("Invalid candidate parameters.");
    for (const [key, value] of Object.entries(candidate)) {
      if (!Object.hasOwn(strategy.defaults, key) || typeof value !== typeof strategy.defaults[key] || (typeof value === "number" && !Number.isFinite(value))) throw new Error(`Invalid strategy parameter: ${key}`);
    }
    const parameters = { ...strategy.defaults, ...candidate };
    if (parameters.allowShorts !== false) throw new Error("Spot candidates must disable shorts.");
    // Reject values that built-ins would silently clamp/floor to another candidate.
    for (const key of ["fastPeriod", "slowPeriod", "period", "lookback"]) {
      const value = parameters[key];
      if (value !== undefined && (typeof value !== "number" || !Number.isInteger(value) || value < 2 || value > 500)) throw new Error(`Invalid period parameter: ${key}`);
    }
    if (strategy.id === "sma-crossover" && !(Number(parameters.fastPeriod) < Number(parameters.slowPeriod))) throw new Error("fastPeriod must be below slowPeriod.");
    if (strategy.id === "momentum-reversal" && Number(parameters.thresholdPct) < 0) throw new Error("thresholdPct must be nonnegative.");
    if (strategy.id === "rsi-mean-reversion") {
      const { oversold, overbought, exitLong, exitShort } = parameters;
      if (!(Number(oversold) >= 1 && Number(oversold) <= 49 && Number(overbought) >= 51 && Number(overbought) <= 99 && Number(exitLong) >= Number(oversold) + 1 && Number(exitLong) <= Number(overbought) - 1 && Number(exitShort) >= Number(oversold) + 1 && Number(exitShort) <= Number(overbought) - 1)) throw new Error("Invalid RSI levels.");
    }
    const key = parameterKey(parameters);
    if (seen.has(key)) throw new Error("Duplicate candidate parameters after resolving defaults.");
    seen.add(key);
    return { parameters, key };
  });
  const trainingCandles = candles.slice(0, splitIndex);
  const holdoutCandles = candles.slice(splitIndex);
  const run = (bars: readonly Candle[], parameters: StrategyParameters) => runBacktest({ candles: bars, exchange: input.exchange, symbol: input.symbol, timeframe, datasetId: input.datasetId, strategy, parameters: { ...parameters }, config: { ...config }, resultId: randomUUID() });
  const training = candidates.map(({ parameters }, candidateIndex) => ({ candidateIndex, parameters: { ...parameters }, result: run(trainingCandles, parameters) }));
  let selected = training[0]!;
  for (const candidate of training) {
    const score = candidate.result.metrics.totalReturn;
    if (!Number.isFinite(score)) throw new Error("Non-finite training selection metric.");
    const comparison = decimal(score).comparedTo(decimal(selected.result.metrics.totalReturn));
    if (comparison > 0 || (comparison === 0 && candidates[candidate.candidateIndex]!.key < candidates[selected.candidateIndex]!.key)) selected = candidate;
  }
  const boundary = (startIndex: number, endIndexExclusive: number): TrainHoldoutBoundary => ({ startIndex, endIndexExclusive, bars: endIndexExclusive - startIndex, startTime: candles[startIndex]!.timestamp, lastBarTime: candles[endIndexExclusive - 1]!.timestamp, endTimeExclusive: candles[endIndexExclusive - 1]!.timestamp + duration });
  return {
    datasetId: input.datasetId,
    trainingBoundary: boundary(0, splitIndex), holdoutBoundary: boundary(splitIndex, candles.length),
    training, selectedCandidateIndex: selected.candidateIndex, selectedParameters: { ...selected.parameters },
    selectionRule: "training-totalReturn-desc/parameter-json-asc", initialization: "cold-start/no-carry-positions", evaluation: "single-holdout",
    holdout: run(holdoutCandles, selected.parameters),
  };
}
