import { BACKTEST_EXECUTION_ASSUMPTIONS, ENGINE_VERSION } from "./types.js";
import type {
  BacktestConfig,
  BacktestMetrics,
  BacktestResult,
  BacktestTrade,
  Candle,
  EquityPoint,
  MarketSide,
  StrategyDefinition,
  StrategyParameters,
  TradeExitReason,
} from "./types.js";
import { strategySignalSides } from "./strategies.js";

interface OpenPosition {
  side: Exclude<MarketSide, "flat">;
  entryTime: number;
  entryPrice: number;
  quantity: number;
  entryFee: number;
  entryNotional: number;
}

export interface RunBacktestInput {
  candles: readonly Candle[];
  symbol: string;
  timeframe: BacktestResult["timeframe"];
  datasetId: string;
  strategy: StrategyDefinition;
  parameters: StrategyParameters;
  config: BacktestConfig;
  resultId: string;
  createdAt?: string;
}

function validateInput(input: RunBacktestInput): void {
  if (input.candles.length < 2) throw new Error("At least two OHLCV bars are required.");
  if (!(input.config.initialCapital > 0) || !Number.isFinite(input.config.initialCapital)) {
    throw new Error("Initial capital must be a finite positive number.");
  }
  if (!(input.config.positionFraction > 0 && input.config.positionFraction <= 1)) {
    throw new Error("Position fraction must be greater than 0 and at most 1.");
  }
  if (!(input.config.feeRate >= 0 && input.config.feeRate <= 0.05)) throw new Error("Fee rate is outside the supported range.");
  if (!(input.config.slippageRate >= 0 && input.config.slippageRate <= 0.05)) {
    throw new Error("Slippage rate is outside the supported range.");
  }
  for (const [index, candle] of input.candles.entries()) {
    const values = [candle.timestamp, candle.open, candle.high, candle.low, candle.close, candle.volume];
    if (!values.every(Number.isFinite) || candle.timestamp < 0 || candle.open <= 0 || candle.high <= 0 || candle.low <= 0 || candle.close <= 0 || candle.volume < 0) {
      throw new Error(`Invalid OHLCV bar at index ${index}.`);
    }
    if (candle.high < Math.max(candle.open, candle.close, candle.low) || candle.low > Math.min(candle.open, candle.close, candle.high)) {
      throw new Error(`Inconsistent OHLC range at index ${index}.`);
    }
    const previous = input.candles[index - 1];
    if (previous && candle.timestamp <= previous.timestamp) throw new Error("Candles must have strictly increasing timestamps.");
  }
  if (input.config.stopLossPct !== undefined && !(input.config.stopLossPct > 0 && input.config.stopLossPct < 1)) {
    throw new Error("Stop loss percentage must be between 0 and 1.");
  }
  if (input.config.takeProfitPct !== undefined && !(input.config.takeProfitPct > 0 && input.config.takeProfitPct < 10)) {
    throw new Error("Take profit percentage must be between 0 and 10.");
  }
  if (input.config.allowShorts && input.config.takeProfitPct !== undefined && input.config.takeProfitPct >= 1) {
    throw new Error("Short take-profit percentage must be less than 1 so its target remains positive.");
  }
}

function withSlippage(price: number, orderSide: "buy" | "sell", rate: number): number {
  return price * (orderSide === "buy" ? 1 + rate : 1 - rate);
}

function annualizationFactor(candles: readonly Candle[]): number {
  const durations: number[] = [];
  for (let index = 1; index < candles.length; index += 1) {
    const current = candles[index];
    const previous = candles[index - 1];
    if (current && previous) {
      const duration = (current.timestamp - previous.timestamp) / 1000;
      if (duration > 0) durations.push(duration);
    }
  }
  if (durations.length === 0) return 0;
  durations.sort((a, b) => a - b);
  const medianSeconds = durations[Math.floor(durations.length / 2)] ?? 0;
  return medianSeconds > 0 ? (365.25 * 24 * 60 * 60) / medianSeconds : 0;
}

