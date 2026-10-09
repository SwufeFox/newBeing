export const ENGINE_VERSION = "newbeing-backtest/0.1.0";

export type Timeframe = "1m" | "5m" | "15m" | "30m" | "1h" | "4h" | "1d";
export type MarketSide = "long" | "short" | "flat";

export interface Candle {
  /** Unix epoch milliseconds, UTC. */
  timestamp: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export type StrategyParameters = Record<string, number | boolean>;

/** signalAt receives only the prefix ending at `index`, never later candles. */
export interface StrategyDefinition {
  id: string;
  name: string;
  version: string;
  description: string;
  defaults: StrategyParameters;
  signalAt(candles: readonly Candle[], index: number, parameters: StrategyParameters): MarketSide;
}

export interface BacktestConfig {
  initialCapital: number;
  positionFraction: number;
  feeRate: number;
  slippageRate: number;
  allowShorts: boolean;
  stopLossPct?: number;
  takeProfitPct?: number;
}

export interface EquityPoint {
  timestamp: number;
  equity: number;
  drawdown: number;
}

export type TradeExitReason = "signal" | "stop-loss" | "take-profit" | "end-of-data";

export interface BacktestTrade {
  id: string;
  side: Exclude<MarketSide, "flat">;
  entryTime: number;
  exitTime: number;
  entryPrice: number;
  exitPrice: number;
  quantity: number;
  grossPnl: number;
  fees: number;
  netPnl: number;
  returnPct: number;
  exitReason: TradeExitReason;
}

export interface BacktestMetrics {
  initialCapital: number;
  finalEquity: number;
  totalReturn: number;
  sharpeRatio: number | null;
  maxDrawdown: number;
  winRate: number;
  profitFactor: number | null;
  tradeCount: number;
  totalFees: number;
}

export interface BacktestExecutionAssumptions {
  signalTiming: string;
  fillTiming: string;
  intrabarStops: string;
  endOfData: string;
  sharpeMethod: string;
}

export interface BacktestResult {
  resultId: string;
  datasetId: string;
  symbol: string;
  timeframe: Timeframe;
  strategyId: string;
  strategyVersion: string;
  parameters: StrategyParameters;
  assumptions: BacktestConfig;
  execution: BacktestExecutionAssumptions;
  engineVersion: string;
  createdAt: string;
  metrics: BacktestMetrics;
  equityCurve: EquityPoint[];
  trades: BacktestTrade[];
  signals: Array<{ timestamp: number; side: MarketSide }>;
}

export interface WorkspaceLayout {
  watchlistWidth: number;
  inspectorWidth: number;
  bottomHeight: number;
}

export interface WorkspaceState {
  symbol: string;
  timeframe: Timeframe;
  exchange: "binance";
  mode: "paper";
  activeWorkspace: "terminal" | "research" | "backtest" | "replay";
  selectedStrategyId: string;
  activeBacktestId: string | null;
  activeReplayId: string | null;
  visibleRange: { from: number | null; to: number | null };
  layout: WorkspaceLayout;
}

export interface ReplaySession {
  id: string;
  symbol: string;
  timeframe: Timeframe;
  startAt: number;
  cursor: number;
  bars: Candle[];
  status: "active" | "finished";
  createdAt: string;
  updatedAt: string;
}

export interface OrderPreview {
  id: string;
  symbol: string;
  side: "buy" | "sell";
  quantity: number;
  mode: "paper";
  referencePrice: number;
  estimatedNotional: number;
  estimatedFee: number;
  status: "prepared" | "confirmed" | "dismissed" | "expired";
  createdAt: string;
  expiresAt: string;
  orderId: string | null;
}

export const DEFAULT_WORKSPACE_STATE: WorkspaceState = {
  symbol: "BTC/USDT",
  timeframe: "15m",
  exchange: "binance",
  mode: "paper",
  activeWorkspace: "terminal",
  selectedStrategyId: "sma-crossover",
  activeBacktestId: null,
  activeReplayId: null,
  visibleRange: { from: null, to: null },
  layout: { watchlistWidth: 220, inspectorWidth: 300, bottomHeight: 224 },
};

export const BACKTEST_EXECUTION_ASSUMPTIONS: BacktestExecutionAssumptions = {
  signalTiming: "Evaluated after each completed bar close using only the prefix through that bar.",
  fillTiming: "Signals fill at the next bar open with adverse side-aware slippage; no same-close fills.",
  intrabarStops: "OHLC barrier checks use stop-first when stop and target both hit; gaps through a barrier fill at the bar open, then slippage and fee apply.",
  endOfData: "Any open position is closed at the final bar close with adverse slippage and fee.",
  sharpeMethod: "Sample standard deviation of bar-to-bar marked-equity returns; annualized by square root of 365.25 days divided by the median observed bar duration; no risk-free rate.",
};
