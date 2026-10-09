import type { Candle, MarketSide, StrategyDefinition, StrategyParameters } from "./types.js";

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

const movingAverageCrossover: StrategyDefinition = {
  id: "sma-crossover",
  name: "Moving Average Crossover",
  version: "1.0.0",
  description: "Long when the fast SMA is above the slow SMA; flat or short when below.",
  defaults: { fastPeriod: 20, slowPeriod: 50, allowShorts: false },
  signalAt(candles, index, parameters) {
    if (index < 0 || index >= candles.length) return "flat";
    const fastPeriod = safePeriod(numeric(parameters, "fastPeriod", 20));
    const slowPeriod = safePeriod(numeric(parameters, "slowPeriod", 50));
    if (fastPeriod >= slowPeriod) return "flat";
    const fast = averageClose(candles, index, fastPeriod);
    const slow = averageClose(candles, index, slowPeriod);
    if (fast === null || slow === null) return "flat";
    return fast > slow ? "long" : boolean(parameters, "allowShorts", false) ? "short" : "flat";
  },
};

const rsiMeanReversion: StrategyDefinition = {
  id: "rsi-mean-reversion",
  name: "RSI Mean Reversion",
  version: "1.0.0",
  description: "Buy oversold readings and exit near the center; optionally short overbought readings.",
  defaults: { period: 14, oversold: 30, exitLong: 50, overbought: 70, exitShort: 50, allowShorts: false },
  signalAt(candles, index, parameters) {
    if (index < 0 || index >= candles.length) return "flat";
    const period = safePeriod(numeric(parameters, "period", 14));
    const values = rsiValues(candles, period);
    if (values[index] === null || values[index] === undefined) return "flat";
    const oversold = Math.max(1, Math.min(49, numeric(parameters, "oversold", 30)));
    const overbought = Math.max(51, Math.min(99, numeric(parameters, "overbought", 70)));
    const exitLong = Math.max(oversold + 1, Math.min(overbought - 1, numeric(parameters, "exitLong", 50)));
    const exitShort = Math.max(oversold + 1, Math.min(overbought - 1, numeric(parameters, "exitShort", 50)));
    const shortsAllowed = boolean(parameters, "allowShorts", false);
    let state: MarketSide = "flat";
    for (let cursor = period; cursor <= index; cursor += 1) {
      const value = values[cursor];
      if (value === null || value === undefined) continue;
      if (state === "flat") {
        if (value <= oversold) state = "long";
        else if (shortsAllowed && value >= overbought) state = "short";
      } else if (state === "long" && value >= exitLong) {
        state = "flat";
      } else if (state === "short" && value <= exitShort) {
        state = "flat";
      }
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
  signalAt(candles, index, parameters) {
    if (index < 0 || index >= candles.length) return "flat";
    const lookback = safePeriod(numeric(parameters, "lookback", 20));
    const start = candles[index - lookback];
    const end = candles[index];
    if (!start || !end || start.close <= 0) return "flat";
    const threshold = Math.max(0, numeric(parameters, "thresholdPct", 2)) / 100;
    const momentum = end.close / start.close - 1;
    const reversal = boolean(parameters, "reversal", false);
    if (reversal) {
      if (momentum >= threshold) return boolean(parameters, "allowShorts", false) ? "short" : "flat";
      if (momentum <= -threshold) return "long";
      return "flat";
    }
    if (momentum >= threshold) return "long";
    if (momentum <= -threshold) return boolean(parameters, "allowShorts", false) ? "short" : "flat";
    return "flat";
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

export function strategySignals(
  strategy: StrategyDefinition,
  candles: readonly Candle[],
  parameters: StrategyParameters,
): Array<{ timestamp: number; side: MarketSide }> {
  const signals: Array<{ timestamp: number; side: MarketSide }> = [];
  for (let index = 0; index < candles.length; index += 1) {
    const candle = candles[index];
    if (!candle) continue;
    // Prefix slicing makes future bars unavailable to strategy code by construction.
    const prefix = candles.slice(0, index + 1);
    signals.push({ timestamp: candle.timestamp, side: strategy.signalAt(prefix, prefix.length - 1, parameters) });
  }
  return signals;
}