function buildMetrics(
  equityCurve: readonly EquityPoint[],
  trades: readonly BacktestTrade[],
  initialCapital: number,
  totalFees: number,
  candles: readonly Candle[],
): BacktestMetrics {
  const finalEquity = equityCurve.at(-1)?.equity ?? initialCapital;
  const totalReturn = finalEquity / initialCapital - 1;
  let peak = initialCapital;
  let maxDrawdown = 0;
  for (const point of equityCurve) {
    peak = Math.max(peak, point.equity);
    const drawdown = peak > 0 ? Math.max(0, (peak - point.equity) / peak) : 0;
    maxDrawdown = Math.max(maxDrawdown, drawdown);
  }
  const returns: number[] = [];
  for (let index = 1; index < equityCurve.length; index += 1) {
    const previous = equityCurve[index - 1];
    const current = equityCurve[index];
    if (previous && current && previous.equity !== 0) returns.push(current.equity / previous.equity - 1);
  }
  const mean = returns.length > 0 ? returns.reduce((sum, value) => sum + value, 0) / returns.length : 0;
  const variance = returns.length > 1
    ? returns.reduce((sum, value) => sum + (value - mean) ** 2, 0) / (returns.length - 1)
    : 0;
  const deviation = Math.sqrt(variance);
  const sharpeRatio = deviation > 0 ? (mean / deviation) * Math.sqrt(annualizationFactor(candles)) : null;
  const wins = trades.filter((trade) => trade.netPnl > 0);
  const losses = trades.filter((trade) => trade.netPnl < 0);
  const grossWins = wins.reduce((sum, trade) => sum + trade.netPnl, 0);
  const grossLosses = Math.abs(losses.reduce((sum, trade) => sum + trade.netPnl, 0));
  return {
    initialCapital,
    finalEquity,
    totalReturn,
    sharpeRatio: Number.isFinite(sharpeRatio) ? sharpeRatio : null,
    maxDrawdown,
    winRate: trades.length > 0 ? wins.length / trades.length : 0,
    profitFactor: grossLosses > 0 ? grossWins / grossLosses : null,
    tradeCount: trades.length,
    totalFees,
  };
}

