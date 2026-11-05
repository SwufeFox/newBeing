"use client";

import { memo, useCallback, useEffect, useRef, useState } from "react";
import { AreaSeries, ColorType, createChart, type UTCTimestamp } from "lightweight-charts";
import { AlertCircle, ArrowDownRight, ArrowUpRight, Boxes, Clock3, FileDown, FileText, FlaskConical, ListChecks, RotateCcw, ScanSearch, Wallet, Filter } from "lucide-react";
import { STRATEGIES, type BacktestResult, type ExchangeId, type PaperOrder, type PaperPortfolio, type ReplaySession } from "@newbeing/core";
import type { ExperimentSummary } from "@newbeing/storage";
import { SweepPanel } from "@/components/sweep-panel";
import { EvaluationPanel } from "@/components/evaluation-panel";
import { Button } from "@/components/ui/button";
import { EXCHANGE_LABELS } from "@/lib/exchanges";
import { useCopy, translate, type CopyTable } from "@/lib/i18n";
import { captureWorkspaceSelection } from "@/lib/workspace-selection";
import { buildResearchReport, researchReportFilename } from "@/lib/research-report";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useShallow } from "zustand/react/shallow";
import { useWorkspaceStore } from "@/store/workspace";
import { AkTag, AkNotice, AkNum, AkButton, AkProgress, AkSpinner, AkCountUp } from "@swufefox/ak-ui-react";

/** Format an amount in the symbol's own quote currency */
function money(value: number, currency = "USDT"): string {
  if (!Number.isFinite(value)) return `— ${currency}`;
  return `${value < 0 ? "−" : ""}${Math.abs(value).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${currency}`;
}

function percentage(value: number): string {
  if (!Number.isFinite(value)) return "—";
  return `${value >= 0 ? "+" : "−"}${(Math.abs(value) * 100).toFixed(2)}%`;
}

function timestamp(value: number): string {
  return new Date(value).toLocaleString([], { month: "short", day: "2-digit", hour: "2-digit", minute: "2-digit" });
}

interface DockCopy {
  asset: string;
  size: string;
  avgEntry: string;
  markPrice: string;
  unrealizedPnl: string;
  realizedPnl: string;
  available: string;
  action: string;
  replayClose: string;
  staleNotice: string;
  stalePending: string;
  selectSymbol: (symbol: string) => string;
  closeBlockedPending: string;
  closeBlockedRefresh: string;
  closeMarketTitle: string;
  closing: string;
  orderPending: string;
  refreshRequired: string;
  closePosition: string;
  noOpenPosition: (asset: string | undefined) => string;
  closeHttpAfterFill: (status: number) => string;
  closeRefreshUnavailable: (detail: string) => string;
  closeRefreshMissing: string;
  closeStatusInspect: (status: string) => string;
  closeStatusSettled: (status: string) => string;
  closeUnknownRetry: string;
  closeRefreshFailed: string;
  closeUnconfirmed: (detail: string) => string;
  closeUnconfirmedPlain: string;
  accountUnavailable: string;
  noReplayAccount: string;
  startReplayHint: string;
  noOrders: string;
  ordersHint: string;
  time: string;
  symbol: string;
  side: string;
  quantity: string;
  status: string;
  fillPrice: string;
  clientOrderId: string;
  copyOrderId: string;
  copied: string;
  orderSide: Record<PaperOrder["side"], string>;
  orderStatus: Record<PaperOrder["status"], string>;
  noBacktest: string;
  noBacktestHint: string;
  openStrategyLab: string;
  noTrades: string;
  noLongTrades: string;
  noShortTrades: string;
  noWinTrades: string;
  noLossTrades: string;
  noFilterTrades: string;
  totalReturn: string;
  maxDrawdown: string;
  sharpeRatio: string;
  winRate: string;
  profitFactor: string;
  totalTrades: string;
  equityCurve: (quote: string | undefined) => string;
  costs: (fee: string, slippage: string) => string;
  nextBarOpen: string;
  localCache: string;
  exportHint: string;
  exportReport: string;
  rerunBacktest: string;
  startingReplay: string;
  continueReplay: string;
  continueReplayHint: string;
  tradeHeading: (count: number) => string;
  filters: Record<"all" | "long" | "short" | "win" | "loss", string>;
  showAllTrades: string;
  entryUtc: string;
  entry: string;
  exitUtc: string;
  exit: string;
  netPnl: string;
  fees: string;
  reason: string;
  tradeSide: Record<"long" | "short", string>;
  exitReason: Record<"signal" | "stop-loss" | "take-profit" | "end-of-data", string>;
  provenance: (resultId: string, dataset: string, created: string) => string;
  rerunFailed: (status: number) => string;
  rerunInvalid: string;
  rerunFailedPlain: string;
  historyUnavailable: string;
  historyLoadFailed: string;
  selectedUnavailable: string;
  comparisonLoadFailed: string;
  historyUnavailableTitle: string;
  retrying: string;
  retry: string;
  loadingRuns: string;
  noExperiments: string;
  checkingHistory: string;
  storedLocally: string;
  refreshing: string;
  refresh: string;
  savedRuns: (count: number) => string;
  select: string;
  created: string;
  strategy: string;
  headerReturn: string;
  headerMaxDd: string;
  headerTrades: string;
  resultId: string;
  selectForCompare: (resultId: string) => string;
  openResult: (resultId: string) => string;
  open: string;
  runsSelected: (count: number) => string;
  selectAtLeastTwo: string;
  selectOneMore: string;
  compareHint: string;
  loadingResults: string;
  compareSelected: string;
  comparisonLabel: string;
  notComparable: string;
  comparableGroup: (venue: string, symbol: string, timeframe: string) => string;
  comparableGroupPlain: string;
  incomparable: (ids: string) => string;
  groupedHint: string;
  headerStrategyId: string;
  headerTotalReturn: string;
  headerMaxDrawdown: string;
  headerSharpe: string;
  headerWinRate: string;
  tabPositions: string;
  tabOrders: string;
  tabResults: string;
  tabSweep: string;
  tabEvaluate: string;
  tabExperiments: string;
  tabExecution: string;
  modeReplay: string;
  modePaper: string;
  ordersUnavailable: string;
  loadingOrders: string;
  loadingOrdersHint: string;
  replayHistoryHidden: string;
  replayHistoryHiddenHint: string;
  replayBacktestHidden: string;
  replayBacktestHiddenHint: string;
  replaySweepsHidden: string;
  replaySweepsHiddenHint: string;
  replayEvaluationsHidden: string;
  replayEvaluationsHiddenHint: string;
  logLocal: string;
  logSafetyBoundary: string;
  logSafetyBody: string;
  logData: string;
  logMarketData: string;
  logMarketDataBody: (venue: string) => string;
  resultLoadFailed: string;
  resultLoadFallback: string;
  paperLoadFailed: string;
  paperUnavailable: string;
}

/* Dock copy. Symbols, venues, timeframes, units and engine identifiers stay
   literal: only the words around them translate. */
