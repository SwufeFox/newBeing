"use client";

import { replayReport, type ReplayExecution, type ReplayOrderInput, type ReplayReport } from "@newbeing/core";
import { memo, useEffect, useMemo, useRef, useState } from "react";
import { BookOpen, Braces, Check, Clock3, Copy, History, Layers3, TrendingDown, TrendingUp, Wallet, ArrowDownRight, ArrowUpRight } from "lucide-react";
import type { BacktestResult, ExchangeId, OrderPreview, PaperOrder, PaperPortfolio, ReplaySession } from "@newbeing/core";
import type { MarketSummary, OrderBookSnapshot, RecentTrade } from "@newbeing/market-data/types";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { SharedSpotTicket } from "@/components/shared-spot-ticket";
import { PaperRecoveryPanel } from "@/components/paper-recovery";
import { StrategyLab } from "@/components/strategy-lab";
import { useWorkspaceStore } from "@/store/workspace";
import { useShallow } from "zustand/react/shallow";
import { floorToDecimals } from "@/lib/indicators";
import { AkTag, AkNotice, AkField, AkFieldLabel, AkInput, AkSelect, AkCard, AkNum, AkButton, AkProgress, AkSpinner } from "@swufefox/ak-ui-react";
import { translate, useCopy, type CopyTable } from "@/lib/i18n";

interface InspectorCopy {
  /* Depth ladder and tape */
  priceWithQuote: (quote: string) => string;
  size: string;
  spread: string;
  staleNotice: string;
  pickAsk: (price: string) => string;
  pickBid: (price: string) => string;
  pickTrade: (price: string) => string;
  pickHint: string;
  loadingDepth: string;
  loadingPublicDepth: string;
  loadingTrades: string;
  loadingLatestTrades: string;
  bookUnavailable: string;
  bookInvalid: string;
  bookRequestFailed: string;
  depthStampStale: (exchange: string) => string;
  depthStamp: (exchange: string) => string;
  tradesUnavailable: string;
  tradesRequestFailed: string;
  tradesStampStale: (exchange: string) => string;
  tradesStamp: (exchange: string) => string;
  columnPrice: string;
  columnAmount: string;
  columnTime: string;
  /* Context bridge */
  bridge: string;
  bridgeActive: string;
  allContextFields: string;
  fieldStrategy: string;
  fieldExecution: string;
  executionPaperLocal: string;
  fieldActiveBacktest: string;
  none: string;
  fieldChartRange: string;
  chartRangeDynamic: string;
  bridgeNote: string;
  copiedJson: string;
  copyContextJson: string;
  /* Paper ticket */
  paperTicket: string;
  simulated: string;
  available: (quote: string) => string;
  collateral: string;
  position: (base: string) => string;
  closeFull: string;
  closeFullHint: string;
  unrealizedPnl: (value: string) => string;
  positionAllocation: string;
  sizingReference: (value: string) => string;
  sizingReferenceNote: string;
  reset: string;
  quantity: (base: string) => string;
  toggleSizingSide: string;
  sizingHint: string;
  sizingBuy: string;
  sizingSell: string;
  setPercent: (percent: string, side: "buy" | "sell") => string;
  max: string;
  decreaseQuantity: string;
  increaseQuantity: string;
  estimatedNotional: string;
  buy: string;
  sell: string;
  aiOrderPreview: string;
  previewSide: (side: "buy" | "sell", quantity: string, base: string) => string;
  previewNumbers: (reference: string, estimated: string, quote: string, fee: string) => string;
  expires: (time: string) => string;
  confirmPaper: string;
  dismiss: string;
  prtsSimulation: string;
  publicQuotes: string;
  previewActionFailed: string;
  paperOrderFailed: string;
  paperSubmitFailed: string;
  previewConfirmationSaved: string;
  previewConfirmed: string;
  previewDismissed: string;
  filledAtPublicQuote: (side: "buy" | "sell") => string;
  paperOrderCancelled: string;
  savedPaperStatus: (status: string) => string;
  /* Replay ticket */
  replayAccount: string;
  isolated: string;
  replayProtocol: string;
  awaitingSeed: string;
  replaySeedNote: string;
  replaySimulator: string;
  queueCloseHint: string;
  cursorClosePrice: string;
  cursorCloseHint: string;
  priceAppliedToTrigger: (value: string) => string;
  orderType: string;
  replayOrderType: string;
  market: string;
  limit: string;
  stop: string;
  toggleReplaySizingSide: string;
  limitStopPrice: (quote: string) => string;
  stopLossOptional: string;
  takeProfitOptional: string;
  queueBuy: string;
  queueSell: string;
  cancel: string;
  sessionNotes: string;
  notesPlaceholder: string;
  tags: string;
  tagsPlaceholder: string;
  saveNotesTags: string;
  exportJournal: string;
  marketCloseQueued: string;
  limitStopRequired: string;
  replayOrderFailed: string;
  queuedForNextBar: (side: "buy" | "sell") => string;
  journalSummary: (equity: string, quote: string, netPnl: string, fills: number, maxDrawdown: string) => string;
  /* Panel chrome */
  tabBook: string;
  tabTrades: string;
  tabStrategy: string;
  tabAi: string;
  ariaOrderBook: string;
  ariaRecentTrades: string;
  ariaStrategyLab: string;
  ariaAiContext: string;
  paperAccountMode: string;
  legacyWallet: string;
  sharedSpotWallet: string;
  priceAppliedToTicket: (value: string) => string;
}

