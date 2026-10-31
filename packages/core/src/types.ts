export const ENGINE_VERSION = "newbeing-backtest/0.2.0";

export type Timeframe = "1m" | "5m" | "15m" | "30m" | "1h" | "4h" | "1d";
export type ExchangeId = "binance" | "coinbaseexchange" | "okx" | "kraken";
export const SUPPORTED_EXCHANGES: readonly ExchangeId[] = ["binance", "coinbaseexchange", "okx", "kraken"];
export const EXCHANGE_TIMEFRAMES: Readonly<Record<ExchangeId, readonly Timeframe[]>> = {
  binance: ["1m", "5m", "15m", "30m", "1h", "4h", "1d"],
  coinbaseexchange: ["1m", "5m", "15m", "1h", "1d"],
  okx: ["1m", "5m", "15m", "30m", "1h", "4h", "1d"],
  kraken: ["1m", "5m", "15m", "30m", "1h", "4h", "1d"],
};
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
export interface StrategySignalStream {
  /** Consume one closed candle and return the signal visible at that close. */
  next(candle: Candle): MarketSide;
}

export interface StrategyDefinition {
  id: string;
  name: string;
  version: string;
  description: string;
  defaults: StrategyParameters;
  /** Human-readable description of the executable logic, derived from its parameters. */
  executionSummary?(parameters: StrategyParameters): string;
  /** Optional stateful implementation; strategies without one use signalAt on a safe prefix. */
  createSignalStream?(parameters: StrategyParameters): StrategySignalStream;
  signalAt(candles: readonly Candle[], index: number, parameters: StrategyParameters): MarketSide;
}

export interface BacktestConfig {
  /** New runs use spot. Historical synthetic shorts require explicit legacy-margin selection. */
  accountMode?: "spot" | "legacy-margin";
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

export interface ResearchReproduction {
  format: 1;
  snapshotId: string;
  /** Hash of the executable core artifact, including strategy and engine dependencies. */
  implementationHash: string;
}

export interface WalkForwardFold {
  trainEnd: number;
  validationStart: number;
  validationEnd: number;
  trainStartTimestamp: number;
  trainEndTimestamp: number;
  validationStartTimestamp: number;
  validationEndTimestamp: number;
  candidateValue: number;
  trainingResultId: string;
  validationResultId: string;
  trainingMetrics: BacktestMetrics;
  validationMetrics: BacktestMetrics;
}

export interface WalkForwardReport {
  mode: "walk-forward";
  boundaries: { train50: number; train60: number; train70: number; train80: number; total: number };
  selectionRule: "training-totalReturn-desc/parameter-value-asc";
  finalTrainingStartTimestamp: number;
  finalTrainingEndTimestamp: number;
  finalTestStartTimestamp: number;
  finalTestEndTimestamp: number;
  folds: WalkForwardFold[];
  finalCandidateValue: number;
  finalTrainingResultId: string;
  finalTestResultId: string;
  finalTrainingMetrics: BacktestMetrics;
  finalTestMetrics: BacktestMetrics;
}

export interface BacktestSweepResult {
  sweepId: string;
  /** Absent on older records; they are interpreted as full-sample sweeps. */
  mode?: "full-sample" | "walk-forward";
  exchange: ExchangeId;
  symbol: string;
  timeframe: Timeframe;
  strategyId: string;
  strategyVersion: string;
  engineVersion: string;
  parameter: string;
  values: number[];
  /** Absent means legacy input-only IDs; reruns compare the full saved outputs. */
  outcomeVersion?: 2;
  runs: Array<{ value: number; resultId: string; outcomeId: string; metrics: BacktestMetrics; segment?: { start: number; end: number; datasetId: string; reproduction: ResearchReproduction } }>;
  parameters: StrategyParameters;
  config: BacktestConfig;
  datasetId: string;
  bars: number;
  createdAt: string;
  reproduction: ResearchReproduction;
  rerunOf?: string;
  walkForward?: WalkForwardReport;
}

export interface BacktestResult {
  /** Absent on legacy records: those inputs are not reproducible. */
  reproduction?: ResearchReproduction;
  rerunOf?: string;
  resultId: string;
  datasetId: string;
  /** Which venue the dataset came from. Without this a result cannot be
   *  replayed, compared, or re-run against its own source. */
  exchange: ExchangeId;
  symbol: string;
  timeframe: Timeframe;
  strategyId: string;
  strategyVersion: string;
  parameters: StrategyParameters;
  assumptions: BacktestConfig;
  /** Absent on historical records; never infer a current policy for those outputs. */
  executionPolicy?: typeof import("./policy.js").SPOT_EXECUTION_POLICY | typeof import("./policy.js").LEGACY_MARGIN_EXECUTION_POLICY;
  execution: BacktestExecutionAssumptions;
  engineVersion: string;
  createdAt: string;
  metrics: BacktestMetrics;
  equityCurve: EquityPoint[];
  trades: BacktestTrade[];
  signals: Array<{ timestamp: number; side: MarketSide }>;
  /** Optional for results created before persistent candle caching. */
  candleSource?: "live" | "local-cache";
  candleCache?: { fallback: boolean; cachedAt: string | null };
}

export interface WorkspaceLayout {
  watchlistWidth: number;
  inspectorWidth: number;
  bottomHeight: number;
}

export interface WorkspaceState {
  symbol: string;
  timeframe: Timeframe;
  exchange: ExchangeId;
  mode: "paper";
  /** Research absorbed the former Backtest workspace: one system for studying a
   *  strategy, holding both its parameters and its run results. */
  activeWorkspace: "terminal" | "research" | "replay";
  selectedStrategyId: string;
  activeBacktestId: string | null;
  activeReplayId: string | null;
  visibleRange: { from: number | null; to: number | null };
  layout: WorkspaceLayout;
}

export interface ReplaySession {
  id: string;
  /** The venue this session's bars came from. The step endpoint re-fetches by
   *  id, so without it a session would silently continue on the default venue. */
  exchange: ExchangeId;
  symbol: string;
  timeframe: Timeframe;
  startAt: number;
  cursor: number;
  bars: Candle[];
  /** Provenance for a seed or any later step served from the local candle cache. */
  candleSource?: "live" | "local-cache";
  candleCache?: { fallback: boolean; cachedAt: string | null };
  status: "active" | "finished";
  createdAt: string;
  updatedAt: string;
}

export interface OrderPreview {
  id: string;
  exchange?: ExchangeId | null;
  accountId?: string | null;
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
  layout: { watchlistWidth: 210, inspectorWidth: 320, bottomHeight: 190 },
};

export const BACKTEST_EXECUTION_ASSUMPTIONS: BacktestExecutionAssumptions = {
  signalTiming: "Evaluated after each completed bar close using only the prefix through that bar.",
  fillTiming: "Signals fill at the next bar open with adverse side-aware slippage; no same-close fills.",
  intrabarStops: "Opening gaps execute before opening signals; intrabar protection follows opening orders. Stop wins ambiguous ranges. Entry-bar targets are deferred; entry-bar stops remain active. Adverse slippage and quote fees apply.",
  endOfData: "Any open position is closed at the final bar close with adverse slippage and fee.",
  sharpeMethod: "Sample standard deviation of bar-to-bar marked-equity returns; annualized by square root of 365.25 days divided by the median observed bar duration; no risk-free rate.",
};