const DOCK_COPY: CopyTable<DockCopy> = {
  en: {
    asset: "ASSET",
    size: "SIZE",
    avgEntry: "AVG ENTRY",
    markPrice: "MARK PRICE",
    unrealizedPnl: "UNREALIZED PNL",
    realizedPnl: "REALIZED PNL",
    available: "AVAILABLE",
    action: "ACTION",
    replayClose: "REPLAY CLOSE",
    staleNotice: "STALE · Showing last account snapshot; mark price may be delayed.",
    stalePending: "Refresh the account or resolve its pending Paper order before another close.",
    selectSymbol: (symbol) => `Select ${symbol}`,
    closeBlockedPending: "Resolve the pending Paper order before another close.",
    closeBlockedRefresh: "Wait for a fresh Paper account snapshot before retrying.",
    closeMarketTitle: "Liquidate/close position at market",
    closing: "Closing…",
    orderPending: "Order pending",
    refreshRequired: "Refresh required",
    closePosition: "Close",
    noOpenPosition: (asset) => `No open Paper position for ${asset}.`,
    closeHttpAfterFill: (status) => `Paper close returned HTTP ${status} after the order filled.`,
    closeRefreshUnavailable: (detail) => `${detail} Refreshed order history is unavailable; the confirmed portfolio is shown.`,
    closeRefreshMissing: "Paper close filled, but refreshed order history is unavailable. The confirmed portfolio is shown; check order history before continuing.",
    closeStatusInspect: (status) => `Paper close order is ${status}. Inspect its saved status before retrying.`,
    closeStatusSettled: (status) => `Paper close order is ${status}. The latest account and order state is shown.`,
    closeUnknownRetry: "Paper close outcome is unknown. Refresh account state before retrying.",
    closeRefreshFailed: "Paper close filled, but refreshed order history could not be loaded. The confirmed portfolio is shown.",
    closeUnconfirmed: (detail) => `Paper close outcome could not be confirmed: ${detail}. Refresh account state before another close.`,
    closeUnconfirmedPlain: "Paper close outcome could not be confirmed. Refresh account state before another close.",
    accountUnavailable: "Paper account unavailable.",
    noReplayAccount: "No replay account loaded",
    startReplayHint: "Start a historical replay to create its isolated account.",
    noOrders: "No simulated orders yet",
    ordersHint: "Paper orders will appear here with their client IDs and state.",
    time: "TIME",
    symbol: "SYMBOL",
    side: "SIDE",
    quantity: "QUANTITY",
    status: "STATUS",
    fillPrice: "FILL PRICE",
    clientOrderId: "CLIENT ORDER ID",
    copyOrderId: "Click to copy order ID",
    copied: "COPIED",
    orderSide: { buy: "BUY", sell: "SELL" },
    orderStatus: { created: "created", submitted: "submitted", filled: "filled", rejected: "rejected", cancelled: "cancelled", unknown: "unknown" },
    noBacktest: "No backtest selected",
    noBacktestHint: "Configure a strategy in the Strategy Lab, then execute a deterministic historical run on any supported venue.",
    openStrategyLab: "Open Strategy Lab",
    noTrades: "No trades were generated by this backtest.",
    noLongTrades: "No long trades match this filter.",
    noShortTrades: "No short trades match this filter.",
    noWinTrades: "No winning trades match this filter.",
    noLossTrades: "No losing trades match this filter.",
    noFilterTrades: "No trades match this filter.",
    totalReturn: "TOTAL RETURN",
    maxDrawdown: "MAX DRAWDOWN",
    sharpeRatio: "SHARPE RATIO",
    winRate: "WIN RATE",
    profitFactor: "PROFIT FACTOR",
    totalTrades: "TOTAL TRADES",
    equityCurve: (quote) => `EQUITY CURVE · ${quote}`,
    costs: (fee, slippage) => `Fee ${fee} bps · Slippage ${slippage} bps`,
    nextBarOpen: "Next-bar open",
    localCache: "LOCAL CANDLE CACHE",
    exportHint: "Download a versioned research report: provenance, assumptions, metrics, trades and equity curve.",
    exportReport: "Export report",
    rerunBacktest: "Rerun backtest",
    startingReplay: "Starting replay…",
    continueReplay: "Continue to Replay",
    continueReplayHint: "Continue to Replay from the final equity point of this backtest.",
    tradeHeading: (count) => `SIMULATED EXECUTION TRADES (${count})`,
    filters: { all: "all", long: "long", short: "short", win: "win", loss: "loss" },
    showAllTrades: "Show all trades",
    entryUtc: "ENTRY UTC",
    entry: "ENTRY",
    exitUtc: "EXIT UTC",
    exit: "EXIT",
    netPnl: "NET PNL",
    fees: "FEES",
    reason: "REASON",
    tradeSide: { long: "LONG", short: "SHORT" },
    exitReason: { signal: "signal", "stop-loss": "stop-loss", "take-profit": "take-profit", "end-of-data": "end-of-data" },
    provenance: (resultId, dataset, created) => `Result ID: ${resultId} · Dataset: ${dataset} · Created: ${created}`,
    rerunFailed: (status) => `Backtest rerun failed (${status}).`,
    rerunInvalid: "Backtest rerun returned an invalid result.",
    rerunFailedPlain: "Backtest rerun failed.",
    historyUnavailable: "Experiment history is unavailable.",
    historyLoadFailed: "History load failed.",
    selectedUnavailable: "A selected result could not be loaded.",
    comparisonLoadFailed: "Comparison could not be loaded.",
    historyUnavailableTitle: "History unavailable",
    retrying: "Retrying…",
    retry: "Retry",
    loadingRuns: "Loading saved runs…",
    noExperiments: "No saved experiments",
    checkingHistory: "Checking local history.",
    storedLocally: "Each completed backtest is stored in local SQLite.",
    refreshing: "Refreshing…",
    refresh: "Refresh",
    savedRuns: (count) => `${count} saved run${count === 1 ? "" : "s"} · newest first`,
    select: "SELECT",
    created: "CREATED",
    strategy: "STRATEGY",
    headerReturn: "RETURN",
    headerMaxDd: "MAX DD",
    headerTrades: "TRADES",
    resultId: "RESULT ID",
    selectForCompare: (resultId) => `Select ${resultId} for comparison`,
    openResult: (resultId) => `Open result ${resultId}`,
    open: "Open",
    runsSelected: (count) => `${count} ${count === 1 ? "run" : "runs"} selected`,
    selectAtLeastTwo: "Select at least 2 runs to compare.",
    selectOneMore: "Select one more run to compare.",
    compareHint: "Compare runs from the same data snapshot, venue, symbol, timeframe, engine version, and fixed assumptions.",
    loadingResults: "Loading results…",
    compareSelected: "Compare selected",
    comparisonLabel: "Backtest comparison",
    notComparable: "Selected results are not comparable",
    comparableGroup: (venue, symbol, timeframe) => `Comparable group · ${venue} · ${symbol} · ${timeframe}`,
    comparableGroupPlain: "Comparable group",
    incomparable: (ids) => `Cannot compare the selected results: they must share a known dataset, venue, symbol, timeframe, engine version, and fixed assumptions. Selected result IDs: ${ids}.`,
    groupedHint: "Results are grouped by venue, symbol, timeframe, engine version, and fixed assumptions.",
    headerStrategyId: "STRATEGY / ID",
    headerTotalReturn: "TOTAL RETURN",
    headerMaxDrawdown: "MAX DRAWDOWN",
    headerSharpe: "SHARPE",
    headerWinRate: "WIN RATE",
    tabPositions: "Positions",
    tabOrders: "Orders",
    tabResults: "Results",
    tabSweep: "Sweep",
    tabEvaluate: "Evaluate",
    tabExperiments: "Experiments",
    tabExecution: "Execution",
    modeReplay: "REPLAY · ISOLATED SIMULATION",
    modePaper: "LOCAL SQLITE · PAPER TRADING",
    ordersUnavailable: "Orders unavailable",
    loadingOrders: "Loading Paper orders…",
    loadingOrdersHint: "The local account snapshot is being read.",
    replayHistoryHidden: "Experiment history hidden during replay",
    replayHistoryHiddenHint: "Future-derived results are strictly hidden.",
    replayBacktestHidden: "Backtest metrics suppressed",
    replayBacktestHiddenHint: "Only bars through the replay cursor are revealed.",
    replaySweepsHidden: "Saved sweeps hidden during Replay",
    replaySweepsHiddenHint: "Saved sweep history and new sweeps are hidden to avoid future-derived results.",
    replayEvaluationsHidden: "Evaluations suppressed during replay",
    replayEvaluationsHiddenHint: "The holdout window is future data.",
    logLocal: "LOCAL",
    logSafetyBoundary: "Safety Boundary",
    logSafetyBody: "Real exchange execution endpoints are disabled; system operates strictly in local deterministic simulation.",
    logData: "DATA",
    logMarketData: "Market Data",
    logMarketDataBody: (venue) => `${venue} live REST feeds + local SQLite persistent candle cache.`,
    resultLoadFailed: "Backtest result could not be loaded.",
    resultLoadFallback: "Could not load result.",
    paperLoadFailed: "Paper account could not be loaded.",
    paperUnavailable: "Paper data unavailable.",
  },
  zh: {
    asset: "资产",
    size: "规模",
    avgEntry: "开仓均价",
    markPrice: "标记价",
    unrealizedPnl: "未实现盈亏",
    realizedPnl: "已实现盈亏",
    available: "可用",
    action: "操作",
    replayClose: "回放收盘",
    staleNotice: "已过期 · 显示上次账户快照，标记价可能延迟。",
    stalePending: "再次平仓前请刷新账户或处理未完成的模拟盘委托。",
    selectSymbol: (symbol) => `选择 ${symbol}`,
    closeBlockedPending: "请先处理未完成的模拟盘委托，再执行平仓。",
    closeBlockedRefresh: "请等待新的模拟盘账户快照后再重试。",
    closeMarketTitle: "以市价平仓",
    closing: "平仓中…",
    orderPending: "委托未完成",
    refreshRequired: "需刷新",
    closePosition: "平仓",
    noOpenPosition: (asset) => `${asset} 无未平仓的模拟盘持仓。`,
    closeHttpAfterFill: (status) => `委托成交后平仓返回 HTTP ${status}。`,
    closeRefreshUnavailable: (detail) => `${detail} 刷新后的委托历史不可用；当前显示已确认的账户。`,
    closeRefreshMissing: "平仓已成交，但刷新后的委托历史不可用。当前显示已确认的账户；继续操作前请检查委托历史。",
    closeStatusInspect: (status) => `平仓委托状态为 ${status}。重试前请检查其已保存状态。`,
    closeStatusSettled: (status) => `平仓委托状态为 ${status}。已显示最新的账户与委托状态。`,
    closeUnknownRetry: "平仓结果未知。重试前请刷新账户状态。",
    closeRefreshFailed: "平仓已成交，但刷新后的委托历史无法加载。当前显示已确认的账户。",
    closeUnconfirmed: (detail) => `无法确认平仓结果：${detail}。再次平仓前请刷新账户状态。`,
    closeUnconfirmedPlain: "无法确认平仓结果。再次平仓前请刷新账户状态。",
    accountUnavailable: "模拟盘账户不可用。",
    noReplayAccount: "未加载回放账户",
    startReplayHint: "启动历史回放以创建其独立账户。",
    noOrders: "暂无模拟盘委托",
    ordersHint: "模拟盘委托将在此显示客户端单号与状态。",
    time: "时间",
    symbol: "标的",
    side: "方向",
    quantity: "数量",
    status: "状态",
    fillPrice: "成交价",
    clientOrderId: "客户端单号",
    copyOrderId: "点击复制委托号",
    copied: "已复制",
    orderSide: { buy: "买入", sell: "卖出" },
    orderStatus: { created: "已创建", submitted: "已提交", filled: "已成交", rejected: "已拒绝", cancelled: "已取消", unknown: "未知" },
    noBacktest: "未选择回测",
    noBacktestHint: "在策略实验室配置策略，然后在任一支持的交易所执行确定性历史运行。",
    openStrategyLab: "打开策略实验室",
    noTrades: "本次回测未产生交易。",
    noLongTrades: "此筛选下没有做多交易。",
    noShortTrades: "此筛选下没有做空交易。",
    noWinTrades: "此筛选下没有盈利交易。",
    noLossTrades: "此筛选下没有亏损交易。",
    noFilterTrades: "此筛选下没有交易。",
    totalReturn: "总收益",
    maxDrawdown: "最大回撤",
    sharpeRatio: "夏普比率",
    winRate: "胜率",
    profitFactor: "盈利因子",
    totalTrades: "总交易数",
    equityCurve: (quote) => `权益曲线 · ${quote}`,
    costs: (fee, slippage) => `费率 ${fee} bps · 滑点 ${slippage} bps`,
    nextBarOpen: "下一根开盘",
    localCache: "本地 K 线缓存",
    exportHint: "下载带版本的研究报告：来源、假设、指标、交易与权益曲线。",
    exportReport: "导出报告",
    rerunBacktest: "重跑回测",
    startingReplay: "正在启动回放…",
    continueReplay: "继续回放",
    continueReplayHint: "从本次回测的最终权益点继续回放。",
    tradeHeading: (count) => `模拟成交记录 (${count})`,
    filters: { all: "全部", long: "做多", short: "做空", win: "盈利", loss: "亏损" },
    showAllTrades: "显示全部交易",
    entryUtc: "开仓 UTC",
    entry: "开仓价",
    exitUtc: "平仓 UTC",
    exit: "平仓价",
    netPnl: "净盈亏",
    fees: "手续费",
    reason: "原因",
    tradeSide: { long: "做多", short: "做空" },
    exitReason: { signal: "信号", "stop-loss": "止损", "take-profit": "止盈", "end-of-data": "数据结束" },
    provenance: (resultId, dataset, created) => `结果 ID: ${resultId} · 数据集: ${dataset} · 创建: ${created}`,
    rerunFailed: (status) => `回测重跑失败（${status}）。`,
    rerunInvalid: "回测重跑返回了无效结果。",
    rerunFailedPlain: "回测重跑失败。",
    historyUnavailable: "实验历史不可用。",
    historyLoadFailed: "历史加载失败。",
    selectedUnavailable: "无法加载所选结果。",
    comparisonLoadFailed: "无法加载对比。",
    historyUnavailableTitle: "历史不可用",
    retrying: "重试中…",
    retry: "重试",
    loadingRuns: "正在加载已保存运行…",
    noExperiments: "暂无已保存的实验",
    checkingHistory: "正在检查本地历史。",
    storedLocally: "每次完成的回测都会存入本地 SQLite。",
    refreshing: "刷新中…",
    refresh: "刷新",
    savedRuns: (count) => `${count} 个已保存运行 · 最新优先`,
    select: "选择",
    created: "创建",
    strategy: "策略",
    headerReturn: "收益",
    headerMaxDd: "最大回撤",
    headerTrades: "交易数",
    resultId: "结果 ID",
    selectForCompare: (resultId) => `选择 ${resultId} 用于对比`,
    openResult: (resultId) => `打开结果 ${resultId}`,
    open: "打开",
    runsSelected: (count) => `已选 ${count} 个运行`,
    selectAtLeastTwo: "至少选择 2 个运行进行对比。",
    selectOneMore: "再选择 1 个运行进行对比。",
    compareHint: "对比同一数据快照、交易所、标的、周期、引擎版本与固定假设的运行。",
    loadingResults: "正在加载结果…",
    compareSelected: "对比所选",
    comparisonLabel: "回测对比",
    notComparable: "所选结果不可对比",
    comparableGroup: (venue, symbol, timeframe) => `可比分组 · ${venue} · ${symbol} · ${timeframe}`,
    comparableGroupPlain: "可比分组",
    incomparable: (ids) => `无法对比所选结果：它们必须共享已知数据集、交易所、标的、周期、引擎版本与固定假设。所选结果 ID: ${ids}。`,
    groupedHint: "结果按交易所、标的、周期、引擎版本与固定假设分组。",
    headerStrategyId: "策略 / ID",
    headerTotalReturn: "总收益",
    headerMaxDrawdown: "最大回撤",
    headerSharpe: "夏普",
    headerWinRate: "胜率",
    tabPositions: "持仓",
    tabOrders: "委托",
    tabResults: "结果",
    tabSweep: "参数扫描",
    tabEvaluate: "验证",
    tabExperiments: "实验",
    tabExecution: "执行",
    modeReplay: "回放 · 隔离模拟",
    modePaper: "本地 SQLITE · 模拟盘",
    ordersUnavailable: "委托不可用",
    loadingOrders: "正在加载模拟盘委托…",
    loadingOrdersHint: "正在读取本地账户快照。",
    replayHistoryHidden: "回放期间隐藏实验历史",
    replayHistoryHiddenHint: "未来派生的结果被严格隐藏。",
    replayBacktestHidden: "回测指标已隐藏",
    replayBacktestHiddenHint: "只显示回放游标之前的 K 线。",
    replaySweepsHidden: "回放期间隐藏已保存的参数扫描",
    replaySweepsHiddenHint: "为避免未来派生结果，已保存的扫描历史与新扫描均被隐藏。",
    replayEvaluationsHidden: "回放期间隐藏验证",
    replayEvaluationsHiddenHint: "留出集窗口属于未来数据。",
    logLocal: "本地",
    logSafetyBoundary: "安全边界",
    logSafetyBody: "真实交易所执行端点已禁用；系统严格在本地确定性模拟中运行。",
    logData: "数据",
    logMarketData: "行情数据",
    logMarketDataBody: (venue) => `${venue} 实时 REST 行情 + 本地 SQLite K 线缓存。`,
    resultLoadFailed: "回测结果无法加载。",
    resultLoadFallback: "无法加载结果。",
    paperLoadFailed: "模拟盘账户无法加载。",
    paperUnavailable: "模拟盘数据不可用。",
  },
};

