import type {
  Candle,
  MarketSide,
  StrategyDefinition,
  StrategyParameters,
  StrategySignalStream,
} from "./types.js";

function numeric(parameters: StrategyParameters, key: string, fallback: number): number {
  const value = parameters[key];
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function boolean(parameters: StrategyParameters, key: string, fallback: boolean): boolean {
  const value = parameters[key];
  return typeof value === "boolean" ? value : fallback;
}

function averageClose(candles: readonly Candle[], end: number, period: number): number | null {
  const first = end - period + 1;
  if (first < 0) return null;
  let sum = 0;
  for (let index = first; index <= end; index += 1) {
    const candle = candles[index];
    if (!candle) return null;
    sum += candle.close;
  }
  return sum / period;
}

function rsiValues(candles: readonly Candle[], period: number): Array<number | null> {
  const values: Array<number | null> = Array.from({ length: candles.length }, () => null);
  if (candles.length <= period) return values;
  let gains = 0;
  let losses = 0;
  for (let index = 1; index <= period; index += 1) {
    const previous = candles[index - 1];
    const current = candles[index];
    if (!previous || !current) return values;
    const change = current.close - previous.close;
    gains += Math.max(0, change);
    losses += Math.max(0, -change);
  }
  let averageGain = gains / period;
  let averageLoss = losses / period;
  const rsi = (): number => {
    if (averageLoss === 0) return averageGain === 0 ? 50 : 100;
    const relativeStrength = averageGain / averageLoss;
    return 100 - 100 / (1 + relativeStrength);
  };
  values[period] = rsi();
  for (let index = period + 1; index < candles.length; index += 1) {
    const previous = candles[index - 1];
    const current = candles[index];
    if (!previous || !current) continue;
    const change = current.close - previous.close;
    averageGain = (averageGain * (period - 1) + Math.max(0, change)) / period;
    averageLoss = (averageLoss * (period - 1) + Math.max(0, -change)) / period;
    values[index] = rsi();
  }
  return values;
}

function safePeriod(value: number, minimum = 2, maximum = 500): number {
  return Math.max(minimum, Math.min(maximum, Math.floor(value)));
}

function movingAverageSignal(fast: number | null, slow: number | null, allowShorts: boolean): MarketSide {
  if (fast === null || slow === null) return "flat";
  return fast > slow ? "long" : allowShorts ? "short" : "flat";
}

interface RsiLevels {
  oversold: number;
  overbought: number;
  exitLong: number;
  exitShort: number;
  allowShorts: boolean;
}

function rsiLevels(parameters: StrategyParameters): RsiLevels {
  const oversold = Math.max(1, Math.min(49, numeric(parameters, "oversold", 30)));
  const overbought = Math.max(51, Math.min(99, numeric(parameters, "overbought", 70)));
  return {
    oversold,
    overbought,
    exitLong: Math.max(oversold + 1, Math.min(overbought - 1, numeric(parameters, "exitLong", 50))),
    exitShort: Math.max(oversold + 1, Math.min(overbought - 1, numeric(parameters, "exitShort", 50))),
    allowShorts: boolean(parameters, "allowShorts", false),
  };
}

function advanceRsiState(state: MarketSide, value: number, levels: RsiLevels): MarketSide {
  if (state === "flat") {
    if (value <= levels.oversold) return "long";
    if (levels.allowShorts && value >= levels.overbought) return "short";
  } else if (state === "long" && value >= levels.exitLong) {
    return "flat";
  } else if (state === "short" && value <= levels.exitShort) {
    return "flat";
  }
  return state;
}

interface MomentumOptions {
  threshold: number;
  reversal: boolean;
  allowShorts: boolean;
}

function momentumOptions(parameters: StrategyParameters): MomentumOptions {
  return {
    threshold: Math.max(0, numeric(parameters, "thresholdPct", 2)) / 100,
    reversal: boolean(parameters, "reversal", false),
    allowShorts: boolean(parameters, "allowShorts", false),
  };
}

function momentumSignal(startClose: number | undefined, endClose: number, options: MomentumOptions): MarketSide {
  if (startClose === undefined || startClose <= 0) return "flat";
  const momentum = endClose / startClose - 1;
  if (options.reversal) {
    if (momentum >= options.threshold) return options.allowShorts ? "short" : "flat";
    if (momentum <= -options.threshold) return "long";
    return "flat";
  }
  if (momentum >= options.threshold) return "long";
  if (momentum <= -options.threshold) return options.allowShorts ? "short" : "flat";
  return "flat";
}

const movingAverageCrossover: StrategyDefinition = {
  id: "sma-crossover",
  name: "Moving Average Crossover",
  version: "1.0.0",
  description: "Long when the fast SMA is above the slow SMA; flat or short when below.",
  defaults: { fastPeriod: 20, slowPeriod: 50, allowShorts: false },
  executionSummary(parameters) {
    const fastPeriod = safePeriod(numeric(parameters, "fastPeriod", 20));
    const slowPeriod = safePeriod(numeric(parameters, "slowPeriod", 50));
    if (fastPeriod >= slowPeriod) return "No signals are emitted because fastPeriod must be smaller than slowPeriod.";
    return `At each close after ${slowPeriod} bars, compare the arithmetic means of the latest ${fastPeriod} and ${slowPeriod} closes. Emit long when fast SMA > slow SMA; otherwise ${boolean(parameters, "allowShorts", false) ? "emit short" : "stay flat"}. The simulator fills a close-time signal at the next bar open.`;
  },
  createSignalStream(parameters): StrategySignalStream {
    const fastPeriod = safePeriod(numeric(parameters, "fastPeriod", 20));
    const slowPeriod = safePeriod(numeric(parameters, "slowPeriod", 50));
    const allowShorts = boolean(parameters, "allowShorts", false);
    const closes = new Array<number>(slowPeriod);
    let count = 0;
    const average = (period: number): number | null => {
      if (count < period) return null;
      const firstSequence = count - period;
      let sum = 0;
      for (let offset = 0; offset < period; offset += 1) {
        const value = closes[(firstSequence + offset) % slowPeriod];
        if (value === undefined) return null;
        sum += value;
      }
      return sum / period;
    };
    return {
      next(candle) {
        closes[count % slowPeriod] = candle.close;
        count += 1;
        if (fastPeriod >= slowPeriod) return "flat";
        return movingAverageSignal(average(fastPeriod), average(slowPeriod), allowShorts);
      },
    };
  },
  signalAt(candles, index, parameters) {
    if (index < 0 || index >= candles.length) return "flat";
    const fastPeriod = safePeriod(numeric(parameters, "fastPeriod", 20));
    const slowPeriod = safePeriod(numeric(parameters, "slowPeriod", 50));
    if (fastPeriod >= slowPeriod) return "flat";
    const fast = averageClose(candles, index, fastPeriod);
    const slow = averageClose(candles, index, slowPeriod);
    return movingAverageSignal(fast, slow, boolean(parameters, "allowShorts", false));
  },
};

const rsiMeanReversion: StrategyDefinition = {
  id: "rsi-mean-reversion",
  name: "RSI Mean Reversion",
  version: "1.0.0",
  description: "Buy oversold readings and exit near the center; optionally short overbought readings.",
  defaults: { period: 14, oversold: 30, exitLong: 50, overbought: 70, exitShort: 50, allowShorts: false },
  executionSummary(parameters) {
    const period = safePeriod(numeric(parameters, "period", 14));
    const levels = rsiLevels(parameters);
    return `Use Wilder RSI(${period}), seeded by simple averages of the first ${period} close-to-close changes. From that bar, a flat state enters long at RSI ≤ ${levels.oversold}; ${levels.allowShorts ? `it enters short at RSI ≥ ${levels.overbought}` : "short entries are disabled"}. Long exits at RSI ≥ ${levels.exitLong}; short exits at RSI ≤ ${levels.exitShort}; otherwise the prior state is held. Signals fill at the next bar open.`;
  },
  createSignalStream(parameters): StrategySignalStream {
    const period = safePeriod(numeric(parameters, "period", 14));
    const levels = rsiLevels(parameters);
    let index = 0;
    let previousClose: number | undefined;
    let gains = 0;
    let losses = 0;
    let averageGain = 0;
    let averageLoss = 0;
    let state: MarketSide = "flat";
    const rsi = (): number => {
      if (averageLoss === 0) return averageGain === 0 ? 50 : 100;
      const relativeStrength = averageGain / averageLoss;
      return 100 - 100 / (1 + relativeStrength);
    };
    return {
      next(candle) {
        if (previousClose === undefined) {
          previousClose = candle.close;
          index = 1;
          return "flat";
        }
        const change = candle.close - previousClose;
        previousClose = candle.close;
        if (index <= period) {
          gains += Math.max(0, change);
          losses += Math.max(0, -change);
          index += 1;
          if (index <= period) return "flat";
          averageGain = gains / period;
          averageLoss = losses / period;
        } else {
          averageGain = (averageGain * (period - 1) + Math.max(0, change)) / period;
          averageLoss = (averageLoss * (period - 1) + Math.max(0, -change)) / period;
          index += 1;
        }
        state = advanceRsiState(state, rsi(), levels);
        return state;
      },
    };
  },
  signalAt(candles, index, parameters) {
    if (index < 0 || index >= candles.length) return "flat";
    const period = safePeriod(numeric(parameters, "period", 14));
    const values = rsiValues(candles, period);
    if (values[index] === null || values[index] === undefined) return "flat";
    const levels = rsiLevels(parameters);
    let state: MarketSide = "flat";
    for (let cursor = period; cursor <= index; cursor += 1) {
      const value = values[cursor];
      if (value === null || value === undefined) continue;
      state = advanceRsiState(state, value, levels);
    }
    return state;
  },
};

const momentumReversal: StrategyDefinition = {
  id: "momentum-reversal",
  name: "N-day Momentum / Reversal",
  version: "1.0.0",
  description: "Follow a normalized N-bar move, or invert it for a mean-reversion experiment.",
  defaults: { lookback: 20, thresholdPct: 2, reversal: false, allowShorts: false },
  executionSummary(parameters) {
    const lookback = safePeriod(numeric(parameters, "lookback", 20));
    const options = momentumOptions(parameters);
    const positiveSignal = options.reversal ? (options.allowShorts ? "short" : "no signal") : "long";
    const negativeSignal = options.reversal ? "long" : options.allowShorts ? "short" : "no signal";
    return `At each close, calculate close[t] / close[t−${lookback}] − 1 and compare it with ±${(options.threshold * 100).toFixed(4)}%. A positive move at or above the threshold emits ${positiveSignal}; a negative move at or below the negative threshold emits ${negativeSignal}. Signals fill at the next bar open.`;
  },
  createSignalStream(parameters): StrategySignalStream {
    const lookback = safePeriod(numeric(parameters, "lookback", 20));
    const options = momentumOptions(parameters);
    const closes = new Array<number>(lookback + 1);
    let count = 0;
    return {
      next(candle) {
        const index = count;
        closes[index % closes.length] = candle.close;
        count += 1;
        if (index < lookback) return "flat";
        const startClose = closes[(index - lookback) % closes.length];
        return momentumSignal(startClose, candle.close, options);
      },
    };
  },
  signalAt(candles, index, parameters) {
    if (index < 0 || index >= candles.length) return "flat";
    const lookback = safePeriod(numeric(parameters, "lookback", 20));
    const start = candles[index - lookback];
    const end = candles[index];
    if (!start || !end || start.close <= 0) return "flat";
    return momentumSignal(start.close, end.close, momentumOptions(parameters));
  },
};

export const STRATEGIES: readonly StrategyDefinition[] = [
  movingAverageCrossover,
  rsiMeanReversion,
  momentumReversal,
];

export function getStrategy(strategyId: string): StrategyDefinition | undefined {
  return STRATEGIES.find((strategy) => strategy.id === strategyId);
}

export function strategySignalSides(
  strategy: StrategyDefinition,
  candles: readonly Candle[],
  parameters: StrategyParameters,
): MarketSide[] {
  const signals: MarketSide[] = [];
  const stream = strategy.createSignalStream?.(parameters);
  for (let index = 0; index < candles.length; index += 1) {
    const candle = candles[index];
    if (!candle) continue;
    if (stream) {
      signals.push(stream.next(candle));
    } else {
      // Keep the safe-prefix contract for future/custom implementations without a stream.
      const prefix = candles.slice(0, index + 1);
      signals.push(strategy.signalAt(prefix, prefix.length - 1, parameters));
    }
  }
  return signals;
}

export function strategySignals(
  strategy: StrategyDefinition,
  candles: readonly Candle[],
  parameters: StrategyParameters,
): Array<{ timestamp: number; side: MarketSide }> {
  const sides = strategySignalSides(strategy, candles, parameters);
  return candles.flatMap((candle, index) => {
    const side = sides[index];
    return side === undefined ? [] : [{ timestamp: candle.timestamp, side }];
  });
}