const INSPECTOR_COPY: CopyTable<InspectorCopy> = {
  en: {
    priceWithQuote: (quote) => `PRICE (${quote})`,
    size: "SIZE",
    spread: "SPREAD",
    staleNotice: "STALE · last update failed; showing previous data.",
    pickAsk: (value) => `Pick ask ${value}`,
    pickBid: (value) => `Pick bid ${value}`,
    pickTrade: (value) => `Pick trade ${value}`,
    pickHint: "Click to copy price to ticket",
    loadingDepth: "Loading depth",
    loadingPublicDepth: "Loading public depth…",
    loadingTrades: "Loading trades",
    loadingLatestTrades: "Loading latest trades…",
    bookUnavailable: "Order book is unavailable.",
    bookInvalid: "Invalid order book response.",
    bookRequestFailed: "Order book request failed.",
    depthStampStale: (exchange) => `STALE · ${exchange} public depth`,
    depthStamp: (exchange) => `${exchange} depth snapshot`,
    tradesUnavailable: "Recent trades are unavailable.",
    tradesRequestFailed: "Recent trade request failed.",
    tradesStampStale: (exchange) => `STALE · ${exchange} public trades`,
    tradesStamp: (exchange) => `${exchange} public stream`,
    columnPrice: "PRICE",
    columnAmount: "AMOUNT",
    columnTime: "TIME",
    bridge: "MCP CONTEXT BRIDGE",
    bridgeActive: "ACTIVE",
    allContextFields: "All context fields",
    fieldStrategy: "STRATEGY",
    fieldExecution: "EXECUTION",
    executionPaperLocal: "Paper (Local)",
    fieldActiveBacktest: "ACTIVE BACKTEST",
    none: "None",
    fieldChartRange: "CHART RANGE",
    chartRangeDynamic: "Dynamic",
    bridgeNote: "The stdio MCP server reads this live SQLite workspace snapshot. No account credentials or exchange API keys are exposed.",
    copiedJson: "Copied JSON to clipboard",
    copyContextJson: "Copy Context JSON",
    paperTicket: "PAPER EXECUTION TICKET",
    simulated: "SIMULATED",
    available: (quote) => `${quote} AVAILABLE`,
    collateral: "COLLATERAL",
    position: (base) => `${base} POSITION`,
    closeFull: "Close 100%",
    closeFullHint: "Market close full position",
    unrealizedPnl: (value) => `uPnL ${value}`,
    positionAllocation: "POSITION ALLOCATION",
    sizingReference: (value) => `SIZING REF: ${value}`,
    sizingReferenceNote: "Percentage sizing and the notional estimate use this price. The Paper order still fills at the live quote.",
    reset: "Reset",
    quantity: (base) => `QUANTITY · ${base}`,
    toggleSizingSide: "Toggle sizing side",
    sizingHint: "Click to toggle between Quote (Buy) and Inventory (Sell) sizing",
    sizingBuy: "SIZING · BUY",
    sizingSell: "SIZING · SELL",
    setPercent: (percent, side) => `Set ${percent}% for ${side}`,
    max: "MAX",
    decreaseQuantity: "Decrease quantity",
    increaseQuantity: "Increase quantity",
    estimatedNotional: "ESTIMATED NOTIONAL",
    buy: "Buy",
    sell: "Sell",
    aiOrderPreview: "AI ORDER PREVIEW",
    previewSide: (side, quantity, base) => `${side.toUpperCase()} ${quantity} ${base}`,
    previewNumbers: (reference, estimated, quote, fee) => `Ref ${reference} · Est ${estimated} ${quote} · Fee ${fee}`,
    expires: (time) => `Expires: ${time}`,
    confirmPaper: "Confirm Paper",
    dismiss: "Dismiss",
    prtsSimulation: "PRTS SIMULATION",
    publicQuotes: "PUBLIC QUOTES",
    previewActionFailed: "Preview action failed.",
    paperOrderFailed: "Paper order failed.",
    paperSubmitFailed: "Could not submit paper order.",
    previewConfirmationSaved: "Confirmation saved · execution pending",
    previewConfirmed: "Paper preview confirmed · simulated order recorded",
    previewDismissed: "Preview dismissed",
    filledAtPublicQuote: (side) => `${side.toUpperCase()} filled in Paper at a public quote`,
    paperOrderCancelled: "Paper order cancelled",
    savedPaperStatus: (status) => `Saved Paper status: ${status}`,
    replayAccount: "REPLAY ACCOUNT",
    isolated: "ISOLATED",
    replayProtocol: "REPLAY PROTOCOL",
    awaitingSeed: "AWAITING SEED",
    replaySeedNote: "Time-travel simulation strictly isolates lookahead history. Seed the window on the chart bar to initialize local ledger state and execute paper fills.",
    replaySimulator: "REPLAY SIMULATOR",
    queueCloseHint: "Queue market sell of entire position on next bar",
    cursorClosePrice: "CURSOR CLOSE PRICE",
    cursorCloseHint: "Click to copy cursor close to limit/stop price input",
    priceAppliedToTrigger: (value) => `Price $${value} applied to limit/stop`,
    orderType: "ORDER TYPE",
    replayOrderType: "Replay order type",
    market: "Market",
    limit: "Limit",
    stop: "Stop",
    toggleReplaySizingSide: "Toggle replay sizing side",
    limitStopPrice: (quote) => `LIMIT / STOP PRICE · ${quote}`,
    stopLossOptional: "STOP LOSS (OPT)",
    takeProfitOptional: "TAKE PROFIT (OPT)",
    queueBuy: "Queue buy",
    queueSell: "Queue sell",
    cancel: "Cancel",
    sessionNotes: "SESSION NOTES",
    notesPlaceholder: "Record your entry reasoning...",
    tags: "TAGS · COMMA SEPARATED",
    tagsPlaceholder: "breakout, trend-following",
    saveNotesTags: "Save notes / tags",
    exportJournal: "Export journal JSON",
    marketCloseQueued: "Market close queued for next bar",
    limitStopRequired: "Limit/stop price is required and must be positive.",
    replayOrderFailed: "Replay order failed.",
    queuedForNextBar: (side) => `${side.toUpperCase()} queued for next bar`,
    journalSummary: (equity, quote, netPnl, fills, maxDrawdown) => `Equity: ${equity} ${quote} · Net PnL: ${netPnl} · ${fills} fills · Max DD: ${maxDrawdown}%`,
    tabBook: "Book",
    tabTrades: "Trades",
    tabStrategy: "Strategy",
    tabAi: "AI",
    ariaOrderBook: "Order book",
    ariaRecentTrades: "Recent trades",
    ariaStrategyLab: "Strategy lab",
    ariaAiContext: "AI context",
    paperAccountMode: "Paper wallet",
    legacyWallet: "Legacy pair wallet",
    sharedSpotWallet: "New shared spot wallet",
    priceAppliedToTicket: (value) => `Price $${value} applied to ticket`,
  },
  zh: {
    priceWithQuote: (quote) => `价格 (${quote})`,
    size: "规模",
    spread: "价差",
    staleNotice: "已过期 · 上次更新失败，显示上次数据。",
    pickAsk: (value) => `选取卖一 ${value}`,
    pickBid: (value) => `选取买一 ${value}`,
    pickTrade: (value) => `选取成交 ${value}`,
    pickHint: "点击将价格填入下单区",
    loadingDepth: "加载盘口",
    loadingPublicDepth: "加载公开盘口…",
    loadingTrades: "加载成交明细",
    loadingLatestTrades: "加载最新成交…",
    bookUnavailable: "盘口不可用。",
    bookInvalid: "盘口响应无效。",
    bookRequestFailed: "盘口请求失败。",
    depthStampStale: (exchange) => `已过期 · ${exchange} 公开盘口`,
    depthStamp: (exchange) => `${exchange} 盘口快照`,
    tradesUnavailable: "成交明细不可用。",
    tradesRequestFailed: "成交明细请求失败。",
    tradesStampStale: (exchange) => `已过期 · ${exchange} 公开成交`,
    tradesStamp: (exchange) => `${exchange} 公开数据流`,
    columnPrice: "价格",
    columnAmount: "数量",
    columnTime: "时间",
    bridge: "MCP 上下文桥",
    bridgeActive: "活跃",
    allContextFields: "全部上下文字段",
    fieldStrategy: "策略",
    fieldExecution: "执行",
    executionPaperLocal: "模拟盘（本地）",
    fieldActiveBacktest: "当前回测",
    none: "无",
    fieldChartRange: "图表区间",
    chartRangeDynamic: "动态",
    bridgeNote: "stdio MCP 服务读取这份实时 SQLite 工作台快照。不暴露任何账户凭证或交易所 API 密钥。",
    copiedJson: "JSON 已复制到剪贴板",
    copyContextJson: "复制上下文 JSON",
    paperTicket: "模拟盘下单区",
    simulated: "模拟",
    available: (quote) => `${quote} 可用`,
    collateral: "抵押金",
    position: (base) => `${base} 持仓`,
    closeFull: "100% 平仓",
    closeFullHint: "市价全平持仓",
    unrealizedPnl: (value) => `未实现盈亏 ${value}`,
    positionAllocation: "仓位占比",
    sizingReference: (value) => `${value} 规模参考价`,
    sizingReferenceNote: "比例下单与名义价值预估使用该价格；模拟盘仍按实时报价成交。",
    reset: "重置",
    quantity: (base) => `数量 · ${base}`,
    toggleSizingSide: "切换规模方向",
    sizingHint: "点击在报价（买入）与持仓（卖出）规模间切换",
    sizingBuy: "规模 · 买入",
    sizingSell: "规模 · 卖出",
    setPercent: (percent, side) => `将${side === "buy" ? "买入" : "卖出"}设为 ${percent}%`,
    max: "全部",
    decreaseQuantity: "减少数量",
    increaseQuantity: "增加数量",
    estimatedNotional: "预估名义价值",
    buy: "买入",
    sell: "卖出",
    aiOrderPreview: "AI 委托预览",
    previewSide: (side, quantity, base) => `${side === "buy" ? "买入" : "卖出"} ${quantity} ${base}`,
    previewNumbers: (reference, estimated, quote, fee) => `参考 ${reference} · 预估 ${estimated} ${quote} · 手续费 ${fee}`,
    expires: (time) => `到期: ${time}`,
    confirmPaper: "确认模拟",
    dismiss: "忽略",
    prtsSimulation: "PRTS 模拟",
    publicQuotes: "公开报价",
    previewActionFailed: "预览操作失败。",
    paperOrderFailed: "模拟盘下单失败。",
    paperSubmitFailed: "无法提交模拟盘委托。",
    previewConfirmationSaved: "确认已保存 · 待执行",
    previewConfirmed: "模拟预览已确认 · 已记录模拟委托",
    previewDismissed: "预览已忽略",
    filledAtPublicQuote: (side) => `${side === "buy" ? "买入" : "卖出"}已在模拟盘按公开报价成交`,
    paperOrderCancelled: "模拟盘委托已取消",
    savedPaperStatus: (status) => `已保存模拟状态: ${status}`,
    replayAccount: "回放账户",
    isolated: "隔离",
    replayProtocol: "回放协议",
    awaitingSeed: "等待种子",
    replaySeedNote: "时间旅行模拟严格隔离未来数据。在图表上播种窗口，以初始化本地账本状态并执行模拟成交。",
    replaySimulator: "回放模拟器",
    queueCloseHint: "在下一根 K 线市价卖出全部持仓",
    cursorClosePrice: "光标收盘价",
    cursorCloseHint: "点击将光标收盘价填入限价/止损价输入",
    priceAppliedToTrigger: (value) => `价格 $${value} 已填入限价/止损`,
    orderType: "委托类型",
    replayOrderType: "回放委托类型",
    market: "市价",
    limit: "限价",
    stop: "止损",
    toggleReplaySizingSide: "切换回放规模方向",
    limitStopPrice: (quote) => `限价 / 止损价 · ${quote}`,
    stopLossOptional: "止损（可选）",
    takeProfitOptional: "止盈（可选）",
    queueBuy: "排队买入",
    queueSell: "排队卖出",
    cancel: "取消",
    sessionNotes: "会话备注",
    notesPlaceholder: "记录你的入场理由...",
    tags: "标签 · 逗号分隔",
    tagsPlaceholder: "突破, 趋势跟随",
    saveNotesTags: "保存备注 / 标签",
    exportJournal: "导出日志 JSON",
    marketCloseQueued: "市价平仓已排队至下一根 K 线",
    limitStopRequired: "限价/止损价必填，且必须为正数。",
    replayOrderFailed: "回放委托失败。",
    queuedForNextBar: (side) => `${side === "buy" ? "买入" : "卖出"}已排队至下一根 K 线`,
    journalSummary: (equity, quote, netPnl, fills, maxDrawdown) => `权益: ${equity} ${quote} · 净盈亏: ${netPnl} · ${fills} 笔成交 · 最大回撤: ${maxDrawdown}%`,
    tabBook: "盘口",
    tabTrades: "成交",
    tabStrategy: "策略",
    tabAi: "AI",
    ariaOrderBook: "盘口",
    ariaRecentTrades: "成交明细",
    ariaStrategyLab: "策略实验室",
    ariaAiContext: "AI 上下文",
    paperAccountMode: "模拟盘钱包",
    legacyWallet: "旧版币对钱包",
    sharedSpotWallet: "新版共享现货钱包",
    priceAppliedToTicket: (value) => `价格 $${value} 已填入下单区`,
  },
};

function exchangeLabel(exchange: ExchangeId): string {
  return ({ binance: "Binance Spot", coinbaseexchange: "Coinbase Exchange", kraken: "Kraken Spot", okx: "OKX Spot" })[exchange];
}

function price(value: number | null | undefined): string {
  return typeof value === "number" && Number.isFinite(value)
    ? value.toLocaleString("en-US", { minimumFractionDigits: value < 1 ? 4 : 2, maximumFractionDigits: 6 })
    : "—";
}

interface InspectorProps {
  workspace?: "terminal" | "research" | "replay";
  summary: MarketSummary | null;
  result: BacktestResult | null;
  running: boolean;
  replayMode: boolean;
  replaySession: ReplaySession | null;
  replayPortfolio: PaperPortfolio | null;
  replayOrders: PaperOrder[];
  replayBusy: boolean;
  onRun: () => void;
  replayExecution: ReplayExecution | null;
  replayReport?: ReplayReport | null;
  onReplayCommand: (command: Record<string, unknown>) => Promise<void>;
  onReplayOrder: (side: "buy" | "sell", quantity: number, options?: Partial<ReplayOrderInput>) => Promise<void>;
}

interface PaperPayload {
  portfolio: PaperPortfolio;
  orders: PaperOrder[];
  mode: "paper";
}

function parseBook(payload: unknown): OrderBookSnapshot | null {
  if (typeof payload !== "object" || payload === null || !("bids" in payload) || !("asks" in payload)) return null;
  const candidate = payload as OrderBookSnapshot;
  if (!Array.isArray(candidate.bids) || !Array.isArray(candidate.asks)) return null;
  return candidate;
}

function parseTrades(payload: unknown): RecentTrade[] {
  if (typeof payload !== "object" || payload === null || !("items" in payload) || !Array.isArray(payload.items)) return [];
  return payload.items as RecentTrade[];
}

function parsePaper(payload: unknown): PaperPayload | null {
  if (typeof payload !== "object" || payload === null || !("portfolio" in payload) || !("orders" in payload)) return null;
  return payload as PaperPayload;
}

function parsePreviews(payload: unknown): OrderPreview[] {
  if (typeof payload !== "object" || payload === null || !("items" in payload) || !Array.isArray(payload.items)) return [];
  return payload.items as OrderPreview[];
}