function EquityChart({ result }: { result: BacktestResult }): React.JSX.Element {
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const container = root.current;
    if (!container || result.equityCurve.length === 0) return;
    const chart = createChart(container, {
      autoSize: false,
      width: container.clientWidth,
      height: container.clientHeight,
      layout: { background: { type: ColorType.Solid, color: "transparent" }, textColor: "#87909a", fontSize: 10 },
      grid: { vertLines: { visible: false }, horzLines: { color: "rgba(139,148,158,.08)" } },
      rightPriceScale: { borderVisible: false },
      timeScale: { visible: false, borderVisible: false },
      crosshair: { vertLine: { visible: false }, horzLine: { visible: false } },
    });
    const isUp = result.metrics.finalEquity >= result.metrics.initialCapital;
    const series = chart.addSeries(AreaSeries, {
      lineColor: isUp ? "#1fb180" : "#ea525e",
      topColor: isUp ? "rgba(31,177,128,.25)" : "rgba(234,82,94,.25)",
      bottomColor: isUp ? "rgba(31,177,128,.02)" : "rgba(234,82,94,.02)",
      lineWidth: 2,
      priceLineVisible: false,
      lastValueVisible: true,
    });
    series.setData(result.equityCurve.map((point) => ({ time: Math.floor(point.timestamp / 1000) as UTCTimestamp, value: point.equity })));
    chart.timeScale().fitContent();
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (entry) chart.applyOptions({ width: Math.max(1, Math.floor(entry.contentRect.width)), height: Math.max(1, Math.floor(entry.contentRect.height)) });
    });
    observer.observe(container);
    return () => { observer.disconnect(); chart.remove(); };
  }, [result]);

  return <div className="equity-chart w-full h-full" ref={root} />;
}

interface PaperPayload {
  portfolio: PaperPortfolio;
  orders: PaperOrder[];
}
function isPaperOrder(value: unknown): value is PaperOrder {
  if (typeof value !== "object" || value === null) return false;
  const order = value as Partial<PaperOrder>;
  return typeof order.clientOrderId === "string"
    && typeof order.symbol === "string"
    && (order.side === "buy" || order.side === "sell")
    && typeof order.quantity === "number" && Number.isFinite(order.quantity)
    && ["created", "submitted", "filled", "rejected", "cancelled", "unknown"].includes(order.status ?? "")
    && (order.fillPrice === null || (typeof order.fillPrice === "number" && Number.isFinite(order.fillPrice)))
    && typeof order.fee === "number" && Number.isFinite(order.fee)
    && typeof order.createdAt === "string";
}

function isPaperPortfolio(value: unknown): value is PaperPortfolio {
  if (typeof value !== "object" || value === null) return false;
  const portfolio = value as Partial<PaperPortfolio>;
  return typeof portfolio.quoteBalance === "number" && Number.isFinite(portfolio.quoteBalance)
    && typeof portfolio.baseBalance === "number" && Number.isFinite(portfolio.baseBalance)
    && (portfolio.averageEntryPrice === null || (typeof portfolio.averageEntryPrice === "number" && Number.isFinite(portfolio.averageEntryPrice)))
    && typeof portfolio.realizedPnl === "number" && Number.isFinite(portfolio.realizedPnl)
    && typeof portfolio.feeRate === "number" && Number.isFinite(portfolio.feeRate);
}


