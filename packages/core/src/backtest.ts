import { LEGACY_MARGIN_EXECUTION_POLICY, SPOT_EXECUTION_POLICY, longProtectionFill, spotBuyQuantity } from "./policy.js";
import { decimal, money, validateMoney } from "./ledger.js";
import { fillPaperOrder, type PaperPortfolio } from "./paper.js";
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

const cachedCloseDecimals = new WeakMap<Candle, { close: number; value: ReturnType<typeof decimal> }>();

function decimalClose(candle: Candle): ReturnType<typeof decimal> {
  const cached = cachedCloseDecimals.get(candle);
  if (cached && cached.close === candle.close) return cached.value;
  const value = decimal(candle.close);
  cachedCloseDecimals.set(candle, { close: candle.close, value });
  return value;
}

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
  /** Venue the candles came from; carried onto the result so the run stays
   *  traceable to its source. */
  exchange: BacktestResult["exchange"];
  datasetId: string;
  strategy: StrategyDefinition;
  parameters: StrategyParameters;
  config: BacktestConfig;
  resultId: string;
  createdAt?: string;
}

function validateInput(input: RunBacktestInput): void {
  if (input.config.accountMode !== undefined && !["spot", "legacy-margin"].includes(input.config.accountMode)) throw new Error("Unsupported account mode.");
  if (input.config.accountMode !== "legacy-margin") {
    validateMoney(input.config.initialCapital);
    if (input.config.allowShorts) throw new Error("Spot does not support shorts. Select explicit legacy-margin simulation for historical synthetic strategies.");
    if (!/^[A-Z0-9]{2,20}\/[A-Z0-9]{2,20}$/.test(input.symbol)) throw new Error("Spot requires a BASE/QUOTE instrument; derivatives are unsupported.");
  }
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
  for (let index = 0; index < input.candles.length; index += 1) {
    const candle = input.candles[index]!;
    if (
      !Number.isFinite(candle.timestamp)
      || !Number.isFinite(candle.open)
      || !Number.isFinite(candle.high)
      || !Number.isFinite(candle.low)
      || !Number.isFinite(candle.close)
      || !Number.isFinite(candle.volume)
      || candle.timestamp < 0
      || candle.open <= 0
      || candle.high <= 0
      || candle.low <= 0
      || candle.close <= 0
      || candle.volume < 0
    ) {
      throw new Error(`Invalid OHLCV bar at index ${index}.`);
    }
    if (
      candle.high < candle.open
      || candle.high < candle.close
      || candle.high < candle.low
      || candle.low > candle.open
      || candle.low > candle.close
      || candle.low > candle.high
    ) {
      throw new Error(`Inconsistent OHLC range at index ${index}.`);
    }
    const previous = index > 0 ? input.candles[index - 1] : undefined;
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
  if (candles.length < 2) return 0;
  const first = candles[1];
  const previous = candles[0];
  if (!first || !previous) return 0;
  const firstDuration = (first.timestamp - previous.timestamp) / 1000;
  let regular = true;
  for (let index = 2; index < candles.length; index += 1) {
    const current = candles[index];
    const prior = candles[index - 1];
    if (current && prior && (current.timestamp - prior.timestamp) / 1000 !== firstDuration) {
      regular = false;
      break;
    }
  }
  if (regular) return firstDuration > 0 ? (365.25 * 24 * 60 * 60) / firstDuration : 0;

  const durations: number[] = [];
  for (let index = 1; index < candles.length; index += 1) {
    const current = candles[index];
    const prior = candles[index - 1];
    if (current && prior) {
      const duration = (current.timestamp - prior.timestamp) / 1000;
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
  maxDrawdown: number,
): BacktestMetrics {
  const finalEquity = equityCurve.at(-1)?.equity ?? initialCapital;
  const totalReturn = finalEquity / initialCapital - 1;
  let returnCount = 0;
  let returnSum = 0;
  for (let index = 1; index < equityCurve.length; index += 1) {
    const previous = equityCurve[index - 1];
    const current = equityCurve[index];
    if (previous && current && previous.equity !== 0) {
      returnSum += current.equity / previous.equity - 1;
      returnCount += 1;
    }
  }
  const mean = returnCount > 0 ? returnSum / returnCount : 0;
  let squaredDeviation = 0;
  if (returnCount > 1) {
    for (let index = 1; index < equityCurve.length; index += 1) {
      const previous = equityCurve[index - 1];
      const current = equityCurve[index];
      if (previous && current && previous.equity !== 0) {
        const barReturn = current.equity / previous.equity - 1;
        squaredDeviation += (barReturn - mean) ** 2;
      }
    }
  }
  const variance = returnCount > 1 ? squaredDeviation / (returnCount - 1) : 0;
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
  const signalStream = strategy.createSignalStream?.(input.parameters) ?? null;
  const fallbackSignals = signalStream ? null : strategySignalSides(strategy, candles, input.parameters);
  const signalResults: BacktestResult["signals"] = [];
  const trades: BacktestTrade[] = [];
  const equityCurve: EquityPoint[] = [];
  let cash = config.initialCapital;
  const spot = config.accountMode !== "legacy-margin";
  let portfolio: PaperPortfolio = { quoteBalance: cash, baseBalance: 0, costBasis: 0, averageEntryPrice: null, realizedPnl: 0, feeRate: config.feeRate };
  const settle = (side: "buy" | "sell", quantity: number, price: number, time: number) => {
    const fill = fillPaperOrder({ clientOrderId: `backtest-${tradeCounter}-${side}`, symbol: input.symbol, side, quantity, status: "submitted", fillPrice: null, fee: 0, createdAt: new Date(time).toISOString() }, portfolio, price);
    portfolio = fill.portfolio;
    cash = portfolio.quoteBalance;
    return fill.order.fee;
  };
  const positionState: { current: OpenPosition | null } = { current: null };
  let markCashDecimal: ReturnType<typeof decimal> | null = null;
  let markQuantityDecimal: ReturnType<typeof decimal> | null = null;
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
    const realizedBefore = portfolio.realizedPnl;
    const exitFee = spot ? settle("sell", closing.quantity, exitPrice, time) : Math.abs(exitPrice * closing.quantity) * config.feeRate;
    if (!spot) cash += grossPnl - exitFee;
    const netPnl = spot ? money(decimal(portfolio.realizedPnl).minus(realizedBefore)) : grossPnl - closing.entryFee - exitFee;
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
      netPnl,
      returnPct: closing.entryNotional > 0 ? netPnl / closing.entryNotional : 0,
      exitReason: reason,
    });
    positionState.current = null;
    markCashDecimal = null;
    markQuantityDecimal = null;
  };

  const openPosition = (side: Exclude<MarketSide, "flat">, rawPrice: number, time: number): void => {
    const equityBeforeEntry = Math.max(0, cash);
    const notional = equityBeforeEntry * config.positionFraction;
    if (notional <= 0) return;
    const orderSide = side === "long" ? "buy" : "sell";
    const entryPrice = withSlippage(rawPrice, orderSide, config.slippageRate);
    const quantity = spot ? spotBuyQuantity(money(notional), entryPrice, config.feeRate) : notional / entryPrice;
    if (quantity <= 0) return;
    const entryFee = spot ? settle("buy", quantity, entryPrice, time) : notional * config.feeRate;
    if (!spot) cash -= entryFee;
    totalFees += entryFee;
    positionState.current = { side, entryTime: time, entryPrice, quantity, entryFee, entryNotional: spot ? money(decimal(entryPrice).times(quantity)) : notional };
    markCashDecimal = spot ? decimal(cash) : null;
    markQuantityDecimal = spot ? decimal(quantity) : null;
  };

  const evaluateProtection = (candle: Candle, phase: "open" | "range"): void => {
    if (!spot && phase === "open") return;
    const current = positionState.current;
    if (!current) return;
    const isLong = current.side === "long";
    const stop = config.stopLossPct === undefined
      ? null
      : current.entryPrice * (isLong ? 1 - config.stopLossPct : 1 + config.stopLossPct);
    const target = config.takeProfitPct === undefined
      ? null
      : current.entryPrice * (isLong ? 1 + config.takeProfitPct : 1 - config.takeProfitPct);
    if (isLong && spot) {
      const protection = longProtectionFill(candle, stop ?? undefined, target ?? undefined, phase, current.entryTime < candle.timestamp);
      if (protection) closePosition(protection.price, candle.timestamp, protection.reason, "sell");
      return;
    }
    const low = phase === "open" ? candle.open : candle.low;
    const high = phase === "open" ? candle.open : candle.high;
    const stopHit = stop !== null && (isLong ? low <= stop : high >= stop);
    const targetHit = target !== null && (isLong ? high >= target : low <= target);
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
    const hadPositionAtOpen = positionState.current !== null;
    evaluateProtection(candle, "open");
    if (index > 0) {
      const desired = pending === "short" && !config.allowShorts ? "flat" : pending;
      const openAtStart = positionState.current;
      if (openAtStart && desired !== openAtStart.side) {
        closePosition(candle.open, candle.timestamp, "signal", openAtStart.side === "long" ? "sell" : "buy");
      }
      if (!positionState.current && desired !== "flat" && (!hadPositionAtOpen || openAtStart !== null)) openPosition(desired, candle.open, candle.timestamp);
    }

    evaluateProtection(candle, "range");
    const markedPosition = positionState.current;
    const markedEquity = markedPosition
      ? spot
        ? money(markCashDecimal!.plus(decimalClose(candle).times(markQuantityDecimal!)))
        : cash + (markedPosition.side === "long" ? 1 : -1) * (candle.close - markedPosition.entryPrice) * markedPosition.quantity
      : cash;
    equityCurve.push({
      timestamp: candle.timestamp,
      equity: markedEquity,
      drawdown: 0,
    });
    const signal = signalStream ? signalStream.next(candle) : fallbackSignals?.[index] ?? "flat";
    signalResults.push({ timestamp: candle.timestamp, side: signal });
    pending = signal;
  }

  const lastCandle = candles.at(-1);
  const finalPosition = positionState.current;
  if (finalPosition && lastCandle) {
    closePosition(lastCandle.close, lastCandle.timestamp, "end-of-data", finalPosition.side === "long" ? "sell" : "buy");
    const lastPoint = equityCurve.at(-1);
    if (lastPoint) lastPoint.equity = cash;
  }
  let peak = config.initialCapital;
  let maxDrawdown = 0;
  for (const point of equityCurve) {
    peak = Math.max(peak, point.equity);
    point.drawdown = peak > 0 ? Math.max(0, (peak - point.equity) / peak) : 0;
    maxDrawdown = Math.max(maxDrawdown, point.drawdown);
  }
  return {
    resultId: input.resultId,
    datasetId: input.datasetId,
    exchange: input.exchange,
    symbol: input.symbol,
    timeframe: input.timeframe,
    strategyId: strategy.id,
    strategyVersion: strategy.version,
    parameters: { ...input.parameters },
    assumptions: { ...config },
    executionPolicy: { ...(spot ? SPOT_EXECUTION_POLICY : LEGACY_MARGIN_EXECUTION_POLICY) },
    execution: { ...BACKTEST_EXECUTION_ASSUMPTIONS, ...(!spot ? { intrabarStops: LEGACY_MARGIN_EXECUTION_POLICY.protection } : {}) },
    engineVersion: ENGINE_VERSION,
    createdAt: input.createdAt ?? new Date().toISOString(),
    metrics: buildMetrics(equityCurve, trades, config.initialCapital, totalFees, candles, maxDrawdown),
    equityCurve,
    trades,
    signals: signalResults,
  };
}