function OrderBook({ symbol, exchange, active = true, onPickPrice }: { symbol: string; exchange: ExchangeId; active?: boolean; onPickPrice?: (price: number) => void }): React.JSX.Element {
  const copy = useCopy(INSPECTOR_COPY);
  const [book, setBook] = useState<OrderBookSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [stale, setStale] = useState(false);
  // Latest request wins: a newer refresh aborts the in-flight one, and only the
  // request that still owns the current id may publish results or errors.
  const requestRef = useRef(0);
  const controllerRef = useRef<AbortController | null>(null);
  const hasDataRef = useRef(false);

  useEffect(() => {
    if (!active) return;
    hasDataRef.current = false;
    const refresh = async (): Promise<void> => {
      const text = translate(INSPECTOR_COPY);
      requestRef.current += 1;
      const requestId = requestRef.current;
      controllerRef.current?.abort();
      const controller = new AbortController();
      controllerRef.current = controller;
      const { signal } = controller;
      try {
        const response = await fetch(`/api/market?kind=book&exchange=${exchange}&symbol=${encodeURIComponent(symbol)}`, { cache: "no-store", signal });
        const payload: unknown = await response.json();
        if (!response.ok) throw new Error(text.bookUnavailable);
        const parsed = parseBook(payload);
        if (!parsed) throw new Error(text.bookInvalid);
        if (requestId !== requestRef.current || signal.aborted) return;
        setBook(parsed);
        setError(null);
        setStale(false);
        hasDataRef.current = true;
      } catch (reason) {
        if (requestId !== requestRef.current || signal.aborted) return;
        setError(reason instanceof Error ? reason.message : text.bookRequestFailed);
        if (hasDataRef.current) setStale(true);
      }
    };
    void refresh();
    const interval = window.setInterval(() => { if (typeof document !== "undefined" && !document.hidden) void refresh(); }, exchange === "binance" ? 3_000 : 15_000);
    return () => {
      requestRef.current += 1;
      controllerRef.current?.abort();
      controllerRef.current = null;
      window.clearInterval(interval);
    };
  }, [symbol, exchange, active]);

  const validAmounts = [...(book?.bids ?? []), ...(book?.asks ?? [])]
    .map((level) => level.amount)
    .filter((amount) => Number.isFinite(amount) && amount > 0);
  const maxSize = Math.max(0.000001, ...validAmounts);
  const quote = symbol.split("/")[1] ?? "USDT";
  const bestAsk = book?.asks.find((level) => Number.isFinite(level.price) && level.price > 0)?.price ?? null;
  const bestBid = book?.bids.find((level) => Number.isFinite(level.price) && level.price > 0)?.price ?? null;
  const midPrice = bestAsk !== null && bestBid !== null ? (bestAsk + bestBid) / 2 : null;
  const spread = bestAsk !== null && bestBid !== null ? bestAsk - bestBid : null;

  return (
    <div className="orderbook-panel bg-[var(--ak-surface-canvas)] p-2.5 font-mono text-xs">
      <div className="book-columns flex justify-between text-[10px] text-[var(--ak-text-secondary)] uppercase font-mono pb-1 border-b border-[var(--ak-border-subtle)]">
        <span>{copy.priceWithQuote(quote)}</span>
        <span>{copy.size}</span>
      </div>
      {error && !book && <div className="small-error text-xs text-[var(--ak-signal-danger)] p-1">{error}</div>}
      {stale && book && <div role="alert" className="small-error text-xs text-[var(--ak-signal-danger)] p-1">{copy.staleNotice}</div>}

      {!book && !error && (
        <div className="book-skeleton py-1 space-y-1 opacity-40 animate-pulse motion-reduce:animate-none">
          {[...Array(5)].map((_, i) => (
            <div key={`skel-ask-${i}`} className="flex justify-between py-0.5 px-1 text-[11px]">
              <span className="w-16 h-3 bg-red-500/20 rounded-[2px]" />
              <span className="w-10 h-3 bg-[var(--ak-surface-raised)] rounded-[2px]" />
            </div>
          ))}
          <div className="my-1 py-1 px-1.5 bg-[var(--ak-surface-sunken)] border-y border-[var(--ak-border-subtle)] flex items-center justify-between">
            <span className="w-20 h-4 bg-[var(--ak-surface-raised)] rounded-[2px]" />
            <span className="w-14 h-3 bg-[var(--ak-surface-raised)] rounded-[2px]" />
          </div>
          {[...Array(5)].map((_, i) => (
            <div key={`skel-bid-${i}`} className="flex justify-between py-0.5 px-1 text-[11px]">
              <span className="w-16 h-3 bg-emerald-500/20 rounded-[2px]" />
              <span className="w-10 h-3 bg-[var(--ak-surface-raised)] rounded-[2px]" />
            </div>
          ))}
        </div>
      )}

      <div className="asks-ladder py-0.5 space-y-0.5">
        {book?.asks.slice(0, 5).reverse().map((level, index) => (
          <button
            type="button"
            className="book-row ask relative flex justify-between py-[2px] px-1 hover:bg-red-950/25 cursor-pointer select-none group transition-colors text-[11px] leading-tight w-full text-left"
            key={`ask-${index}`}
            onClick={() => onPickPrice?.(level.price)}
            aria-label={copy.pickAsk(price(level.price))}
            title={copy.pickHint}
          >
            <span
              className="depth-bar absolute right-0 top-0 bottom-0 pointer-events-none transition-all duration-300"
              style={{
                width: `${Math.min(100, Math.max(3, ((level.amount || 0) / maxSize) * 100))}%`,
                background: "linear-gradient(90deg, rgba(227, 59, 59, 0.04) 0%, rgba(227, 59, 59, 0.28) 100%)",
                borderLeft: "2px solid rgba(227, 59, 59, 0.6)",
                boxShadow: "inset 0 0 8px rgba(227, 59, 59, 0.15)",
              }}
            />
            <span className="text-[var(--ak-signal-danger)] font-bold tabular-nums group-hover:underline z-10">{price(level.price)}</span>
            <span className="text-[var(--ak-text-secondary)] tabular-nums z-10">{level.amount.toFixed(4)}</span>
          </button>
        ))}
      </div>

      {midPrice !== null && (
        <div className="book-mid my-1 py-0.5 px-2 bg-[var(--ak-surface-sunken-2)] border-y border-[var(--ak-signal-info)]/30 flex items-center justify-between font-mono shadow-sm">
          <div className="flex items-center gap-1.5">
            <span className="w-1.5 h-1.5 rounded-full bg-[var(--ak-signal-info)] animate-pulse motion-reduce:animate-none" />
            <strong className="text-xs font-bold text-[var(--ak-text-primary)] tabular-nums">{price(midPrice)}</strong>
          </div>
          <span className="book-spread text-[10px] text-[var(--ak-text-secondary)] flex items-center gap-1">
            <em className="not-italic opacity-70">{copy.spread}</em>
            <b className="text-[var(--ak-signal-action)] tabular-nums">{price(spread)}</b>
          </span>
        </div>
      )}

      <div className="bids-ladder py-0.5 space-y-0.5">
        {book?.bids.slice(0, 5).map((level, index) => (
          <button
            type="button"
            className="book-row bid relative flex justify-between py-[2px] px-1 hover:bg-emerald-950/25 cursor-pointer select-none group transition-colors text-[11px] leading-tight w-full text-left"
            key={`bid-${index}`}
            onClick={() => onPickPrice?.(level.price)}
            aria-label={copy.pickBid(price(level.price))}
            title={copy.pickHint}
          >
            <span
              className="depth-bar absolute right-0 top-0 bottom-0 pointer-events-none transition-all duration-300"
              style={{
                width: `${Math.min(100, Math.max(3, ((level.amount || 0) / maxSize) * 100))}%`,
                background: "linear-gradient(90deg, rgba(70, 196, 124, 0.04) 0%, rgba(70, 196, 124, 0.28) 100%)",
                borderLeft: "2px solid rgba(70, 196, 124, 0.6)",
                boxShadow: "inset 0 0 8px rgba(70, 196, 124, 0.15)",
              }}
            />
            <span className="text-[var(--ak-signal-success)] font-bold tabular-nums group-hover:underline z-10">{price(level.price)}</span>
            <span className="text-[var(--ak-text-secondary)] tabular-nums z-10">{level.amount.toFixed(4)}</span>
          </button>
        ))}
      </div>

      {!book && !error && (
        <div className="book-loading p-4 text-center text-xs text-[var(--ak-text-secondary)] flex items-center justify-center gap-2">
          <AkSpinner color="#18d1ff" label={copy.loadingDepth} />
          <span>{copy.loadingPublicDepth}</span>
        </div>
      )}
      <div className="data-stamp text-[9px] text-[var(--ak-text-secondary)] opacity-60 mt-2 text-right">
        {error ? copy.depthStampStale(exchangeLabel(exchange)) : copy.depthStamp(exchangeLabel(exchange))}
      </div>
    </div>
  );
}