export function runBacktest(input: RunBacktestInput): BacktestResult {
  validateInput(input);
  const { candles, config, strategy } = input;
  const signals = strategySignalSides(strategy, candles, input.parameters);
  const trades: BacktestTrade[] = [];
  const equityCurve: EquityPoint[] = [];
  let cash = config.initialCapital;
  const positionState: { current: OpenPosition | null } = { current: null };
  let totalFees = 0;
  let tradeCounter = 0;
  let pending: MarketSide = "flat";

  const closePosition = (rawPrice: number, time: number, reason: TradeExitReason, orderSide: "buy" | "sell"): void => {
    const current = positionState.current;
    if (!current) return;
    const closing = current;
    const exitPrice = withSlippage(rawPrice, orderSide, config.slippageRate);
    const direction = closing.side === "long" ? 1 : -1;
    const grossPnl = direction * (exitPrice - closing.entryPrice) * closing.quantity;
    const exitFee = Math.abs(exitPrice * closing.quantity) * config.feeRate;
    cash += grossPnl - exitFee;
    totalFees += exitFee;
    tradeCounter += 1;
    trades.push({
      id: `trade-${tradeCounter}`,
      side: closing.side,
      entryTime: closing.entryTime,
      exitTime: time,
      entryPrice: closing.entryPrice,
      exitPrice,
      quantity: closing.quantity,
      grossPnl,
      fees: closing.entryFee + exitFee,
      netPnl: grossPnl - closing.entryFee - exitFee,
      returnPct: closing.entryNotional > 0 ? (grossPnl - closing.entryFee - exitFee) / closing.entryNotional : 0,
      exitReason: reason,
    });
    positionState.current = null;
  };

  const openPosition = (side: Exclude<MarketSide, "flat">, rawPrice: number, time: number): void => {
    const equityBeforeEntry = Math.max(0, cash);
    const notional = equityBeforeEntry * config.positionFraction;
    if (notional <= 0) return;
    const orderSide = side === "long" ? "buy" : "sell";
    const entryPrice = withSlippage(rawPrice, orderSide, config.slippageRate);
    const quantity = notional / entryPrice;
    const entryFee = notional * config.feeRate;
    cash -= entryFee;
    totalFees += entryFee;
    positionState.current = { side, entryTime: time, entryPrice, quantity, entryFee, entryNotional: notional };
  };

  const evaluateProtection = (candle: Candle): void => {
    const current = positionState.current;
    if (!current) return;
    const isLong = current.side === "long";
    const stop = config.stopLossPct === undefined
      ? null
      : current.entryPrice * (isLong ? 1 - config.stopLossPct : 1 + config.stopLossPct);
    const target = config.takeProfitPct === undefined
      ? null
      : current.entryPrice * (isLong ? 1 + config.takeProfitPct : 1 - config.takeProfitPct);
    const stopHit = stop !== null && (isLong ? candle.low <= stop : candle.high >= stop);
    const targetHit = target !== null && (isLong ? candle.high >= target : candle.low <= target);
    // Conservative OHLC assumption: if both levels print in one candle, stop wins.
    if (stopHit && stop !== null) {
      const gappedThroughStop = isLong ? candle.open <= stop : candle.open >= stop;
      closePosition(gappedThroughStop ? candle.open : stop, candle.timestamp, "stop-loss", isLong ? "sell" : "buy");
      return;
    }
    if (targetHit && target !== null) {
      const gappedFavorably = isLong ? candle.open >= target : candle.open <= target;
      closePosition(gappedFavorably ? candle.open : target, candle.timestamp, "take-profit", isLong ? "sell" : "buy");
    }
  };

  for (let index = 0; index < candles.length; index += 1) {
    const candle = candles[index];
    if (!candle) continue;
    if (index > 0) {
      const desired = pending === "short" && !config.allowShorts ? "flat" : pending;
      const openAtStart = positionState.current;
      if (openAtStart && desired !== openAtStart.side) {
        closePosition(candle.open, candle.timestamp, "signal", openAtStart.side === "long" ? "sell" : "buy");
      }
      if (!positionState.current && desired !== "flat") openPosition(desired, candle.open, candle.timestamp);
    }

    evaluateProtection(candle);
    const markedPosition = positionState.current;
    const markedEquity = markedPosition
      ? cash + (markedPosition.side === "long" ? 1 : -1) * (candle.close - markedPosition.entryPrice) * markedPosition.quantity
      : cash;
    const previousPoint = equityCurve.at(-1);
    const peak = Math.max(config.initialCapital, previousPoint?.equity ?? config.initialCapital);
    equityCurve.push({
      timestamp: candle.timestamp,
      equity: markedEquity,
      drawdown: peak > 0 ? Math.max(0, (peak - markedEquity) / peak) : 0,
    });
    pending = signals[index] ?? "flat";
  }

  const lastCandle = candles.at(-1);
  const finalPosition = positionState.current;
  if (finalPosition && lastCandle) {
    closePosition(lastCandle.close, lastCandle.timestamp, "end-of-data", finalPosition.side === "long" ? "sell" : "buy");
    const lastPoint = equityCurve.at(-1);
    if (lastPoint) lastPoint.equity = cash;
  }
  let peak = config.initialCapital;
  for (const point of equityCurve) {
    peak = Math.max(peak, point.equity);
    point.drawdown = peak > 0 ? Math.max(0, (peak - point.equity) / peak) : 0;
  }
  return {
    resultId: input.resultId,
    datasetId: input.datasetId,
    symbol: input.symbol,
    timeframe: input.timeframe,
    strategyId: strategy.id,
    strategyVersion: strategy.version,
    parameters: { ...input.parameters },
    assumptions: { ...config },
    execution: { ...BACKTEST_EXECUTION_ASSUMPTIONS },
    engineVersion: ENGINE_VERSION,
    createdAt: input.createdAt ?? new Date().toISOString(),
    metrics: buildMetrics(equityCurve, trades, config.initialCapital, totalFees, candles),
    equityCurve,
    trades,
    signals: candles.map((candle, index) => ({ timestamp: candle.timestamp, side: signals[index] ?? "flat" })),
  };
}