function PaperPositions({ symbol, exchange, markPrice, quoteStale }: { symbol: string; exchange: ExchangeId; markPrice: number | null; quoteStale: boolean }): React.JSX.Element {
  const copy = useCopy(DOCK_COPY);
  const [payload, setPayload] = useState<PaperPayload | null>(null);
  const [accountStale, setAccountStale] = useState(false);
  const [closing, setClosing] = useState(false);
  const [closeError, setCloseError] = useState<string | null>(null);
  const [closeNeedsRefresh, setCloseNeedsRefresh] = useState(false);
  const closeAttemptRef = useRef(0);
  const closeInFlightRef = useRef(false);
  const closeClientOrderIdRef = useRef<string | null>(null);
  useEffect(() => {
    let disposed = false;
    const refresh = async (): Promise<void> => {
      const refreshAttempt = closeAttemptRef.current;
      try {
        /* The terminal already polls this symbol's quote; reuse it instead of
           issuing a second upstream ticker request every eight seconds. */
        const accountResponse = await fetch(`/api/paper?symbol=${encodeURIComponent(symbol)}&exchange=${exchange}`, { cache: "no-store" });
        const account: unknown = await accountResponse.json();
        if (disposed || refreshAttempt !== closeAttemptRef.current || closeInFlightRef.current) return;
        if (!accountResponse.ok || typeof account !== "object" || account === null || !("portfolio" in account) || !("orders" in account)) throw new Error(translate(DOCK_COPY).accountUnavailable);
        const freshPayload = account as PaperPayload;
        setPayload(freshPayload);
        if (!freshPayload.orders.some((order) => order.status === "created" || order.status === "submitted" || order.status === "unknown")) closeClientOrderIdRef.current = null;
        setCloseNeedsRefresh(false);
        setAccountStale(false);
      } catch {
        if (!disposed && refreshAttempt === closeAttemptRef.current) setAccountStale(true);
      }
    };
    void refresh();
    const timer = window.setInterval(() => { if (typeof document !== "undefined" && !document.hidden) void refresh(); }, 8_000);
    return () => { disposed = true; window.clearInterval(timer); };
  }, [symbol, exchange]);
  const stale = accountStale || quoteStale;

  if (!payload) {
    return (
      <div className="position-table-wrap p-2 font-mono text-xs">
        <div className="overflow-auto border border-[var(--ak-border-subtle)] opacity-50 animate-pulse motion-reduce:animate-none">
          <table className="data-table w-full text-left">
            <thead>
              <tr className="bg-[var(--ak-surface-sunken)] border-b border-[var(--ak-border-subtle)] text-[10px] text-[var(--ak-text-secondary)] uppercase">
                <th className="p-2">{copy.asset}</th>
                <th className="p-2">{copy.size}</th>
                <th className="p-2">{copy.avgEntry}</th>
                <th className="p-2">{copy.markPrice}</th>
                <th className="p-2">{copy.unrealizedPnl}</th>
                <th className="p-2">{copy.realizedPnl}</th>
                <th className="p-2">{copy.available}</th>
              </tr>
            </thead>
            <tbody>
              <tr className="border-b border-[var(--ak-border-subtle)]">
                <td className="p-2"><span className="inline-block w-16 h-3.5 bg-[var(--ak-surface-raised)] rounded-[2px]" /></td>
                <td className="p-2"><span className="inline-block w-12 h-3.5 bg-[var(--ak-surface-raised)] rounded-[2px]" /></td>
                <td className="p-2"><span className="inline-block w-14 h-3.5 bg-[var(--ak-surface-raised)] rounded-[2px]" /></td>
                <td className="p-2"><span className="inline-block w-14 h-3.5 bg-[var(--ak-surface-raised)] rounded-[2px]" /></td>
                <td className="p-2"><span className="inline-block w-16 h-3.5 bg-[var(--ak-surface-raised)] rounded-[2px]" /></td>
                <td className="p-2"><span className="inline-block w-16 h-3.5 bg-[var(--ak-surface-raised)] rounded-[2px]" /></td>
                <td className="p-2"><span className="inline-block w-20 h-3.5 bg-[var(--ak-surface-raised)] rounded-[2px]" /></td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    );
  }
  const closePosition = async (): Promise<void> => {
    if (!payload || payload.portfolio.baseBalance <= 0 || closeNeedsRefresh || hasUnresolvedPaperOrder) return;
    closeAttemptRef.current += 1;
    closeInFlightRef.current = true;
    setClosing(true);
    setCloseError(null);
    let closeWasFilled = false;
    try {
      const clientOrderId = closeClientOrderIdRef.current ?? `close-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      closeClientOrderIdRef.current = clientOrderId;
      const response = await fetch("/api/paper", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          clientOrderId,
          symbol,
          side: "sell",
          quantity: payload.portfolio.baseBalance,
          mode: "paper",
          exchange,
        }),
      });
      const responsePayload: unknown = await response.json();
      const responseBody = typeof responsePayload === "object" && responsePayload !== null
        ? responsePayload as { order?: PaperOrder; portfolio?: PaperPortfolio; error?: string }
        : null;
      const responseErrorMessage = typeof responseBody?.error === "string" ? responseBody.error : null;
      const order = responseBody?.order;
      const portfolio = responseBody?.portfolio;
      const savedOrder = isPaperOrder(order) ? order : null;
      const savedPortfolio = isPaperPortfolio(portfolio) ? portfolio : null;
      if (savedOrder && savedPortfolio) {
        setPayload((current) => current ? {
          portfolio: savedPortfolio,
          orders: [savedOrder, ...current.orders.filter((currentOrder) => currentOrder.clientOrderId !== savedOrder.clientOrderId)].slice(0, 30),
        } : current);
      }
      if (savedOrder?.status === "filled" && savedPortfolio) {
        closeWasFilled = true;
        closeClientOrderIdRef.current = null;
        const responseError = response.ok ? null : responseErrorMessage ?? copy.closeHttpAfterFill(response.status);
        setCloseError(responseError);
        const refreshResponse = await fetch(`/api/paper?symbol=${encodeURIComponent(symbol)}&exchange=${exchange}`, { cache: "no-store" });
        const account: unknown = await refreshResponse.json();
        if (refreshResponse.ok && typeof account === "object" && account !== null && "portfolio" in account && "orders" in account) {
          setPayload(account as PaperPayload);
          setCloseNeedsRefresh(false);
          setCloseError(responseError);
        } else {
          setCloseError(responseErrorMessage
            ? copy.closeRefreshUnavailable(responseErrorMessage)
            : copy.closeRefreshMissing);
        }
        return;
      }
      const status = savedOrder?.status;
      const statusMessage = status === "created" || status === "submitted" || status === "unknown"
        ? copy.closeStatusInspect(copy.orderStatus[status])
        : status
          ? copy.closeStatusSettled(copy.orderStatus[status])
          : copy.closeUnknownRetry;
      if (!response.ok || !savedOrder || !savedPortfolio || status === "created" || status === "submitted" || status === "unknown") {
        setCloseNeedsRefresh(true);
        setCloseError(responseErrorMessage ?? statusMessage);
        return;
      }
      closeClientOrderIdRef.current = null;
      setCloseNeedsRefresh(false);
      setCloseError(responseErrorMessage ?? statusMessage);
    } catch (reason) {
      if (closeWasFilled) {
        setCloseError(copy.closeRefreshFailed);
      } else {
        setCloseNeedsRefresh(true);
        setCloseError(reason instanceof Error
          ? copy.closeUnconfirmed(reason.message)
          : copy.closeUnconfirmedPlain);
      }
    } finally {
      closeInFlightRef.current = false;
      closeAttemptRef.current += 1;
      setClosing(false);
    }
  };

  const { portfolio } = payload;
  const unrealized = portfolio.averageEntryPrice !== null && markPrice !== null && Number.isFinite(markPrice) && Number.isFinite(portfolio.averageEntryPrice)
    ? (markPrice - portfolio.averageEntryPrice) * portfolio.baseBalance
    : 0;
  const quoteCurrency = symbol.split("/")[1] ?? "USDT";
  const hasUnresolvedPaperOrder = payload.orders.some((order) => order.status === "created" || order.status === "submitted" || order.status === "unknown");

  return (
    <div className="position-table-wrap p-2 font-mono text-xs">
      {stale && <div className="table-footnote text-xs text-[var(--ak-signal-action)] mb-2">{copy.staleNotice}</div>}
      {closeError && <div role="alert" className="error-inline text-xs text-[var(--ak-signal-danger)] mb-2">{closeError}</div>}
      {(closeNeedsRefresh || hasUnresolvedPaperOrder) && <div role="status" className="table-footnote text-xs text-[var(--ak-signal-action)] mb-2">{copy.stalePending}</div>}
      <div className="overflow-auto border border-[var(--ak-border-subtle)] shadow-sm">
        <table className="data-table w-full text-left">
          <thead>
            <tr className="bg-[var(--ak-surface-sunken)] border-b border-[var(--ak-border-subtle)] text-[10px] text-[var(--ak-text-secondary)] uppercase">
              <th className="p-2">{copy.asset}</th>
              <th className="p-2">{copy.size}</th>
              <th className="p-2">{copy.avgEntry}</th>
              <th className="p-2">{copy.markPrice}</th>
              <th className="p-2">{copy.unrealizedPnl}</th>
              <th className="p-2">{copy.realizedPnl}</th>
              <th className="p-2">{copy.available}</th>
              <th className="p-2 text-right">{copy.action}</th>
            </tr>
          </thead>
          <tbody>
            <tr className="border-b border-[var(--ak-border-subtle)] hover:bg-[var(--ak-surface-sunken)] transition-colors">
              <td className="p-2 font-bold flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => useWorkspaceStore.getState().setSymbol(symbol)}
                  className="hover:text-[var(--ak-signal-info)] hover:underline inline-flex items-center gap-1 cursor-pointer transition-colors text-left"
                  title={copy.selectSymbol(symbol)}
                >
                  <span className="text-[var(--ak-text-primary)]">{symbol.split("/")[0]}</span>
                  <span className="text-[10px] text-[var(--ak-text-secondary)]">/{symbol.split("/")[1]}</span>
                </button>
              </td>
              <td className="p-2 font-mono tabular-nums">{portfolio.baseBalance.toFixed(5)}</td>
              <td className="p-2 font-mono tabular-nums">{portfolio.averageEntryPrice?.toLocaleString(undefined, { maximumFractionDigits: 6 }) ?? "—"}</td>
              <td className="p-2 font-mono tabular-nums">{markPrice?.toLocaleString(undefined, { maximumFractionDigits: 6 }) ?? "—"}</td>
              <td className={`p-2 font-mono tabular-nums font-bold ${unrealized >= 0 ? "positive text-[var(--ak-signal-success)]" : "negative text-[var(--ak-signal-danger)]"}`}>
                {money(unrealized, quoteCurrency)}
              </td>
              <td className={`p-2 font-mono tabular-nums font-bold ${portfolio.realizedPnl >= 0 ? "positive text-[var(--ak-signal-success)]" : "negative text-[var(--ak-signal-danger)]"}`}>
                {money(portfolio.realizedPnl, quoteCurrency)}
              </td>
              <td className="p-2 font-mono tabular-nums">{money(portfolio.quoteBalance, quoteCurrency)}</td>
              <td className="p-2 text-right">
                {portfolio.baseBalance > 0 ? (
                  <Button
                    size="sm"
                    variant="danger"
                    disabled={closing || closeNeedsRefresh || hasUnresolvedPaperOrder}
                    onClick={() => void closePosition()}
                    className="h-6 text-[10px] px-2 font-bold transition-transform active:scale-95"
                    title={hasUnresolvedPaperOrder ? copy.closeBlockedPending : closeNeedsRefresh ? copy.closeBlockedRefresh : copy.closeMarketTitle}
                  >
                    {closing ? copy.closing : hasUnresolvedPaperOrder ? copy.orderPending : closeNeedsRefresh ? copy.refreshRequired : copy.closePosition}
                  </Button>
                ) : (
                  <span className="text-[10px] text-[var(--ak-text-secondary)] opacity-40">—</span>
                )}
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      {portfolio.baseBalance === 0 && <div className="table-footnote text-[10px] text-[var(--ak-text-secondary)] mt-2 opacity-70">{copy.noOpenPosition(symbol.split("/")[0])}</div>}
    </div>
  );
}

function ReplayPositions({ session, portfolio }: { session: ReplaySession | null; portfolio: PaperPortfolio | null }): React.JSX.Element {
  const copy = useCopy(DOCK_COPY);
  if (!session || !portfolio) return <div className="empty-state p-6 text-center text-xs text-[var(--ak-text-secondary)]"><Wallet size={18} className="mx-auto mb-2 text-[var(--ak-signal-info)]" /><strong>{copy.noReplayAccount}</strong><span>{copy.startReplayHint}</span></div>;
  const current = session.bars.at(-1);
  const unrealized = current && portfolio.averageEntryPrice !== null && Number.isFinite(current.close) && Number.isFinite(portfolio.averageEntryPrice)
    ? (current.close - portfolio.averageEntryPrice) * portfolio.baseBalance
    : 0;
  const quoteCurrency = session.symbol.split("/")[1] ?? "USDT";

  return (
    <div className="position-table-wrap p-2 font-mono text-xs">
      <div className="overflow-auto border border-[var(--ak-border-subtle)] shadow-sm">
        <table className="data-table w-full text-left">
          <thead>
            <tr className="bg-[var(--ak-surface-sunken)] border-b border-[var(--ak-border-subtle)] text-[10px] text-[var(--ak-text-secondary)] uppercase">
              <th className="p-2">{copy.asset}</th>
              <th className="p-2">{copy.size}</th>
              <th className="p-2">{copy.avgEntry}</th>
              <th className="p-2">{copy.replayClose}</th>
              <th className="p-2">{copy.unrealizedPnl}</th>
              <th className="p-2">{copy.realizedPnl}</th>
              <th className="p-2">{copy.available}</th>
            </tr>
          </thead>
          <tbody>
            <tr className="border-b border-[var(--ak-border-subtle)] hover:bg-[var(--ak-surface-sunken)] transition-colors">
              <td className="p-2 font-bold flex items-center gap-1">
                <span className="text-[var(--ak-text-primary)]">{session.symbol.split("/")[0]}</span>
                <span className="text-[10px] text-[var(--ak-text-secondary)]">/{session.symbol.split("/")[1]} · {session.timeframe}</span>
              </td>
              <td className="p-2 font-mono tabular-nums">{portfolio.baseBalance.toFixed(5)}</td>
              <td className="p-2 font-mono tabular-nums">{portfolio.averageEntryPrice?.toLocaleString(undefined, { maximumFractionDigits: 6 }) ?? "—"}</td>
              <td className="p-2 font-mono tabular-nums">{current?.close.toLocaleString(undefined, { maximumFractionDigits: 6 }) ?? "—"}</td>
              <td className={`p-2 font-mono tabular-nums font-bold ${unrealized >= 0 ? "positive text-[var(--ak-signal-success)]" : "negative text-[var(--ak-signal-danger)]"}`}>
                {money(unrealized, quoteCurrency)}
              </td>
              <td className={`p-2 font-mono tabular-nums font-bold ${portfolio.realizedPnl >= 0 ? "positive text-[var(--ak-signal-success)]" : "negative text-[var(--ak-signal-danger)]"}`}>
                {money(portfolio.realizedPnl, quoteCurrency)}
              </td>
              <td className="p-2 font-mono tabular-nums">{money(portfolio.quoteBalance, quoteCurrency)}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}

function OrdersTable({ orders }: { orders: PaperOrder[] }): React.JSX.Element {
  const copy = useCopy(DOCK_COPY);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const copyId = (id: string): void => {
    void navigator.clipboard.writeText(id);
    setCopiedId(id);
    window.setTimeout(() => setCopiedId(null), 1500);
  };

  if (orders.length === 0) return <div className="empty-state p-6 text-center text-xs text-[var(--ak-text-secondary)]"><ListChecks size={18} className="mx-auto mb-2 text-[var(--ak-signal-info)]" /><strong>{copy.noOrders}</strong><span>{copy.ordersHint}</span></div>;

  return (
    <div className="table-scroll overflow-auto max-h-72 p-2 font-mono text-xs">
      <div className="overflow-auto border border-[var(--ak-border-subtle)] shadow-sm">
        <table className="data-table w-full text-left">
        <thead>
          <tr className="bg-[var(--ak-surface-sunken)] border-b border-[var(--ak-border-subtle)] text-[10px] text-[var(--ak-text-secondary)] uppercase">
            <th className="p-2">{copy.time}</th>
            <th className="p-2">{copy.symbol}</th>
            <th className="p-2">{copy.side}</th>
            <th className="p-2">{copy.quantity}</th>
            <th className="p-2">{copy.status}</th>
            <th className="p-2">{copy.fillPrice}</th>
            <th className="p-2">{copy.clientOrderId}</th>
          </tr>
        </thead>
        <tbody>
          {orders.map((order) => {
            const isBuy = order.side === "buy";
            const statusTag = order.status === "filled" ? "default" : order.status === "cancelled" ? "danger" : "advanced";
            return (
              <tr key={order.clientOrderId} className="border-b border-[var(--ak-border-subtle)] hover:bg-[var(--ak-surface-sunken)] transition-colors">
                <td className="p-2 text-[10px] text-[var(--ak-text-secondary)]">{new Date(order.createdAt).toLocaleTimeString()}</td>
                <td className="p-2 font-bold">
                  <button
                    type="button"
                    onClick={() => useWorkspaceStore.getState().setSymbol(order.symbol)}
                    className="hover:text-[var(--ak-signal-info)] hover:underline cursor-pointer transition-colors text-left"
                    title={copy.selectSymbol(order.symbol)}
                  >
                    {order.symbol}
                  </button>
                </td>
                <td className="p-2">
                  <AkTag variant={isBuy ? "default" : "danger"} className="text-[10px] px-1.5 py-0">
                    {copy.orderSide[order.side]}
                  </AkTag>
                </td>
                <td className="p-2 font-mono tabular-nums">{order.quantity}</td>
                <td className="p-2">
                  <span className={`status-pill status-${order.status} uppercase font-bold text-[10px]`}>{copy.orderStatus[order.status]}</span>
                </td>
                <td className="p-2 font-mono tabular-nums">{order.fillPrice?.toLocaleString(undefined, { maximumFractionDigits: 6 }) ?? "—"}</td>
                <td className="p-2 mono text-[10px] text-[var(--ak-text-secondary)]">
                  <button
                    type="button"
                    onClick={() => copyId(order.clientOrderId)}
                    className="hover:text-[var(--ak-text-primary)] hover:underline inline-flex items-center gap-1 cursor-pointer font-mono text-left"
                    title={copy.copyOrderId}
                  >
                    <span>{order.clientOrderId}</span>
                    {copiedId === order.clientOrderId && (
                      <span className="text-[9px] text-[var(--ak-signal-success)] font-bold">{copy.copied}</span>
                    )}
                  </button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      </div>
    </div>
  );
}

function BacktestViewContent({ result, onOpenStrategy, onStartReplay, replayBusy, replayError, selectionRequestRef }: { result: BacktestResult | null; onOpenStrategy: () => void; onStartReplay: (result: BacktestResult) => void; replayBusy: boolean; replayError: string | null; selectionRequestRef: React.MutableRefObject<number> }): React.JSX.Element {
  const copy = useCopy(DOCK_COPY);
  const [filter, setFilter] = useState<"all" | "long" | "short" | "win" | "loss">("all");
  const [rerunning, setRerunning] = useState(false);
  const [rerunError, setRerunError] = useState<{ resultId: string; message: string } | null>(null);
  const setBacktest = useWorkspaceStore((state) => state.setBacktest);

  if (!result) {
    return (
      <div className="empty-state p-8 text-center text-xs text-[var(--ak-text-secondary)] space-y-2">
        <FileText size={22} className="mx-auto text-[var(--ak-signal-action)]" />
        <strong className="block text-sm text-[var(--ak-text-primary)]">{copy.noBacktest}</strong>
        <p className="max-w-md mx-auto opacity-80 leading-relaxed">
          {copy.noBacktestHint}
        </p>
        <Button variant="outline" size="sm" onClick={onOpenStrategy} className="mt-2 text-xs">
          {copy.openStrategyLab}
        </Button>
      </div>
    );
  }

  const metric = result.metrics;
  const filteredTrades = result.trades.filter((trade) => {
    if (filter === "long") return trade.side === "long";
    if (filter === "short") return trade.side === "short";
    if (filter === "win") return trade.netPnl > 0;
    if (filter === "loss") return trade.netPnl < 0;
    return true;
  });
  const emptyTradeMessage =
    result.trades.length === 0
      ? copy.noTrades
      : filter === "long"
        ? copy.noLongTrades
        : filter === "short"
          ? copy.noShortTrades
          : filter === "win"
            ? copy.noWinTrades
            : filter === "loss"
              ? copy.noLossTrades
              : copy.noFilterTrades;

  const rerunBacktest = async (): Promise<void> => {
    const requestId = ++selectionRequestRef.current;
    const canApply = captureWorkspaceSelection();
    const isCurrent = () => requestId === selectionRequestRef.current && canApply() && useWorkspaceStore.getState().backtest === result;
    setRerunning(true);
    setRerunError(null);
    try {
      const response = await fetch(`/api/backtests/${encodeURIComponent(result.resultId)}/rerun`, { method: "POST" });
      const payload: unknown = await response.json();
      if (!response.ok) {
        const message = typeof payload === "object" && payload !== null && "error" in payload && typeof payload.error === "string"
          ? payload.error
          : copy.rerunFailed(response.status);
        throw new Error(message);
      }
      if (typeof payload !== "object" || payload === null || !("resultId" in payload) || typeof payload.resultId !== "string") {
        throw new Error(copy.rerunInvalid);
      }
      if (isCurrent()) setBacktest(payload as BacktestResult);
    } catch (reason) {
      if (isCurrent()) setRerunError({ resultId: result.resultId, message: reason instanceof Error ? reason.message : copy.rerunFailedPlain });
    } finally {
      setRerunning(false);
    }
  };

  return (
    <div className="backtest-view p-3 bg-[var(--ak-surface-canvas)] font-mono text-xs space-y-3">
      <div className="backtest-summary-row grid grid-cols-1 lg:grid-cols-4 gap-3">
        <div className="metric-strip lg:col-span-2 grid grid-cols-2 sm:grid-cols-3 gap-2 bg-[var(--ak-surface-sunken)] p-2.5 border border-[var(--ak-border-subtle)]">
          <Metric label={copy.totalReturn} value={percentage(metric.totalReturn)} tone={metric.totalReturn >= 0 ? "positive" : "negative"} />
          <Metric label={copy.maxDrawdown} value={percentage(-metric.maxDrawdown)} tone="negative" />
          <Metric
            label={copy.sharpeRatio}
            value={metric.sharpeRatio?.toFixed(2) ?? "—"}
            tone={metric.sharpeRatio != null ? (metric.sharpeRatio >= 1 ? "positive" : metric.sharpeRatio < 0 ? "negative" : undefined) : undefined}
            title={result.execution?.sharpeMethod}
          />
          <Metric label={copy.winRate} value={percentage(metric.winRate)} tone={metric.winRate >= 0.5 ? "positive" : "negative"} />
          <Metric
            label={copy.profitFactor}
            value={metric.profitFactor?.toFixed(2) ?? "—"}
            tone={metric.profitFactor != null ? (metric.profitFactor >= 1.5 ? "positive" : metric.profitFactor < 1 ? "negative" : undefined) : undefined}
          />
          <Metric label={copy.totalTrades} value={String(metric.tradeCount)} />
        </div>
        <div className="equity-chart-wrap bg-[var(--ak-surface-sunken-2)] p-2 border border-[var(--ak-border-subtle)] flex flex-col h-40 lg:col-span-2">
          <div className="equity-chart-label text-[10px] text-[var(--ak-text-secondary)] uppercase tracking-wider mb-1 font-bold">
            {copy.equityCurve(result.symbol.split("/")[1])}
          </div>
          <div className="flex-1 min-h-0">
            <EquityChart result={result} />
          </div>
        </div>
      </div>

      <div className="backtest-meta flex flex-wrap items-center justify-between gap-2 p-2 bg-[var(--ak-surface-sunken)] border border-[var(--ak-border-subtle)] text-[11px] text-[var(--ak-text-secondary)]">
        <div className="flex flex-wrap items-center gap-3">
          <span className="font-bold text-[var(--ak-text-primary)]">{result.symbol} · {result.timeframe}</span>
          <span>{result.strategyId} v{result.strategyVersion}</span>
          <span>{copy.costs((result.assumptions.feeRate * 10_000).toFixed(1), (result.assumptions.slippageRate * 10_000).toFixed(1))}</span>
          <span title={result.execution?.fillTiming}>{result.execution?.fillTiming ?? copy.nextBarOpen} · {result.engineVersion}</span>
          {result.candleSource === "local-cache" && (
            <span className="text-[var(--ak-signal-action)] font-bold">{copy.localCache}</span>
          )}
        </div>

        <div className="result-actions flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              const report = buildResearchReport(result);
              const url = URL.createObjectURL(new Blob([JSON.stringify(report, null, 2)], { type: "application/json" }));
              const link = document.createElement("a");
              link.href = url;
              link.download = researchReportFilename(result);
              link.click();
              window.setTimeout(() => URL.revokeObjectURL(url), 0);
            }}
            icon={<FileDown size={12} />}
            className="text-xs h-7"
            title={copy.exportHint}
          >
            {copy.exportReport}
          </Button>
          <Button
            variant="outline"
            size="sm"
            disabled={rerunning}
            onClick={() => void rerunBacktest()}
            icon={rerunning ? <RotateCcw size={12} className="spin" /> : <RotateCcw size={12} />}
            className="text-xs h-7"
          >
            {copy.rerunBacktest}
          </Button>
          <Button
            variant="primary"
            size="sm"
            disabled={replayBusy || result.equityCurve.length === 0}
            onClick={() => onStartReplay(result)}
            className="text-xs h-7 font-bold"
            title={copy.continueReplayHint}
          >
            {replayBusy ? copy.startingReplay : copy.continueReplay}
          </Button>
          {rerunError?.resultId === result.resultId && <span role="alert" className="error-inline text-xs text-[var(--ak-signal-danger)]">{rerunError.message}</span>}
          {replayError && <span role="alert" className="error-inline text-xs text-[var(--ak-signal-danger)]">{replayError}</span>}
        </div>
      </div>

      <div className="trades-section space-y-2">
        <div className="backtest-trade-heading flex items-center justify-between pb-1 border-b border-[var(--ak-border-subtle)]">
          <div className="flex items-center gap-2">
            <strong className="text-xs tracking-wider uppercase">{copy.tradeHeading(filteredTrades.length)}</strong>
          </div>
          <div className="backtest-trade-filters flex items-center gap-1 text-[10px]">
            <Filter size={11} className="text-[var(--ak-text-secondary)]" />
            {(["all", "long", "short", "win", "loss"] as const).map((mode) => (
              <button
                key={mode}
                type="button"
                onClick={() => setFilter(mode)}
                aria-pressed={filter === mode}
                className={`px-1.5 py-0.5 uppercase border ${filter === mode ? "bg-[var(--ak-signal-info)] text-black border-transparent font-bold" : "bg-transparent text-[var(--ak-text-secondary)] border-[var(--ak-border-subtle)] hover:text-white"}`}
              >
                {copy.filters[mode]}
              </button>
            ))}
          </div>
        </div>

        <div className="table-scroll trade-table-scroll overflow-auto max-h-56 border border-[var(--ak-border-subtle)]">
          {filteredTrades.length === 0 ? (
            <div className="empty-inline p-4 text-center text-xs text-[var(--ak-text-secondary)] flex flex-col items-center justify-center gap-1.5" role="status">
              <div className="flex items-center justify-center gap-1.5">
                <AlertCircle size={14} />
                <span>{emptyTradeMessage}</span>
              </div>
              {result.trades.length > 0 && filter !== "all" && (
                <Button variant="outline" size="sm" onClick={() => setFilter("all")} className="trade-filter-reset">
                  {copy.showAllTrades}
                </Button>
              )}
            </div>
          ) : (
            <table className="data-table w-full text-left">
              <thead>
                <tr className="bg-[var(--ak-surface-sunken)] border-b border-[var(--ak-border-subtle)] text-[10px] text-[var(--ak-text-secondary)] uppercase">
                  <th className="p-1.5">#</th>
                  <th className="p-1.5">{copy.side}</th>
                  <th className="p-1.5">{copy.entryUtc}</th>
                  <th className="p-1.5">{copy.entry}</th>
                  <th className="p-1.5">{copy.exitUtc}</th>
                  <th className="p-1.5">{copy.exit}</th>
                  <th className="p-1.5">{copy.netPnl}</th>
                  <th className="p-1.5">{copy.fees}</th>
                  <th className="p-1.5">{copy.reason}</th>
                </tr>
              </thead>
              <tbody>
                {filteredTrades.map((trade, index) => (
                  <tr key={trade.id} className="border-b border-[var(--ak-border-subtle)] hover:bg-[var(--ak-surface-sunken)] transition-colors">
                    <td className="p-1.5 text-[var(--ak-text-secondary)]">{index + 1}</td>
                    <td className="p-1.5">
                      <AkTag variant={trade.side === "long" ? "default" : "danger"} className="text-[9px] px-1 py-0">
                        {copy.tradeSide[trade.side]}
                      </AkTag>
                    </td>
                    <td className="p-1.5 text-[10px] text-[var(--ak-text-secondary)]">{timestamp(trade.entryTime)}</td>
                    <td className="p-1.5 font-mono tabular-nums">{trade.entryPrice.toLocaleString(undefined, { maximumFractionDigits: 6 })}</td>
                    <td className="p-1.5 text-[10px] text-[var(--ak-text-secondary)]">{timestamp(trade.exitTime)}</td>
                    <td className="p-1.5 font-mono tabular-nums">{trade.exitPrice.toLocaleString(undefined, { maximumFractionDigits: 6 })}</td>
                    <td className={`p-1.5 font-mono tabular-nums font-bold ${trade.netPnl >= 0 ? "positive text-[var(--ak-signal-success)]" : "negative text-[var(--ak-signal-danger)]"}`}>
                      {money(trade.netPnl, result.symbol.split("/")[1])}
                    </td>
                    <td className="p-1.5 font-mono tabular-nums text-[var(--ak-text-secondary)]">{money(trade.fees, result.symbol.split("/")[1])}</td>
                    <td className="p-1.5 text-[10px] text-[var(--ak-text-secondary)] uppercase">{copy.exitReason[trade.exitReason]}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      <div className="result-provenance text-[10px] text-[var(--ak-text-secondary)] opacity-60 text-right">
        {copy.provenance(result.resultId, result.datasetId, new Date(result.createdAt).toLocaleString())}
      </div>
    </div>
  );
}

const BacktestView = memo(BacktestViewContent);

function Metric({ label, value, tone, title }: { label: string; value: string; tone?: "positive" | "negative" | undefined; title?: string | undefined }): React.JSX.Element {
  const Icon = tone === "positive" ? ArrowUpRight : tone === "negative" ? ArrowDownRight : null;
  return (
    <div className="metric-cell flex flex-col p-1.5" title={title}>
      <span className="text-[9px] text-[var(--ak-text-secondary)] font-mono uppercase tracking-wider">{label}</span>
      <strong className={`text-sm font-mono font-bold flex items-center gap-1 ${tone === "positive" ? "text-[var(--ak-signal-success)]" : tone === "negative" ? "text-[var(--ak-signal-danger)]" : "text-[var(--ak-text-primary)]"}`}>
        {Icon && <Icon size={12} />}
        {value}
      </strong>
    </div>
  );
}

function ExperimentHistoryContent({ onSelect, refreshKey }: { onSelect: (id: string) => void; refreshKey: string | null }): React.JSX.Element {
  const copy = useCopy(DOCK_COPY);
  const [items, setItems] = useState<ExperimentSummary[]>([]);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [comparison, setComparison] = useState<BacktestResult[] | null>(null);
  const [comparisonError, setComparisonError] = useState<string | null>(null);
  const [loadingComparison, setLoadingComparison] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [refreshToken, setRefreshToken] = useState(0);
  const requestKey = JSON.stringify([refreshKey, refreshToken]);
  const [completedKey, setCompletedKey] = useState<string | null>(null);
  const refreshing = completedKey !== requestKey;

  useEffect(() => {
    let disposed = false;
    const key = requestKey;
    void fetch("/api/backtests?view=summary&limit=30", { cache: "no-store" }).then(async (response) => {
      const payload: unknown = await response.json();
      if (!response.ok) throw new Error(translate(DOCK_COPY).historyUnavailable);
      if (typeof payload === "object" && payload !== null && "items" in payload && Array.isArray(payload.items) && !disposed) {
        const nextItems = payload.items as ExperimentSummary[];
        setItems(nextItems);
        setSelectedIds((current) => current.filter((id) => nextItems.some((item) => item.resultId === id)));
        setError(null);
      }
    }).catch((reason: unknown) => { if (!disposed) setError(reason instanceof Error ? reason.message : translate(DOCK_COPY).historyLoadFailed); })
      .finally(() => { if (!disposed) setCompletedKey(key); });
    return () => { disposed = true; };
  }, [requestKey]);

  const compareSelected = async (): Promise<void> => {
    setLoadingComparison(true);
    setComparison(null);
    setComparisonError(null);
    try {
      const results = await Promise.all(selectedIds.map(async (id) => {
        const response = await fetch(`/api/backtests/${encodeURIComponent(id)}`, { cache: "no-store" });
        if (!response.ok) throw new Error(copy.selectedUnavailable);
        return await response.json() as BacktestResult;
      }));
      setComparison(results);
    } catch (reason) {
      setComparisonError(reason instanceof Error ? reason.message : copy.comparisonLoadFailed);
    } finally {
      setLoadingComparison(false);
    }
  };

  if (error) {
    return (
      <div className="empty-state p-6 text-center text-xs text-[var(--ak-signal-danger)]">
        <AlertCircle size={18} className="mx-auto mb-2" />
        <strong>{copy.historyUnavailableTitle}</strong>
        <span>{error}</span>
        <Button
          variant="outline"
          size="sm"
          className="mt-2 text-xs"
          disabled={refreshing}
          onClick={() => setRefreshToken((token) => token + 1)}
        >
          {refreshing ? copy.retrying : copy.retry}
        </Button>
      </div>
    );
  }
  if (items.length === 0) {
    return (
      <div className="empty-state p-6 text-center text-xs text-[var(--ak-text-secondary)]">
        <Clock3 size={18} className="mx-auto mb-2 text-[var(--ak-signal-info)]" />
        <strong>{refreshing ? copy.loadingRuns : copy.noExperiments}</strong>
        <span>{refreshing ? copy.checkingHistory : copy.storedLocally}</span>
        <Button
          variant="outline"
          size="sm"
          className="mt-2 text-xs"
          disabled={refreshing}
          onClick={() => setRefreshToken((token) => token + 1)}
        >
          {refreshing ? copy.refreshing : copy.refresh}
        </Button>
      </div>
    );
  }

  const assumptionsKey = (item: BacktestResult): string => JSON.stringify([
    item.assumptions?.accountMode,
    item.assumptions?.initialCapital,
    item.assumptions?.positionFraction,
    item.assumptions?.feeRate,
    item.assumptions?.slippageRate,
    item.assumptions?.allowShorts,
    item.assumptions?.stopLossPct,
    item.assumptions?.takeProfitPct,
  ]);
  const groupKey = (item: BacktestResult): string => JSON.stringify([item.datasetId, item.exchange, item.symbol, item.timeframe, item.engineVersion, assumptionsKey(item)]);
  const comparable = comparison ?? [];
  const incompatible = comparable.length > 0 && (!/^sha256:[a-f0-9]{64}$/.test(comparable[0]!.datasetId) || comparable.some((item) => groupKey(item) !== groupKey(comparable[0]!)));

  return (
    <div className="p-3 font-mono text-xs space-y-3">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[10px] text-[var(--ak-text-secondary)]">{copy.savedRuns(items.length)}</span>
        <Button
          variant="outline"
          size="sm"
          className="h-6 text-[10px] px-2"
          disabled={refreshing || loadingComparison}
          onClick={() => setRefreshToken((token) => token + 1)}
          icon={<RotateCcw size={11} className={refreshing ? "spin" : undefined} />}
        >
          {refreshing ? copy.refreshing : copy.refresh}
        </Button>
      </div>
      <div className="table-scroll overflow-auto max-h-56 border border-[var(--ak-border-subtle)]">
        <table className="data-table w-full text-left">
          <thead>
            <tr className="bg-[var(--ak-surface-sunken)] border-b border-[var(--ak-border-subtle)] text-[10px] text-[var(--ak-text-secondary)] uppercase">
              <th className="p-1.5">{copy.select}</th>
              <th className="p-1.5">{copy.created}</th>
              <th className="p-1.5">{copy.symbol}</th>
              <th className="p-1.5">{copy.strategy}</th>
              <th className="p-1.5">{copy.headerReturn}</th>
              <th className="p-1.5">{copy.headerMaxDd}</th>
              <th className="p-1.5">{copy.headerTrades}</th>
              <th className="p-1.5">{copy.resultId}</th>
              <th className="p-1.5 text-right">{copy.action}</th>
            </tr>
          </thead>
          <tbody>
            {items.map((item) => (
              <tr key={item.resultId} className="border-b border-[var(--ak-border-subtle)] hover:bg-[var(--ak-surface-sunken)] transition-colors clickable-row cursor-pointer" onClick={() => onSelect(item.resultId)}>
                <td className="p-1.5" onClick={(event) => event.stopPropagation()}>
                  <input
                    aria-label={copy.selectForCompare(item.resultId)}
                    type="checkbox"
                    checked={selectedIds.includes(item.resultId)}
                    disabled={loadingComparison}
                    onChange={(event) => {
                      const checked = event.target.checked;
                      setComparison(null);
                      setComparisonError(null);
                      setSelectedIds((current) => checked ? [...current, item.resultId] : current.filter((id) => id !== item.resultId));
                    }}
                  />
                </td>
                <td className="p-1.5 text-[10px] text-[var(--ak-text-secondary)]">{new Date(item.createdAt).toLocaleString()}</td>
                <td className="p-1.5 font-bold">{item.symbol} · {item.timeframe}</td>
                <td className="p-1.5">{item.strategyId}</td>
                <td className={`p-1.5 font-mono tabular-nums font-bold ${item.metrics.totalReturn === null ? "" : item.metrics.totalReturn >= 0 ? "positive text-[var(--ak-signal-success)]" : "negative text-[var(--ak-signal-danger)]"}`}>
                  {item.metrics.totalReturn === null ? "—" : percentage(item.metrics.totalReturn)}
                </td>
                <td className="p-1.5 font-mono tabular-nums text-[var(--ak-signal-danger)]">
                  {item.metrics.maxDrawdown === null ? "—" : percentage(-item.metrics.maxDrawdown)}
                </td>
                <td className="p-1.5 font-mono tabular-nums">{item.metrics.tradeCount ?? "—"}</td>
                <td className="p-1.5 mono text-[10px] text-[var(--ak-text-secondary)]">{item.resultId.slice(0, 12)}…</td>
                <td className="p-1.5 text-right">
                  <button
                    type="button"
                    onClick={(event) => {
                      event.stopPropagation();
                      onSelect(item.resultId);
                    }}
                    aria-label={copy.openResult(item.resultId.slice(0, 12))}
                    className="text-[10px] font-mono px-1.5 py-0.5 border border-[var(--ak-border-subtle)] hover:border-[var(--ak-signal-info)] hover:text-[var(--ak-signal-info)] cursor-pointer focus-visible:outline focus-visible:outline-1 focus-visible:outline-[var(--ak-signal-info)]"
                  >
                    {copy.open}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="result-actions flex flex-wrap items-center justify-between gap-2 p-2 bg-[var(--ak-surface-sunken)] border border-[var(--ak-border-subtle)]">
        <div role="status" className="text-[11px] text-[var(--ak-text-secondary)]">
          <span>{copy.runsSelected(selectedIds.length)}</span>
          {selectedIds.length < 2 && (
            <span className="block text-[10px]">
              {selectedIds.length === 0 ? copy.selectAtLeastTwo : copy.selectOneMore}
            </span>
          )}
          {selectedIds.length >= 2 && !comparison && !loadingComparison && !comparisonError && (
            <span className="block text-[10px]">
              {copy.compareHint}
            </span>
          )}
        </div>
        <Button
          variant="outline"
          size="sm"
          disabled={selectedIds.length < 2 || loadingComparison}
          onClick={() => void compareSelected()}
          className="text-xs"
        >
          {loadingComparison ? copy.loadingResults : copy.compareSelected}
        </Button>
      </div>

      {comparisonError && <div className="error-inline text-xs text-[var(--ak-signal-danger)] p-2" role="alert">{comparisonError}</div>}

      {comparison && (
        <section aria-label={copy.comparisonLabel} className="comparison-panel p-2.5 bg-[var(--ak-surface-sunken-2)] border border-[var(--ak-border-subtle)] space-y-2">
          <h3 className="text-xs font-bold text-[var(--ak-signal-info)] uppercase tracking-wider">
            {incompatible ? copy.notComparable : comparable.length > 0 ? copy.comparableGroup(EXCHANGE_LABELS[comparable[0]!.exchange], comparable[0]!.symbol, comparable[0]!.timeframe) : copy.comparableGroupPlain}
          </h3>
          {incompatible ? (
            <p role="alert" className="text-[11px] text-[var(--ak-signal-danger)]">{copy.incomparable(comparable.map((item) => item.resultId).join(", "))}</p>
          ) : comparable.length < 2 ? (
            <p className="text-[11px] text-[var(--ak-text-secondary)] leading-relaxed">
              {copy.groupedHint}
            </p>
          ) : (
            <div className="table-scroll overflow-auto border border-[var(--ak-border-subtle)]">
              <table className="data-table w-full text-left">
                <thead>
                  <tr className="bg-[var(--ak-surface-sunken)] border-b border-[var(--ak-border-subtle)] text-[10px] text-[var(--ak-text-secondary)] uppercase">
                    <th className="p-1.5">{copy.headerStrategyId}</th>
                    <th className="p-1.5">{copy.headerTotalReturn}</th>
                    <th className="p-1.5">{copy.headerMaxDrawdown}</th>
                    <th className="p-1.5">{copy.headerSharpe}</th>
                    <th className="p-1.5">{copy.headerWinRate}</th>
                    <th className="p-1.5">{copy.headerTrades}</th>
                  </tr>
                </thead>
                <tbody>
                  {comparable.map((item) => (
                    <tr key={item.resultId} className="border-b border-[var(--ak-border-subtle)]">
                      <td className="p-1.5 font-bold">
                        <div>{item.strategyId}</div>
                        <small className="mono text-[9px] text-[var(--ak-text-secondary)]">{item.resultId.slice(0, 10)}…</small>
                      </td>
                      <td className={`p-1.5 font-mono font-bold ${item.metrics.totalReturn >= 0 ? "positive text-[var(--ak-signal-success)]" : "negative text-[var(--ak-signal-danger)]"}`}>
                        {percentage(item.metrics.totalReturn)}
                      </td>
                      <td className="p-1.5 font-mono text-[var(--ak-signal-danger)]">{percentage(-item.metrics.maxDrawdown)}</td>
                      <td className="p-1.5 font-mono">{item.metrics.sharpeRatio?.toFixed(2) ?? "—"}</td>
                      <td className="p-1.5 font-mono">{percentage(item.metrics.winRate)}</td>
                      <td className="p-1.5 font-mono">{item.metrics.tradeCount}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}
    </div>
  );
}

const ExperimentHistory = memo(ExperimentHistoryContent);

export const BottomDock = memo(function BottomDock({
  replayMode = false,
  replaySession = null,
  replayPortfolio = null,
  replayOrders = [],
  workspace = "terminal",
  markPrice = null,
  quoteStale = false,
  onStartReplay,
  replayBusy = false,
  replayError = null,
}: {
  workspace?: "terminal" | "research" | "replay";
  replayMode?: boolean;
  replaySession?: ReplaySession | null;
  replayPortfolio?: PaperPortfolio | null;
  replayOrders?: PaperOrder[];
  markPrice?: number | null;
  quoteStale?: boolean;
  onStartReplay: (result: BacktestResult) => void;
  replayBusy?: boolean;
  replayError?: string | null;
}): React.JSX.Element {
  const copy = useCopy(DOCK_COPY);
  const [tab, setTab, symbol, exchange, timeframe, result, activeBacktestId, setBacktest, setWorkspace, setInspectorTab, setExchange, selectedStrategyId, strategyParameters, config] = useWorkspaceStore(useShallow((state) => [
    state.dockTab, state.setDockTab, state.symbol, state.exchange, state.timeframe, state.backtest, state.activeBacktestId, state.setBacktest,
    state.setWorkspace, state.setInspectorTab, state.setExchange, state.selectedStrategyId, state.strategyParameters, state.backtestConfig,
  ]));

  const allowedTabs = workspace === "terminal" || workspace === "replay"
    ? ["positions", "orders"] as const
    : ["backtest", "sweep", "evaluate", "history", "logs"] as const;
  const activeTab = (allowedTabs as readonly string[]).includes(tab) ? tab : allowedTabs[0];
  const [backtestPanelVisited, setBacktestPanelVisited] = useState(false);
  const [historyPanelVisited, setHistoryPanelVisited] = useState(false);
  const [sweepPanelVisited, setSweepPanelVisited] = useState(false);
  const [evaluationPanelVisited, setEvaluationPanelVisited] = useState(false);
  const showBacktestPanel = workspace === "research" && activeTab === "backtest";
  const showHistoryPanel = workspace === "research" && activeTab === "history";
  const showSweepPanel = workspace === "research" && activeTab === "sweep" && !replayMode;
  const showEvaluationPanel = workspace === "research" && activeTab === "evaluate" && !replayMode;
  /* Latch after first visit: the panels keep their typed inputs and saved list
     state instead of refetching every time the user flips tabs. */
  if (showSweepPanel && !sweepPanelVisited) setSweepPanelVisited(true);
  if (showEvaluationPanel && !evaluationPanelVisited) setEvaluationPanelVisited(true);
  /* The Positions tab owns its own account poll. Only the Orders/Logs views
     need this dock-level snapshot, so an idle tab must not request it too. */
  const shouldPollPaper = (workspace === "terminal" && activeTab === "orders") || (workspace === "research" && activeTab === "logs");
  const openStrategy = useCallback(() => setInspectorTab("strategy"), [setInspectorTab]);


  const [paper, setPaper] = useState<PaperPayload | null>(null);
  const [paperError, setPaperError] = useState<string | null>(null);

  const selectionRequestRef = useRef(0);
  const selectResult = useCallback((resultId: string): void => {
    const requestId = ++selectionRequestRef.current;
    const canApply = captureWorkspaceSelection();
    const initial = useWorkspaceStore.getState();
    const initialBacktest = initial.backtest;
    const initialActiveId = initial.activeBacktestId;
    void fetch(`/api/backtests/${encodeURIComponent(resultId)}`, { cache: "no-store" }).then(async (response) => {
      if (!response.ok) throw new Error(translate(DOCK_COPY).resultLoadFailed);
      const payload: unknown = await response.json();
      if (requestId !== selectionRequestRef.current || !canApply() || useWorkspaceStore.getState().backtest !== initialBacktest || useWorkspaceStore.getState().activeBacktestId !== initialActiveId) return;
      setBacktest(payload as BacktestResult);
      setTab("backtest");
    }).catch((error: unknown) => { if (requestId === selectionRequestRef.current && canApply() && useWorkspaceStore.getState().backtest === initialBacktest && useWorkspaceStore.getState().activeBacktestId === initialActiveId) setPaperError(error instanceof Error ? error.message : translate(DOCK_COPY).resultLoadFallback); });
  }, [setBacktest, setPaperError, setTab]);

  useEffect(() => {
    if (replayMode || !activeBacktestId || result?.resultId === activeBacktestId) return;
    const requestId = selectionRequestRef.current;
    let disposed = false;
    void fetch(`/api/backtests/${encodeURIComponent(activeBacktestId)}`, { cache: "no-store" }).then(async (response) => {
      if (!response.ok) return;
      const payload: unknown = await response.json();
      const current = useWorkspaceStore.getState();
      // Restoring the already-selected ID must survive unrelated tab changes,
      // but never apply an old response after leaving its workspace.
      if (!disposed && requestId === selectionRequestRef.current && current.activeWorkspace === workspace && current.activeBacktestId === activeBacktestId && current.backtest === result) setBacktest(payload as BacktestResult);
    }).catch(() => undefined);
    return () => { disposed = true; };
  }, [activeBacktestId, result, setBacktest, replayMode, workspace]);

  useEffect(() => {
    if (replayMode || !shouldPollPaper) return;
    let disposed = false;
    const refresh = async (): Promise<void> => {
      try {
        const response = await fetch(`/api/paper?symbol=${encodeURIComponent(symbol)}&exchange=${exchange}`, { cache: "no-store" });
        const payload: unknown = await response.json();
        if (!response.ok) throw new Error(translate(DOCK_COPY).paperLoadFailed);
        if (typeof payload === "object" && payload !== null && "portfolio" in payload && "orders" in payload && !disposed) {
          setPaper(payload as PaperPayload);
          setPaperError(null);
        }
      } catch (reason) {
        if (!disposed) setPaperError(reason instanceof Error ? reason.message : translate(DOCK_COPY).paperUnavailable);
      }
    };
    void refresh();
    const timer = window.setInterval(() => { if (typeof document !== "undefined" && !document.hidden) void refresh(); }, 8_000);
    return () => { disposed = true; window.clearInterval(timer); };
  }, [symbol, replayMode, exchange, shouldPollPaper]);

  return (
    <section className="bottom-dock flex flex-col h-full bg-[var(--ak-surface-canvas)] border-t border-[var(--ak-border-strong)]">
      <div className="dock-toolbar flex items-center justify-between px-2 bg-[var(--ak-surface-sunken)] border-b border-[var(--ak-border-strong)]">
        <Tabs value={activeTab} onValueChange={(value) => {
          const nextTab = value as typeof tab;
          setTab(nextTab);
          if (workspace === "research" && nextTab === "backtest") setBacktestPanelVisited(true);
          if (workspace === "research" && nextTab === "history") setHistoryPanelVisited(true);
        }}>
          <TabsList className="dock-tabs flex items-center gap-1">
            {(workspace === "terminal" || workspace === "replay") && (
              <TabsTrigger value="positions" className="flex items-center gap-1.5 py-1.5 px-3 text-xs font-bold uppercase tracking-wider">
                <Wallet size={12} className="text-[var(--ak-signal-info)]" />
                <span>{copy.tabPositions}</span>
              </TabsTrigger>
            )}
            {(workspace === "terminal" || workspace === "replay") && (
              <TabsTrigger value="orders" className="flex items-center gap-1.5 py-1.5 px-3 text-xs font-bold uppercase tracking-wider">
                <ListChecks size={12} className="text-[var(--ak-signal-action)]" />
                <span>{copy.tabOrders}</span>
              </TabsTrigger>
            )}
            {workspace === "research" && (
              <TabsTrigger value="backtest" className="flex items-center gap-1.5 py-1.5 px-3 text-xs font-bold uppercase tracking-wider">
                <FileText size={12} className="text-[var(--ak-signal-info)]" />
                <span>{copy.tabResults}</span>
              </TabsTrigger>
            )}
            {workspace === "research" && (
              <TabsTrigger value="sweep" className="flex items-center gap-1.5 py-1.5 px-3 text-xs font-bold uppercase tracking-wider">
                <ScanSearch size={12} className="text-[var(--ak-signal-action)]" />
                <span>{copy.tabSweep}</span>
              </TabsTrigger>
            )}
            {workspace === "research" && (
              <TabsTrigger value="evaluate" className="flex items-center gap-1.5 py-1.5 px-3 text-xs font-bold uppercase tracking-wider">
                <FlaskConical size={12} className="text-[var(--ak-signal-success)]" />
                <span>{copy.tabEvaluate}</span>
              </TabsTrigger>
            )}
            {workspace === "research" && (
              <TabsTrigger value="history" className="flex items-center gap-1.5 py-1.5 px-3 text-xs font-bold uppercase tracking-wider">
                <Clock3 size={12} className="text-[var(--ak-signal-info)]" />
                <span>{copy.tabExperiments}</span>
              </TabsTrigger>
            )}
            {workspace === "research" && (
              <TabsTrigger value="logs" className="flex items-center gap-1.5 py-1.5 px-3 text-xs font-bold uppercase tracking-wider">
                <Boxes size={12} className="text-[var(--ak-text-secondary)]" />
                <span>{copy.tabExecution}</span>
              </TabsTrigger>
            )}
          </TabsList>
        </Tabs>
        <div className="dock-toolbar-right flex items-center gap-2 text-[10px] font-mono text-[var(--ak-text-secondary)]">
          <span className="w-1.5 h-1.5 rounded-full bg-[var(--ak-signal-info)]" />
          <span className="uppercase tracking-wider font-bold">
            {replayMode ? copy.modeReplay : copy.modePaper}
          </span>
        </div>
      </div>

      <div className="dock-content flex-1 overflow-auto min-h-0">
        {activeTab === "positions" && (workspace === "terminal" || workspace === "replay") && (
          replayMode ? <ReplayPositions session={replaySession} portfolio={replayPortfolio} /> : <PaperPositions key={`${exchange}|${symbol}`} symbol={symbol} exchange={exchange} markPrice={markPrice} quoteStale={quoteStale} />
        )}
        {activeTab === "orders" && (
          replayMode ? <OrdersTable orders={replayOrders} /> : paperError && !paper ? (
            <div className="empty-state p-6 text-center text-xs text-[var(--ak-signal-danger)]"><AlertCircle size={18} className="mx-auto mb-2" /><strong>{copy.ordersUnavailable}</strong><span>{paperError}</span></div>
          ) : paper === null ? (
            <div className="empty-state p-6 text-center text-xs text-[var(--ak-text-secondary)]"><strong>{copy.loadingOrders}</strong><span>{copy.loadingOrdersHint}</span></div>
          ) : (
            <OrdersTable orders={paper.orders} />
          )
        )}
        {activeTab === "history" && workspace === "research" && replayMode && (
          <div className="empty-state p-6 text-center text-xs text-[var(--ak-text-secondary)]"><AlertCircle size={18} className="mx-auto mb-2 text-[var(--ak-signal-action)]" /><strong>{copy.replayHistoryHidden}</strong><span>{copy.replayHistoryHiddenHint}</span></div>
        )}
        {!replayMode && (historyPanelVisited || showHistoryPanel) && (
          <div hidden={!showHistoryPanel}>
            <ExperimentHistory onSelect={selectResult} refreshKey={activeBacktestId} />
          </div>
        )}
        {activeTab === "backtest" && workspace === "research" && replayMode && (
          <div className="empty-state p-6 text-center text-xs text-[var(--ak-text-secondary)]"><AlertCircle size={18} className="mx-auto mb-2 text-[var(--ak-signal-action)]" /><strong>{copy.replayBacktestHidden}</strong><span>{copy.replayBacktestHiddenHint}</span></div>
        )}
        {!replayMode && (backtestPanelVisited || showBacktestPanel) && (
          <div hidden={!showBacktestPanel}>
            <BacktestView result={result} selectionRequestRef={selectionRequestRef} onOpenStrategy={openStrategy} onStartReplay={onStartReplay} replayBusy={replayBusy} replayError={replayError} />
          </div>
        )}
        {activeTab === "sweep" && workspace === "research" && replayMode && (
          <div className="empty-state p-6 text-center text-xs text-[var(--ak-text-secondary)]"><AlertCircle size={18} className="mx-auto mb-2 text-[var(--ak-signal-action)]" /><strong>{copy.replaySweepsHidden}</strong><span>{copy.replaySweepsHiddenHint}</span></div>
        )}
        {workspace === "research" && !replayMode && (sweepPanelVisited || showSweepPanel) && (
          <div hidden={!showSweepPanel}>
            <SweepPanel symbol={symbol} timeframe={timeframe} exchange={exchange} strategyId={STRATEGIES.find((s) => s.id === selectedStrategyId)?.id ?? selectedStrategyId} parameters={strategyParameters} config={config} />
          </div>
        )}
        {activeTab === "evaluate" && workspace === "research" && replayMode && (
          <div className="empty-state p-6 text-center text-xs text-[var(--ak-text-secondary)]"><AlertCircle size={18} className="mx-auto mb-2 text-[var(--ak-signal-action)]" /><strong>{copy.replayEvaluationsHidden}</strong><span>{copy.replayEvaluationsHiddenHint}</span></div>
        )}
        {workspace === "research" && !replayMode && (evaluationPanelVisited || showEvaluationPanel) && (
          <div hidden={!showEvaluationPanel}>
            <EvaluationPanel symbol={symbol} timeframe={timeframe} exchange={exchange} />
          </div>
        )}
        {activeTab === "logs" && workspace === "research" && (
          <div className="execution-log p-3 font-mono text-xs space-y-1.5">
            <div className="log-line flex items-center gap-2 text-[var(--ak-text-secondary)]">
              <AkTag variant="neutral" className="text-[9px]">{copy.logLocal}</AkTag>
              <span className="text-[var(--ak-signal-info)]">{copy.logSafetyBoundary}</span>
              <span>{copy.logSafetyBody}</span>
            </div>
            <div className="log-line flex items-center gap-2 text-[var(--ak-text-secondary)]">
              <AkTag variant="advanced" className="text-[9px]">{copy.logData}</AkTag>
              <span className="text-[var(--ak-signal-action)]">{copy.logMarketData}</span>
              <span>{copy.logMarketDataBody(EXCHANGE_LABELS[exchange])}</span>
            </div>
            {paper?.orders.slice(0, 10).map((order) => (
              <div className="log-line flex items-center gap-2 text-xs" key={order.clientOrderId}>
                <span className="text-[10px] text-[var(--ak-text-secondary)]">{new Date(order.createdAt).toLocaleTimeString()}</span>
                <AkTag variant={order.status === "filled" ? "default" : "danger"} className="text-[9px]">
                  {copy.orderStatus[order.status].toUpperCase()}
                </AkTag>
                <span className="font-bold">{copy.orderSide[order.side]} {order.quantity} {order.symbol}</span>
                <span className="text-[10px] text-[var(--ak-text-secondary)] opacity-70">({order.clientOrderId})</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </section>
  );
});