function RecentTrades({ symbol, exchange, active = true, onPickPrice }: { symbol: string; exchange: ExchangeId; active?: boolean; onPickPrice?: (price: number) => void }): React.JSX.Element {
  const copy = useCopy(INSPECTOR_COPY);
  const [trades, setTrades] = useState<RecentTrade[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [stale, setStale] = useState(false);
  // Latest request wins: a newer refresh aborts the in-flight one, and only the
  // request that still owns the current id may publish results or errors.
  const requestRef = useRef(0);
  const controllerRef = useRef<AbortController | null>(null);
  const hasDataRef = useRef(false);

  useEffect(() => {
    if (!active) return;
    hasDataRef.current = false;
    const refresh = async (): Promise<void> => {
      const text = translate(INSPECTOR_COPY);
      requestRef.current += 1;
      const requestId = requestRef.current;
      controllerRef.current?.abort();
      const controller = new AbortController();
      controllerRef.current = controller;
      const { signal } = controller;
      try {
        const response = await fetch(`/api/market?kind=trades&exchange=${exchange}&symbol=${encodeURIComponent(symbol)}`, { cache: "no-store", signal });
        const payload: unknown = await response.json();
        if (!response.ok) throw new Error(text.tradesUnavailable);
        const next = parseTrades(payload);
        if (requestId !== requestRef.current || signal.aborted) return;
        setTrades(next);
        setError(null);
        setStale(false);
        hasDataRef.current = true;
      } catch (reason) {
        if (requestId !== requestRef.current || signal.aborted) return;
        setError(reason instanceof Error ? reason.message : text.tradesRequestFailed);
        if (hasDataRef.current) setStale(true);
      }
    };
    void refresh();
    const interval = window.setInterval(() => { if (typeof document !== "undefined" && !document.hidden) void refresh(); }, exchange === "binance" ? 3_000 : 15_000);
    return () => {
      requestRef.current += 1;
      controllerRef.current?.abort();
      controllerRef.current = null;
      window.clearInterval(interval);
    };
  }, [symbol, exchange, active]);

  return (
    <div className="recent-trades-panel bg-[var(--ak-surface-canvas)] p-2.5 font-mono text-xs">
      <div className="trades-columns flex justify-between text-[10px] text-[var(--ak-text-secondary)] uppercase pb-1 border-b border-[var(--ak-border-subtle)]">
        <span>{copy.columnPrice}</span>
        <span>{copy.columnAmount}</span>
        <span>{copy.columnTime}</span>
      </div>
      {error && trades.length === 0 && <div className="small-error text-xs text-[var(--ak-signal-danger)] p-1">{error}</div>}
      {stale && trades.length > 0 && <div role="alert" className="small-error text-xs text-[var(--ak-signal-danger)] p-1">{copy.staleNotice}</div>}

      <div className="trades-list space-y-0.5 py-1">
        {trades.slice(0, 14).map((trade) => {
          const isBuy = trade.side === "buy";
          return (
            <button
              type="button"
              className="trade-row flex justify-between py-0.5 px-1 hover:bg-[var(--ak-surface-sunken)] cursor-pointer select-none group w-full text-left"
              key={trade.id}
              onClick={() => onPickPrice?.(trade.price)}
              aria-label={copy.pickTrade(price(trade.price))}
              title={copy.pickHint}
            >
              <span className={`font-bold tabular-nums group-hover:underline flex items-center gap-1 ${isBuy ? "text-[var(--ak-signal-success)]" : "text-[var(--ak-signal-danger)]"}`}>
                {isBuy ? <ArrowUpRight size={10} /> : <ArrowDownRight size={10} />}
                {price(trade.price)}
              </span>
              <span className="text-[var(--ak-text-secondary)] tabular-nums">{trade.amount.toFixed(4)}</span>
              <span className="text-[10px] text-[var(--ak-text-secondary)] tabular-nums opacity-70">
                {new Date(trade.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
              </span>
            </button>
          );
        })}
      </div>

      {trades.length === 0 && !error && (
        <div className="book-loading p-4 text-center text-xs text-[var(--ak-text-secondary)] flex items-center justify-center gap-2">
          <AkSpinner color="#18d1ff" label={copy.loadingTrades} />
          <span>{copy.loadingLatestTrades}</span>
        </div>
      )}
      <div className="data-stamp text-[9px] text-[var(--ak-text-secondary)] opacity-60 mt-2 text-right">
        {error ? copy.tradesStampStale(exchangeLabel(exchange)) : copy.tradesStamp(exchangeLabel(exchange))}
      </div>
    </div>
  );
}

function WorkspaceContext(): React.JSX.Element {
  const copy = useCopy(INSPECTOR_COPY);
  const state = useWorkspaceStore(useShallow((workspace) => ({
    symbol: workspace.symbol,
    exchange: workspace.exchange,
    timeframe: workspace.timeframe,
    activeWorkspace: workspace.activeWorkspace,
    selectedStrategyId: workspace.selectedStrategyId,
    activeBacktestId: workspace.activeWorkspace === "replay" ? null : workspace.activeBacktestId,
    activeReplayId: workspace.activeReplayId,
    mode: workspace.mode,
    visibleRange: workspace.visibleRange,
  })));
  const [copied, setCopied] = useState(false);
  const context = useMemo(() => ({
    ...state,
    quoteScope: "public market data only; paper portfolio is local; live trading disabled",
  }), [state]);

  const copyContext = async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(JSON.stringify(context, null, 2));
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      setCopied(false);
    }
  };

  return (
    <div className="context-panel p-3 bg-[var(--ak-surface-canvas)] space-y-3 font-mono text-xs">
      <div className="context-callout flex items-center justify-between p-2 bg-[var(--ak-surface-sunken)] border border-[var(--ak-border-subtle)]">
        <div className="flex items-center gap-1.5">
          <Braces size={13} className="text-[var(--ak-signal-info)]" />
          <span className="font-bold text-xs tracking-wider">{copy.bridge}</span>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="w-1.5 h-1.5 rounded-full bg-[var(--ak-signal-info)]" />
          <span className="text-[10px] text-[var(--ak-signal-info)] uppercase">{copy.bridgeActive}</span>
        </div>
      </div>

      {/* Eight equally-weighted label/value pairs at 9px uppercase read as a wall.
          Lead with the one line that answers "where am I", and fold the rest into
          a disclosure the reader opens only when they need to check a field. */}
      <div className="context-summary flex items-baseline gap-2 px-2 py-1.5 bg-[var(--ak-surface-sunken-2)] border border-[var(--ak-border-subtle)]">
        <strong className="text-sm font-mono text-[var(--ak-text-primary)] truncate">{state.symbol}</strong>
        <span className="text-[10px] font-mono text-[var(--ak-text-secondary)]">{state.timeframe}</span>
        <span className="text-[10px] font-mono text-[var(--ak-text-secondary)] opacity-70 truncate">{exchangeLabel(state.exchange)}</span>
        <span className="ml-auto text-[10px] font-mono text-[var(--ak-signal-info)] uppercase">{state.activeWorkspace}</span>
      </div>

      <details className="context-details text-[10px] text-[var(--ak-text-secondary)] font-mono">
        <summary className="cursor-pointer opacity-70 hover:opacity-100 py-0.5">{copy.allContextFields}</summary>
        <div className="context-list grid grid-cols-2 gap-1.5 p-2 mt-1 bg-[var(--ak-surface-sunken-2)] border border-[var(--ak-border-subtle)]">
          <ContextField label={copy.fieldStrategy} value={state.selectedStrategyId} />
          <ContextField label={copy.fieldExecution} value={copy.executionPaperLocal} />
          <ContextField label={copy.fieldActiveBacktest} value={state.activeBacktestId ? `${state.activeBacktestId.slice(0, 10)}…` : copy.none} />
          <ContextField
            label={copy.fieldChartRange}
            value={state.visibleRange.from && state.visibleRange.to
              ? `${new Date(state.visibleRange.from).toISOString().slice(5, 10)} → ${new Date(state.visibleRange.to).toISOString().slice(5, 10)}`
              : copy.chartRangeDynamic}
          />
        </div>
        <p className="context-note opacity-70 leading-normal mt-1.5 m-0">
          {copy.bridgeNote}
        </p>
      </details>

      <Button
        variant="outline"
        size="sm"
        block
        onClick={() => void copyContext()}
        icon={copied ? <Check size={13} className="text-[var(--ak-signal-success)]" /> : <Copy size={13} />}
        className="text-xs"
      >
        {copied ? copy.copiedJson : copy.copyContextJson}
      </Button>
    </div>
  );
}

function ContextField({ label, value }: { label: string; value: string }): React.JSX.Element {
  return (
    <div className="context-field flex flex-col p-1">
      <span className="text-[9px] text-[var(--ak-text-secondary)] opacity-70 uppercase tracking-wider">{label}</span>
      <strong className="text-xs text-[var(--ak-text-primary)] truncate font-mono">{value}</strong>
    </div>
  );
}

function PaperTicket({
  symbol,
  summary,
  prefilledPrice,
  onClearPrefilledPrice,
}: {
  symbol: string;
  summary: MarketSummary | null;
  prefilledPrice?: number | null;
  onClearPrefilledPrice?: () => void;
}): React.JSX.Element {
  const copy = useCopy(INSPECTOR_COPY);
  const exchange = useWorkspaceStore((state) => state.exchange);
  const [portfolio, setPortfolio] = useState<PaperPortfolio | null>(null);
  const [previews, setPreviews] = useState<OrderPreview[]>([]);
  const [quantity, setQuantity] = useState("0.001");
  const [sizingSide, setSizingSide] = useState<"buy" | "sell">("buy");
  const [busy, setBusy] = useState(false);
  const [resolvingPreview, setResolvingPreview] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const mode = useWorkspaceStore((state) => state.mode);
  const number = Number(quantity);
  const canBuy = mode === "paper" && !busy && Number.isFinite(number) && number > 0;
  const canSell = canBuy && portfolio !== null && number <= portfolio.baseBalance;
  const referencePrice = prefilledPrice ?? summary?.last ?? null;
  const quote = symbol.split("/")[1] ?? "USDT";
  const base = symbol.split("/")[0] ?? "BTC";

  useEffect(() => {
    let disposed = false;
    const refresh = async (): Promise<void> => {
      try {
        const response = await fetch(`/api/paper?symbol=${encodeURIComponent(symbol)}&exchange=${exchange}`, { cache: "no-store" });
        const payload: unknown = await response.json();
        const parsed = parsePaper(payload);
        if (response.ok && parsed && !disposed) setPortfolio(parsed.portfolio);
        const previewResponse = await fetch(`/api/order-previews?symbol=${encodeURIComponent(symbol)}&exchange=${exchange}`, { cache: "no-store" });
        const previewPayload: unknown = await previewResponse.json();
        if (previewResponse.ok && !disposed) setPreviews(parsePreviews(previewPayload).filter((preview) => preview.status === "prepared"));
      } catch {
        if (!disposed) setPortfolio(null);
      }
    };
    void refresh();
    const interval = window.setInterval(() => { if (typeof document !== "undefined" && !document.hidden) void refresh(); }, 8_000);
    return () => { disposed = true; window.clearInterval(interval); };
  }, [symbol, notice, exchange]);

  const resolvePreview = async (previewId: string, action: "confirm" | "dismiss"): Promise<void> => {
    const text = translate(INSPECTOR_COPY);
    setResolvingPreview(previewId);
    setError(null);
    try {
      const response = await fetch(`/api/order-previews/${encodeURIComponent(previewId)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      const payload: unknown = await response.json();
      if (!response.ok) {
        const message = typeof payload === "object" && payload !== null && "error" in payload && typeof payload.error === "string" ? payload.error : text.previewActionFailed;
        throw new Error(message);
      }
      setNotice(response.status === 202 ? text.previewConfirmationSaved : action === "confirm" ? text.previewConfirmed : text.previewDismissed);
      const refresh = await fetch(`/api/paper?symbol=${encodeURIComponent(symbol)}&exchange=${exchange}`, { cache: "no-store" });
      const account = parsePaper(await refresh.json());
      if (refresh.ok && account) setPortfolio(account.portfolio);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : text.previewActionFailed);
    } finally {
      setResolvingPreview(null);
    }
  };

  const submit = async (side: "buy" | "sell", orderQuantity = number): Promise<void> => {
    const text = translate(INSPECTOR_COPY);
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const clientOrderId = globalThis.crypto?.randomUUID?.() ?? `paper-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
      const response = await fetch("/api/paper", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clientOrderId, symbol, side, quantity: orderQuantity, mode: "paper", exchange }),
      });
      const payload: unknown = await response.json();
      if (!response.ok && response.status !== 202) {
        const message = typeof payload === "object" && payload !== null && "error" in payload && typeof payload.error === "string" ? payload.error : text.paperOrderFailed;
        throw new Error(message);
      }
      if (typeof payload === "object" && payload !== null && "portfolio" in payload) {
        const p = (payload as { portfolio?: unknown }).portfolio;
        if (typeof p === "object" && p !== null && "quoteBalance" in p) setPortfolio(p as PaperPortfolio);
      }
      const savedOrder = typeof payload === "object" && payload !== null && "order" in payload ? payload.order as PaperOrder : null;
      if (savedOrder?.status === "filled") setNotice(text.filledAtPublicQuote(side));
      else if (savedOrder?.status === "cancelled") setNotice(text.paperOrderCancelled);
      else setNotice(text.savedPaperStatus(savedOrder?.status ?? "unavailable"));
      window.setTimeout(() => setNotice(null), 3_500);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : text.paperSubmitFailed);
    } finally {
      setBusy(false);
    }
  };

  const submitRef = useRef(submit);
  useEffect(() => {
    submitRef.current = submit;
  });

  useEffect(() => {
    const handleBuy = () => {
      if (canBuy) {
        void submitRef.current("buy");
      }
    };
    const handleSell = () => {
      if (canSell) {
        void submitRef.current("sell");
      }
    };
    window.addEventListener("newbeing:hotkey-buy", handleBuy);
    window.addEventListener("newbeing:hotkey-sell", handleSell);
    return () => {
      window.removeEventListener("newbeing:hotkey-buy", handleBuy);
      window.removeEventListener("newbeing:hotkey-sell", handleSell);
    };
  }, [canBuy, canSell]);

  // Quick percentage calculators for supreme tactile feel
  const applyPercent = (pct: number, side: "buy" | "sell"): void => {
    if (!portfolio || referencePrice === null || !Number.isFinite(referencePrice) || referencePrice <= 0) return;
    if (side === "buy") {
      const feeRate = portfolio.feeRate ?? 0.001;
      const avail = Math.max(0, portfolio.quoteBalance) * pct;
      const budget = avail / (1 + feeRate);
      const computed = budget / referencePrice;
      const qty = floorToDecimals(computed, 4);
      setQuantity(qty > 0 ? qty.toString() : "0");
    } else {
      if (pct === 1) {
        setQuantity(portfolio.baseBalance > 0 ? portfolio.baseBalance.toString() : "0");
      } else {
        const computed = Math.max(0, portfolio.baseBalance) * pct;
        const qty = floorToDecimals(computed, 4);
        setQuantity(qty > 0 ? qty.toString() : "0");
      }
    }
  };

  const stepQuantity = (direction: -1 | 1): void => {
    const current = Number(quantity) || 0;
    const step = current >= 1 ? 0.1 : current >= 0.1 ? 0.01 : 0.001;
    const next = Math.max(0.0001, Number((current + direction * step).toFixed(4)));
    setQuantity(String(next));
  };

  const activePortfolio = portfolio;
  const activePreviews = previews;
  const estimated = referencePrice !== null && Number.isFinite(number) ? number * referencePrice : null;
  const pnl = activePortfolio && referencePrice !== null && activePortfolio.averageEntryPrice !== null
    ? activePortfolio.baseBalance * (referencePrice - activePortfolio.averageEntryPrice)
    : 0;

  return (
    <div className="paper-ticket p-2.5 bg-[var(--ak-surface-canvas)] space-y-2 font-mono text-xs border-t border-[var(--ak-border-subtle)]">
      <div className="ticket-heading flex items-center justify-between pb-1 border-b border-[var(--ak-border-subtle)]">
        <div className="flex items-center gap-1.5">
          <Wallet size={13} className="text-[var(--ak-signal-action)]" />
          <span className="font-bold text-xs tracking-wider">{copy.paperTicket}</span>
        </div>
        <AkTag variant="advanced" className="text-[10px]">{copy.simulated}</AkTag>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <div className="telemetry-kpi-card">
          <span className="kpi-label">{copy.available(quote)}</span>
          <strong className="kpi-val text-[var(--ak-text-primary)]">
            {activePortfolio ? `$${activePortfolio.quoteBalance.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : "—"}
          </strong>
          <small className="text-[9px] text-[var(--ak-text-secondary)] opacity-60 mt-1">{copy.collateral}</small>
        </div>
        <div className="telemetry-kpi-card">
          <div className="flex items-center justify-between">
            <span className="kpi-label">{copy.position(base)}</span>
            {activePortfolio && activePortfolio.baseBalance > 0 && (
              <button
                type="button"
                disabled={busy}
                onClick={() => {
                  setQuantity(activePortfolio.baseBalance.toString());
                  void submit("sell", activePortfolio.baseBalance);
                }}
                className="ticket-close-full text-[9px] px-1 py-0.5 bg-rose-950/40 hover:bg-rose-900/60 border border-rose-500/40 text-rose-300 font-bold uppercase transition-all active:scale-95 cursor-pointer"
                title={copy.closeFullHint}
              >
                {copy.closeFull}
              </button>
            )}
          </div>
          <strong className="kpi-val text-[var(--ak-text-primary)]">
            {activePortfolio ? `${activePortfolio.baseBalance.toFixed(5)} ${base}` : "—"}
          </strong>
          <small className={`text-[10px] font-bold tabular-nums mt-1 ${pnl >= 0 ? "text-[var(--ak-signal-success)]" : "text-[var(--ak-signal-danger)]"}`}>
            {copy.unrealizedPnl(`${pnl >= 0 ? "+" : ""}${pnl.toFixed(2)} ${quote}`)}
          </small>
        </div>
      </div>

      {activePortfolio && (
        <div className="allocation-bar px-1 py-0.5">
          {(() => {
            const quoteBal = activePortfolio.quoteBalance;
            const posVal = referencePrice ? activePortfolio.baseBalance * referencePrice : 0;
            const totalEq = quoteBal + posVal;
            const pct = totalEq > 0 ? Math.min(100, Math.max(0, Math.round((posVal / totalEq) * 100))) : 0;
            return (
              <AkProgress
                value={pct}
                max={100}
                label={copy.positionAllocation}
                valueLabel={`${pct}%`}
                size="sm"
                variant={pct > 80 ? "danger" : pct > 50 ? "warning" : "default"}
              />
            );
          })()}
        </div>
      )}

      {prefilledPrice !== null && prefilledPrice !== undefined && (
        <div className="flex items-center justify-between px-2 py-1 bg-[var(--ak-surface-sunken-2)] border border-[var(--ak-signal-info)] text-[10px] text-[var(--ak-signal-info)] font-mono">
          <span className="tabular-nums" title={copy.sizingReferenceNote}>{copy.sizingReference(`${price(prefilledPrice)} ${quote}`)}</span>
          {onClearPrefilledPrice && (
            <button
              type="button"
              onClick={onClearPrefilledPrice}
              className="text-[var(--ak-text-secondary)] hover:text-white underline cursor-pointer"
            >
              {copy.reset}
            </button>
          )}
        </div>
      )}

      <div className="ticket-field flex flex-col gap-1.5">
        <div className="flex items-center justify-between">
          <label htmlFor="paper-qty" className="text-[10px] font-bold text-[var(--ak-text-secondary)] uppercase tracking-wider">
            {copy.quantity(base)}
          </label>
          <button
            type="button"
            aria-label={copy.toggleSizingSide}
            onClick={() => setSizingSide((prev) => (prev === "buy" ? "sell" : "buy"))}
            className="ticket-sizing-toggle text-[9px] px-1.5 py-0.5 bg-[var(--ak-surface-sunken-2)] border border-[var(--ak-border-subtle)] text-[var(--ak-signal-info)] hover:text-white uppercase font-bold transition-all cursor-pointer"
            title={copy.sizingHint}
          >
            {sizingSide === "buy" ? copy.sizingBuy : copy.sizingSell}
          </button>
        </div>
        <div className="grid grid-cols-4 gap-1.5">
          {([0.25, 0.5, 0.75, 1] as const).map((pct) => (
            <button
              key={pct}
              type="button"
              onClick={() => applyPercent(pct, sizingSide)}
              className="ticket-percent tactile-chip text-[10px] py-1 text-[var(--ak-text-secondary)] hover:text-[var(--ak-text-primary)] hover:border-[var(--ak-signal-info)] cursor-pointer font-mono font-bold text-center select-none"
              title={copy.setPercent(String(pct * 100), sizingSide)}
            >
              {pct === 1 ? copy.max : `${pct * 100}%`}
            </button>
          ))}
        </div>
        <div className="ticket-stepper flex items-stretch h-8 border border-[var(--ak-border-subtle)] bg-[var(--ak-surface-sunken-2)] focus-within:border-[var(--ak-signal-info)] transition-colors shadow-inner">
          <button
            type="button"
            onClick={() => stepQuantity(-1)}
            className="w-8 shrink-0 flex items-center justify-center text-[var(--ak-text-secondary)] hover:text-white hover:bg-[var(--ak-surface-raised)] border-r border-[var(--ak-border-subtle)] active:bg-[var(--ak-signal-info)] active:text-black transition-all text-sm font-bold cursor-pointer select-none"
            title={copy.decreaseQuantity}
            aria-label={copy.decreaseQuantity}
          >
            −
          </button>
          <AkInput
            id="paper-qty"
            data-testid="paper-quantity"
            aria-label={copy.quantity(base)}
            type="number"
            min="0"
            step="0.0001"
            value={quantity}
            onChange={(event) => setQuantity(event.target.value)}
            className="h-full text-xs font-mono flex-1 min-w-0 border-0 bg-transparent shadow-none"
          />
          <button
            type="button"
            onClick={() => stepQuantity(1)}
            className="w-8 shrink-0 flex items-center justify-center text-[var(--ak-text-secondary)] hover:text-white hover:bg-[var(--ak-surface-raised)] border-l border-[var(--ak-border-subtle)] active:bg-[var(--ak-signal-info)] active:text-black transition-all text-sm font-bold cursor-pointer select-none"
            title={copy.increaseQuantity}
            aria-label={copy.increaseQuantity}
          >
            +
          </button>
        </div>
      </div>

      <div className="ticket-estimate flex items-center justify-between p-2 bg-[var(--ak-surface-sunken)] border border-[var(--ak-border-subtle)] shadow-inner">
        <span className="text-[10px] text-[var(--ak-text-secondary)] uppercase font-bold tracking-wider">{copy.estimatedNotional}</span>
        <strong className="text-xs text-[var(--ak-text-primary)] font-bold">
          {estimated === null ? "—" : `$${estimated.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${quote}`}
        </strong>
      </div>

      <div className="ticket-actions grid grid-cols-2 gap-2 pt-1">
        <Button
          data-testid="paper-buy"
          variant="primary"
          size="sm"
          disabled={!canBuy}
          onClick={() => void submit("buy")}
          icon={<TrendingUp size={13} />}
          style={{ background: "var(--c-up)", color: "#000" }}
          className="h-8 font-bold text-xs border-0 transition-[filter,transform] duration-150 hover:brightness-110 active:translate-y-[1px] active:scale-[0.98] disabled:opacity-50 disabled:pointer-events-none"
        >
          {copy.buy}
        </Button>
        <Button
          variant="danger"
          size="sm"
          disabled={!canSell}
          onClick={() => void submit("sell")}
          icon={<TrendingDown size={13} />}
          style={{ background: "var(--c-down)", color: "#000" }}
          className="h-8 font-bold text-xs border-0 transition-[filter,transform] duration-150 hover:brightness-110 active:translate-y-[1px] active:scale-[0.98] disabled:opacity-50 disabled:pointer-events-none"
        >
          {copy.sell}
        </Button>
      </div>

      {activePreviews.map((preview) => (
        <div className="order-preview-card p-2 bg-[var(--ak-surface-sunken-2)] border-l-2 border-[var(--ak-signal-action)] space-y-1.5" key={preview.id}>
          <div className="preview-topline flex items-center justify-between">
            <span className="text-[10px] font-bold text-[var(--ak-signal-info)]">{copy.aiOrderPreview}</span>
            <AkTag variant="advanced" className="text-[9px]">{preview.status.toUpperCase()}</AkTag>
          </div>
          <strong className={`block text-xs font-bold ${preview.side === "buy" ? "text-[var(--ak-signal-success)]" : "text-[var(--ak-signal-danger)]"}`}>
            {copy.previewSide(preview.side, String(preview.quantity), base)}
          </strong>
          <div className="text-[10px] text-[var(--ak-text-secondary)] space-y-0.5">
            <div>{copy.previewNumbers(price(preview.referencePrice), price(preview.estimatedNotional), quote, price(preview.estimatedFee))}</div>
            <div>{copy.expires(new Date(preview.expiresAt).toLocaleTimeString())}</div>
          </div>
          <div className="preview-actions flex gap-2 pt-1">
            <Button size="sm" variant="primary" className="h-6 text-[10px]" disabled={resolvingPreview === preview.id} onClick={() => void resolvePreview(preview.id, "confirm")}>
              {copy.confirmPaper}
            </Button>
            <Button size="sm" variant="ghost" className="h-6 text-[10px]" disabled={resolvingPreview === preview.id} onClick={() => void resolvePreview(preview.id, "dismiss")}>
              {copy.dismiss}
            </Button>
          </div>
        </div>
      ))}

      {error && <div className="error-inline text-xs text-[var(--ak-signal-danger)] p-1.5 bg-red-950/20 border border-red-800/40">{error}</div>}
      {notice && <div className="success-inline text-xs text-[var(--ak-signal-success)] p-1.5 bg-emerald-950/20 border border-emerald-800/40">{notice}</div>}
      <div className="ticket-disclaimer flex items-center justify-between text-[8px] text-[var(--ak-text-secondary)] opacity-60 font-mono tracking-wider pt-0.5">
        <div className="flex items-center gap-1">
          <span className="w-1 h-1 rounded-full bg-[var(--ak-signal-info)]" />
          <span>{copy.prtsSimulation}</span>
        </div>
        <span>{copy.publicQuotes}</span>
      </div>
    </div>
  );
}

function ReplayTicket({
  symbol,
  session,
  portfolio,
  orders,
  busy,
  onOrder,
  execution,
  report: serverReport = null,
  onCommand,
}: {
  execution: ReplayExecution | null;
  report?: ReplayReport | null;
  onCommand: (command: Record<string, unknown>) => Promise<void>;
  symbol: string;
  session: ReplaySession | null;
  portfolio: PaperPortfolio | null;
  orders: PaperOrder[];
  busy: boolean;
  onOrder: (side: "buy" | "sell", quantity: number, options?: Partial<ReplayOrderInput>) => Promise<void>;
}): React.JSX.Element {
  const copy = useCopy(INSPECTOR_COPY);
  const [quantity, setQuantity] = useState("0.001");
  const [sizingSide, setSizingSide] = useState<"buy" | "sell">("buy");
  const [orderType, setOrderType] = useState<ReplayOrderInput["type"]>("market");
  const [trigger, setTrigger] = useState("");
  const [stopLoss, setStopLoss] = useState("");
  const [takeProfit, setTakeProfit] = useState("");
  const [notes, setNotes] = useState(execution?.notes ?? "");
  const [tags, setTags] = useState(execution?.tags.join(", ") ?? "");
  const [ticketError, setTicketError] = useState<string | null>(null);
  const [ticketNotice, setTicketNotice] = useState<string | null>(null);
  const size = Number(quantity);
  const current = session?.bars.at(-1);
  const triggerPrice = Number(trigger);
  const canBuy = !!session && session.status === "active" && !!portfolio && !!current && !busy &&
    Number.isFinite(size) && size > 0 &&
    (orderType === "market" || (Number.isFinite(triggerPrice) && triggerPrice > 0));
  const canSell = canBuy && !!portfolio && size <= portfolio.baseBalance;

  const submit = (side: "buy" | "sell"): void => {
    const text = translate(INSPECTOR_COPY);
    setTicketError(null);
    setTicketNotice(null);
    const triggerNum = Number(trigger);
    if (orderType !== "market" && (!Number.isFinite(triggerNum) || triggerNum <= 0)) {
      setTicketError(text.limitStopRequired);
      return;
    }
    void onOrder(side, Number(quantity), {
      type: orderType,
      ...(orderType !== "market" ? { price: triggerNum } : {}),
      ...(side === "buy" && stopLoss ? { stopLoss: Number(stopLoss) } : {}),
      ...(side === "buy" && takeProfit ? { takeProfit: Number(takeProfit) } : {}),
    }).then(() => {
      setTicketNotice(text.queuedForNextBar(side));
      window.setTimeout(() => setTicketNotice(null), 3000);
    }).catch((reason) => {
      setTicketError(reason instanceof Error ? reason.message : text.replayOrderFailed);
      window.setTimeout(() => setTicketError(null), 4000);
    });
  };

  const submitRef = useRef(submit);
  useEffect(() => {
    submitRef.current = submit;
  });

  useEffect(() => {
    const handleBuy = () => {
      if (canBuy) {
        submitRef.current("buy");
      }
    };
    const handleSell = () => {
      if (canSell) {
        submitRef.current("sell");
      }
    };
    window.addEventListener("newbeing:hotkey-buy", handleBuy);
    window.addEventListener("newbeing:hotkey-sell", handleSell);
    return () => {
      window.removeEventListener("newbeing:hotkey-buy", handleBuy);
      window.removeEventListener("newbeing:hotkey-sell", handleSell);
    };
  }, [canBuy, canSell]);
  const unrealized = portfolio && current && portfolio.averageEntryPrice !== null
    ? portfolio.baseBalance * (current.close - portfolio.averageEntryPrice)
    : 0;
  const quote = symbol.split("/")[1] ?? "USDT";
  const base = symbol.split("/")[0] ?? "BTC";

  const applyPercent = (pct: number, side: "buy" | "sell"): void => {
    if (!portfolio || !current || !Number.isFinite(current.close) || current.close <= 0) return;
    if (side === "buy") {
      const feeRate = portfolio.feeRate ?? 0.001;
      const avail = Math.max(0, portfolio.quoteBalance) * pct;
      const budget = avail / (1 + feeRate);
      const computed = budget / current.close;
      const qty = floorToDecimals(computed, 4);
      setQuantity(qty > 0 ? qty.toString() : "0");
    } else {
      if (pct === 1) {
        setQuantity(portfolio.baseBalance > 0 ? portfolio.baseBalance.toString() : "0");
      } else {
        const computed = Math.max(0, portfolio.baseBalance) * pct;
        const qty = floorToDecimals(computed, 4);
        setQuantity(qty > 0 ? qty.toString() : "0");
      }
    }
  };

  const stepQuantity = (direction: -1 | 1): void => {
    const currentQty = Number(quantity) || 0;
    const step = currentQty >= 1 ? 0.1 : currentQty >= 0.1 ? 0.01 : 0.001;
    const next = Math.max(0.0001, Number((currentQty + direction * step).toFixed(4)));
    setQuantity(String(next));
  };

  if (!session || !portfolio || !current) {
    return (
      <div className="paper-ticket replay-ticket p-3 bg-[var(--ak-surface-canvas)] font-mono text-xs space-y-3">
        <div className="ticket-heading flex items-center justify-between pb-1 border-b border-[var(--ak-border-subtle)]">
          <div className="flex items-center gap-1.5">
            <Clock3 size={13} className="text-[var(--ak-signal-info)]" />
            <span className="font-bold">{copy.replayAccount}</span>
          </div>
          <AkTag variant="advanced" className="text-[10px]">{copy.isolated}</AkTag>
        </div>
        <div className="p-3 bg-[var(--ak-surface-sunken-2)] border border-[var(--ak-border-subtle)] space-y-2">
          <div className="text-[10px] font-bold text-[var(--ak-text-secondary)] uppercase flex items-center justify-between">
            <span>{copy.replayProtocol}</span>
            <span className="text-[var(--ak-signal-action)] flex items-center gap-1">
              <span className="w-1.5 h-1.5 rounded-full bg-[var(--ak-signal-action)] animate-pulse motion-reduce:animate-none inline-block" />
              {copy.awaitingSeed}
            </span>
          </div>
          <span className="ticket-disclaimer text-[10px] text-[var(--ak-text-secondary)] opacity-80 block leading-relaxed">
            {copy.replaySeedNote}
          </span>
        </div>
      </div>
    );
  }

  /* The server already computed this report from the same last revealed close.
     Reusing it avoids rescanning the growing equity array on every render. */
  const report = serverReport ?? (execution ? replayReport(execution, current.close) : null);
  const exportJournal = (): void => {
    if (!execution || !report) return;
    const url = URL.createObjectURL(new Blob([JSON.stringify({ session, execution, report }, null, 2)], { type: "application/json" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = `replay-${session.id}.json`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 0);
  };

  return (
    <div className="paper-ticket replay-ticket p-3 bg-[var(--ak-surface-canvas)] space-y-2.5 font-mono text-xs border-t border-[var(--ak-border-subtle)]">
      <div className="ticket-heading flex items-center justify-between pb-1 border-b border-[var(--ak-border-subtle)]">
        <div className="flex items-center gap-1.5">
          <Clock3 size={13} className="text-[var(--ak-signal-info)]" />
          <span className="font-bold">{copy.replaySimulator}</span>
        </div>
        <AkTag variant={session.status === "active" ? "default" : "neutral"} className="text-[10px]">
          {session.status.toUpperCase()}
        </AkTag>
      </div>

      <div className="grid grid-cols-2 gap-2 bg-[var(--ak-surface-sunken)] p-2 border border-[var(--ak-border-subtle)]">
        <div className="flex flex-col">
          <span className="text-[9px] text-[var(--ak-text-secondary)] uppercase">{copy.available(quote)}</span>
          <strong className="text-xs text-[var(--ak-text-primary)] font-bold tabular-nums">
            ${portfolio.quoteBalance.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </strong>
        </div>
        <div className="flex flex-col">
          <div className="flex items-center justify-between">
            <span className="text-[9px] text-[var(--ak-text-secondary)] uppercase">{copy.position(base)}</span>
            {portfolio.baseBalance > 0 && (
              <button
                type="button"
                disabled={busy || session.status !== "active"}
                onClick={() => {
                  void onOrder("sell", portfolio.baseBalance, { type: "market" }).then(() => {
                    setTicketNotice(translate(INSPECTOR_COPY).marketCloseQueued);
                    window.setTimeout(() => setTicketNotice(null), 3000);
                  });
                }}
                className="ticket-close-full text-[9px] px-1 py-0.5 bg-rose-950/40 hover:bg-rose-900/60 border border-rose-500/40 text-rose-300 font-bold uppercase transition-all active:scale-95 cursor-pointer"
                title={copy.queueCloseHint}
              >
                {copy.closeFull}
              </button>
            )}
          </div>
          <strong className="text-xs text-[var(--ak-text-primary)] font-bold tabular-nums">
            {portfolio.baseBalance.toFixed(6)} {base}
          </strong>
          <small className={`text-[10px] font-bold tabular-nums ${unrealized >= 0 ? "text-[var(--ak-signal-success)]" : "text-[var(--ak-signal-danger)]"}`}>
            {copy.unrealizedPnl(`${unrealized >= 0 ? "+" : ""}${unrealized.toFixed(2)} ${quote}`)}
          </small>
        </div>
      </div>

      <div
        className="ticket-estimate flex items-center justify-between p-1.5 bg-[var(--ak-surface-sunken)] border border-[var(--ak-border-subtle)] hover:border-[var(--ak-signal-info)] cursor-pointer transition-colors"
        onClick={() => {
          if (current) {
            setTrigger(current.close.toString());
            setTicketNotice(translate(INSPECTOR_COPY).priceAppliedToTrigger(price(current.close)));
            window.setTimeout(() => setTicketNotice(null), 2500);
          }
        }}
        title={copy.cursorCloseHint}
      >
        <span className="text-[10px] text-[var(--ak-text-secondary)] uppercase">{copy.cursorClosePrice}</span>
        <strong className="text-xs text-[var(--ak-text-primary)] font-bold tabular-nums hover:underline">{price(current.close)} {quote}</strong>
      </div>

      <div className="replay-order-grid grid grid-cols-2 gap-2">
        <label className="ticket-field flex flex-col gap-1">
          <span className="text-[10px] font-bold text-[var(--ak-text-secondary)] uppercase">{copy.orderType}</span>
          <AkSelect
            aria-label={copy.replayOrderType}
            value={orderType}
            onChange={(event) => {
              const nextType = event.target.value as ReplayOrderInput["type"];
              setOrderType(nextType);
              if (nextType !== "market" && !trigger && current) {
                setTrigger(current.close.toString());
              }
            }}
            className="h-7 text-xs font-bold"
          >
            <option value="market">{copy.market}</option>
            <option value="limit">{copy.limit}</option>
            <option value="stop">{copy.stop}</option>
          </AkSelect>
        </label>
        <div className="ticket-field flex flex-col gap-1.5">
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-bold text-[var(--ak-text-secondary)] uppercase">{copy.quantity(base)}</span>
            <button
              type="button"
              aria-label={copy.toggleReplaySizingSide}
              onClick={() => setSizingSide((prev) => (prev === "buy" ? "sell" : "buy"))}
              className="ticket-sizing-toggle text-[9px] px-1.5 py-0.5 bg-[var(--ak-surface-sunken-2)] border border-[var(--ak-border-subtle)] text-[var(--ak-signal-info)] hover:text-white uppercase font-bold transition-all cursor-pointer"
              title={copy.sizingHint}
            >
              {sizingSide === "buy" ? copy.sizingBuy : copy.sizingSell}
            </button>
          </div>
          <div className="grid grid-cols-4 gap-1">
            {([0.25, 0.5, 0.75, 1] as const).map((pct) => (
              <button
                key={pct}
                type="button"
                onClick={() => applyPercent(pct, sizingSide)}
                className="ticket-percent text-[10px] py-0.5 bg-[var(--ak-surface-sunken-2)] border border-[var(--ak-border-subtle)] text-[var(--ak-text-secondary)] hover:text-[var(--ak-text-primary)] hover:border-[var(--ak-signal-info)] active:scale-95 transition-all cursor-pointer font-mono font-bold text-center"
                title={copy.setPercent(String(pct * 100), sizingSide)}
              >
                {pct === 1 ? copy.max : `${pct * 100}%`}
              </button>
            ))}
          </div>
          <div className="ticket-stepper flex items-stretch h-8 border border-[var(--ak-border-subtle)] bg-[var(--ak-surface-sunken-2)] focus-within:border-[var(--ak-signal-info)] transition-colors">
            <button
              type="button"
              onClick={() => stepQuantity(-1)}
              className="w-8 shrink-0 flex items-center justify-center text-[var(--ak-text-secondary)] hover:text-white hover:bg-[var(--ak-surface-raised)] border-r border-[var(--ak-border-subtle)] active:bg-[var(--ak-signal-info)] active:text-black transition-all text-sm font-bold cursor-pointer select-none"
              title={copy.decreaseQuantity}
              aria-label={copy.decreaseQuantity}
            >
              −
            </button>
            <AkInput
              type="number"
              aria-label={copy.quantity(base)}
              min="0"
              step="0.0001"
              value={quantity}
              onChange={(event) => setQuantity(event.target.value)}
              className="h-full text-xs font-mono flex-1 min-w-0 border-0 bg-transparent shadow-none"
            />
            <button
              type="button"
              onClick={() => stepQuantity(1)}
              className="w-8 shrink-0 flex items-center justify-center text-[var(--ak-text-secondary)] hover:text-white hover:bg-[var(--ak-surface-raised)] border-l border-[var(--ak-border-subtle)] active:bg-[var(--ak-signal-info)] active:text-black transition-all text-sm font-bold cursor-pointer select-none"
              title={copy.increaseQuantity}
              aria-label={copy.increaseQuantity}
            >
              +
            </button>
          </div>
        </div>
      </div>

      <div className="ticket-estimate flex items-center justify-between p-1.5 bg-[var(--ak-surface-sunken)] border border-[var(--ak-border-subtle)]">
        <span className="text-[10px] text-[var(--ak-text-secondary)] uppercase">{copy.estimatedNotional}</span>
        <strong className="text-xs text-[var(--ak-text-primary)] font-bold tabular-nums">
          {Number.isFinite(size) && size > 0 ? `$${(size * current.close).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${quote}` : "—"}
        </strong>
      </div>

      {orderType !== "market" && (
        <label className="ticket-field flex flex-col gap-1">
          <span className="text-[10px] font-bold text-[var(--ak-text-secondary)] uppercase">{copy.limitStopPrice(quote)}</span>
          <AkInput
            type="number"
            min="0"
            step="any"
            value={trigger}
            onChange={(event) => setTrigger(event.target.value)}
            className="h-7 text-xs font-mono"
          />
        </label>
      )}

      <div className="grid grid-cols-2 gap-2">
        <label className="ticket-field flex flex-col gap-1">
          <span className="text-[10px] text-[var(--ak-text-secondary)] uppercase">{copy.stopLossOptional}</span>
          <AkInput
            type="number"
            min="0"
            step="any"
            value={stopLoss}
            onChange={(event) => setStopLoss(event.target.value)}
            className="h-7 text-xs font-mono"
          />
        </label>
        <label className="ticket-field flex flex-col gap-1">
          <span className="text-[10px] text-[var(--ak-text-secondary)] uppercase">{copy.takeProfitOptional}</span>
          <AkInput
            type="number"
            min="0"
            step="any"
            value={takeProfit}
            onChange={(event) => setTakeProfit(event.target.value)}
            className="h-7 text-xs font-mono"
          />
        </label>
      </div>

      <div className="ticket-actions grid grid-cols-2 gap-2 pt-1">
        <Button
          variant="primary"
          size="sm"
          disabled={!canBuy}
          onClick={() => submit("buy")}
          onMouseEnter={() => setSizingSide("buy")}
          icon={<TrendingUp size={13} />}
          className="h-8 font-bold text-xs bg-gradient-to-r from-emerald-600 to-emerald-500 hover:from-emerald-500 hover:to-emerald-400 text-white shadow-[0_0_12px_rgba(16,185,129,0.3)] hover:shadow-[0_0_20px_rgba(16,185,129,0.5)] border-0"
        >
          {copy.queueBuy}
        </Button>
        <Button
          variant="danger"
          size="sm"
          disabled={!canSell}
          onClick={() => submit("sell")}
          onMouseEnter={() => setSizingSide("sell")}
          icon={<TrendingDown size={13} />}
          className="h-8 font-bold text-xs bg-gradient-to-r from-rose-600 to-rose-500 hover:from-rose-500 hover:to-rose-400 text-white shadow-[0_0_12px_rgba(244,63,94,0.3)] hover:shadow-[0_0_20px_rgba(244,63,94,0.5)] border-0"
        >
          {copy.queueSell}
        </Button>
      </div>

      {ticketError && <div className="error-inline text-xs text-[var(--ak-signal-danger)] p-1.5 bg-red-950/20 border border-red-800/40">{ticketError}</div>}
      {ticketNotice && <div className="success-inline text-xs text-[var(--ak-signal-success)] p-1.5 bg-emerald-950/20 border border-emerald-800/40">{ticketNotice}</div>}

      {orders.length > 0 && (
        <div className="space-y-1 max-h-32 overflow-auto p-1 bg-[var(--ak-surface-sunken-2)] border border-[var(--ak-border-subtle)]">
          {orders.slice().reverse().map((order) => (
            <div className="flex items-center justify-between p-1 text-[10px] border-b border-[var(--ak-border-subtle)]" key={order.clientOrderId}>
              <span className={`font-bold tabular-nums ${order.side === "buy" ? "text-[var(--ak-signal-success)]" : "text-[var(--ak-signal-danger)]"}`}>
                {order.side.toUpperCase()} {order.quantity} · {order.status}
              </span>
              <span className="text-[var(--ak-text-secondary)] tabular-nums">{order.fillPrice === null ? "—" : price(order.fillPrice)}</span>
              {order.status === "submitted" && (
                <Button size="sm" variant="ghost" className="h-5 text-[9px] px-1" disabled={busy} onClick={() => void onCommand({ action: "cancel", clientOrderId: order.clientOrderId }).catch(() => undefined)}>
                  {copy.cancel}
                </Button>
              )}
            </div>
          ))}
        </div>
      )}

      <div className="space-y-1.5 pt-1 border-t border-[var(--ak-border-subtle)]">
        <label className="ticket-field flex flex-col gap-1">
          <span className="text-[10px] font-bold text-[var(--ak-text-secondary)] uppercase">{copy.sessionNotes}</span>
          <textarea
            aria-label={copy.sessionNotes}
            value={notes}
            maxLength={20_000}
            onChange={(event) => setNotes(event.target.value)}
            className="p-1.5 bg-[var(--ak-surface-sunken)] border border-[var(--ak-border)] text-xs font-mono outline-none h-14 resize-none"
            placeholder={copy.notesPlaceholder}
          />
        </label>
        <label className="ticket-field flex flex-col gap-1">
          <span className="text-[10px] font-bold text-[var(--ak-text-secondary)] uppercase">{copy.tags}</span>
          <AkInput
            aria-label={copy.tags}
            value={tags}
            onChange={(event) => setTags(event.target.value)}
            className="h-7 text-xs font-mono"
            placeholder={copy.tagsPlaceholder}
          />
        </label>
        <div className="flex gap-2">
          <Button size="sm" variant="subtle" className="flex-1 h-7 text-xs" disabled={busy} onClick={() => void onCommand({ action: "journal", notes, tags: tags.split(",").map((tag) => tag.trim()).filter(Boolean) }).catch(() => undefined)}>
            {copy.saveNotesTags}
          </Button>
          <Button size="sm" variant="outline" className="flex-1 h-7 text-xs" disabled={busy || !execution} onClick={exportJournal}>
            {copy.exportJournal}
          </Button>
        </div>
      </div>

      {report && (
        <div className="ticket-disclaimer text-[10px] text-[var(--ak-text-secondary)] p-1.5 bg-[var(--ak-surface-sunken)] border border-[var(--ak-border-subtle)]">
          {copy.journalSummary(price(report.equity), quote, price(report.netPnl), report.fillCount, (report.maxDrawdown * 100).toFixed(2))}
        </div>
      )}
    </div>
  );
}

export function Inspector({ workspace = "terminal", summary, result, running, replayMode, replaySession, replayPortfolio, replayOrders, replayExecution, replayReport: serverReplayReport = null, onReplayCommand, replayBusy, onRun, onReplayOrder }: InspectorProps): React.JSX.Element {
  const copy = useCopy(INSPECTOR_COPY);
  const [paperMode, setPaperMode] = useState<"legacy" | "shared-spot">("legacy");
  const [symbol, exchange, tab, setTab] = useWorkspaceStore(useShallow((state) => [state.symbol, state.exchange, state.inspectorTab, state.setInspectorTab]));
  /* A depth price belongs to one instrument. Keying it by instrument makes a
     stale pick unusable after a symbol swap instead of needing to be cleared —
     a BTC depth price once sized an ETH order an order of magnitude off. */
  const instrumentKey = `${exchange}|${symbol}`;
  const [picked, setPicked] = useState<{ key: string; price: number } | null>(null);
  const [pickedNotice, setPickedNotice] = useState<{ key: string; text: string } | null>(null);
  const pickedPrice = picked?.key === instrumentKey ? picked.price : null;
  const priceNotice = pickedNotice?.key === instrumentKey ? pickedNotice.text : null;

  const handlePickPrice = (p: number) => {
    setPicked({ key: instrumentKey, price: p });
    setPickedNotice({ key: instrumentKey, text: translate(INSPECTOR_COPY).priceAppliedToTicket(price(p)) });
    window.setTimeout(() => setPickedNotice(null), 2500);
  };

  const tabsForWorkspace =
    workspace === "terminal" ? (["book", "trades", "strategy", "context"] as const)
      : workspace === "research" ? (["book", "trades", "strategy", "context"] as const)
        : (["context"] as const);
  const offered = (replayMode ? (["context"] as const) : tabsForWorkspace) as readonly string[];
  const selectedTab: string = offered.includes(tab) ? tab : (offered[0] ?? "context");
  /* Keep visited panels mounted (hidden) so switching back is instant and the
     order book, editor, and ticket state survive the tab change. Book/trades
     polling is paused while hidden instead of running in the background. */
  const [visitedTabs, setVisitedTabs] = useState<readonly string[]>(() => [selectedTab]);
  if (!visitedTabs.includes(selectedTab)) setVisitedTabs([...visitedTabs, selectedTab]);

  return (
    <aside className="inspector-panel h-full border-l border-[var(--ak-border-strong)]">
      <Tabs
        value={selectedTab}
        onValueChange={(value) => setTab(value as "book" | "trades" | "strategy" | "context")}
        className={`inspector-tabs flex flex-col min-h-0 ${selectedTab === "strategy" ? "flex-1" : "flex-initial"}`}
      >
        <TabsList className="inspector-tab-list flex border-b border-[var(--ak-border-strong)] bg-[var(--ak-surface-sunken)]">
          {offered.includes("book") && (
            <TabsTrigger value="book" aria-label={copy.ariaOrderBook} className="flex-1 py-2 text-xs font-bold tracking-wider uppercase">
              <BookOpen size={13} className="mr-1 text-[var(--ak-signal-info)]" />
              <span>{copy.tabBook}</span>
            </TabsTrigger>
          )}
          {offered.includes("trades") && (
            <TabsTrigger value="trades" aria-label={copy.ariaRecentTrades} className="flex-1 py-2 text-xs font-bold tracking-wider uppercase">
              <History size={13} className="mr-1 text-[var(--ak-signal-action)]" />
              <span>{copy.tabTrades}</span>
            </TabsTrigger>
          )}
          {offered.includes("strategy") && (
            <TabsTrigger value="strategy" aria-label={copy.ariaStrategyLab} className="flex-1 py-2 text-xs font-bold tracking-wider uppercase">
              <Layers3 size={13} className="mr-1 text-[var(--ak-signal-info)]" />
              <span>{copy.tabStrategy}</span>
            </TabsTrigger>
          )}
          {offered.includes("context") && (
            <TabsTrigger value="context" aria-label={copy.ariaAiContext} className="flex-1 py-2 text-xs font-bold tracking-wider uppercase">
              <Braces size={13} className="mr-1 text-[var(--ak-signal-info)]" />
              <span>{copy.tabAi}</span>
            </TabsTrigger>
          )}
        </TabsList>

        <div className={`overflow-auto min-h-0 ${selectedTab === "strategy" ? "flex-1" : ""}`}>
          {visitedTabs.includes("book") && <TabsContent value="book" forceMount><OrderBook key={`${exchange}|${symbol}`} symbol={symbol} exchange={exchange} active={selectedTab === "book"} onPickPrice={handlePickPrice} /></TabsContent>}
          {visitedTabs.includes("trades") && <TabsContent value="trades" forceMount><RecentTrades key={`${exchange}|${symbol}`} symbol={symbol} exchange={exchange} active={selectedTab === "trades"} onPickPrice={handlePickPrice} /></TabsContent>}
          {visitedTabs.includes("strategy") && <TabsContent value="strategy" forceMount><StrategyLab onRun={onRun} running={running} /></TabsContent>}
          {visitedTabs.includes("context") && <TabsContent value="context" forceMount><WorkspaceContext /></TabsContent>}
        </div>
      </Tabs>

      {priceNotice && (
        <div role="status" className="mx-2 mt-1 px-2 py-0.5 bg-[var(--ak-surface-sunken-2)] border-l-2 border-[var(--ak-signal-info)] text-[10px] text-[var(--ak-signal-info)] font-mono">
          {priceNotice}
        </div>
      )}

      {replayMode ? (
        <ReplayTicket
          key={replaySession?.id ?? "empty"}
          execution={replayExecution}
          report={serverReplayReport}
          onCommand={onReplayCommand}
          symbol={symbol}
          session={replaySession}
          portfolio={replayPortfolio}
          orders={replayOrders}
          busy={replayBusy}
          onOrder={onReplayOrder}
        />
      ) : (
        selectedTab !== "strategy" && (
          <div className="flex-1 overflow-auto min-h-0 flex flex-col justify-between">
            <div>
              <div className="px-3 py-1.5 bg-[var(--ak-surface-sunken-2)] border-b border-[var(--ak-border-subtle)] flex items-center justify-between shadow-[inset_0_1px_2px_rgba(0,0,0,0.4)]">
                <label className="flex items-center justify-between gap-2 w-full text-[10px] font-mono font-bold text-[var(--ak-text-secondary)] uppercase">
                  <span className="flex items-center gap-1.5 tracking-wider">
                    <span className="w-1.5 h-1.5 rounded-full bg-[var(--ak-signal-action)] shadow-[0_0_6px_var(--ak-signal-action)]" />
                    {copy.paperAccountMode}
                  </span>
                  <AkSelect
                    aria-label={copy.paperAccountMode}
                    value={paperMode}
                    onChange={(event) => setPaperMode(event.target.value as "legacy" | "shared-spot")}
                    className="h-6 text-xs font-mono min-w-[155px] bg-[var(--c-surface)] border-[var(--ak-border)] text-[var(--ak-text-primary)]"
                  >
                    <option value="legacy">{copy.legacyWallet}</option>
                    <option value="shared-spot">{copy.sharedSpotWallet}</option>
                  </AkSelect>
                </label>
              </div>

              {paperMode === "shared-spot" ? (
                <SharedSpotTicket key={`${exchange}|${symbol}`} exchange={exchange} symbol={symbol} referencePrice={pickedPrice ?? summary?.ask ?? summary?.last ?? null} />
              ) : (
                <PaperTicket key={`${exchange}|${symbol}`} symbol={symbol} summary={summary} prefilledPrice={pickedPrice} onClearPrefilledPrice={() => setPicked(null)} />
              )}
            </div>

            <div className="border-t border-[var(--ak-border-subtle)] bg-[var(--ak-surface-sunken)]">
              <PaperRecoveryPanel />
            </div>
          </div>
        )
      )}
    </aside>
  );
}
