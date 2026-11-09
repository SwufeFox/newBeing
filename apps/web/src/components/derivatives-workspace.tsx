"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { memo, useEffect, useMemo, useRef, useState } from "react";
import { Activity } from "lucide-react";
import { AkInput, AkPopover, AkSelect, AkTag } from "@swufefox/ak-ui-react";
import type { Candle } from "@newbeing/core";
import { CandlestickSeries, ColorType, createChart, type IChartApi, type ISeriesApi, type UTCTimestamp } from "lightweight-charts";
import type { DerivativeInstrument, DerivativeKind, DerivativeQuote } from "@newbeing/market-data/derivatives";
import type { DerivativesAccount, DerivativesOrderRequest, DerivativesPosition } from "@newbeing/application/derivatives-types";
import { Button } from "@/components/ui/button";
import { WORKSPACE_PATH } from "@/lib/workspace-routes";
import { useWorkspaceStore } from "@/store/workspace";
import { derivativeNumber, derivativeDate, derivativeBlockCode, derivativePositionIsExpired, derivativeUnrealized, derivativeOptionChain, derivativeExpiryLabel, derivativeQuoteSnapshotIsStale, type DerivativeBlockCode } from "@/lib/derivatives-ui";
import { chartPalette, type ChartPalette } from "@/lib/chart-palette";
import { usePreferences } from "@/lib/preferences";
import { translate, useCopy, type CopyTable } from "@/lib/i18n";

const KINDS: readonly DerivativeKind[] = ["perpetual", "future", "option"];

interface DerivativesCopy {
  /* workspace shell */
  title: string;
  navLabel: string;
  workflowLabel: string;
  markets: string;
  research: string;
  replay: string;
  derivatives: string;
  workspaceShortcut: (label: string, num: string) => string;
  switchShortcut: (label: string, num: string) => string;
  currentWorkspaceAria: string;
  currentWorkspaceTitle: string;
  paperLiveOff: string;
  /* market plate */
  kinds: Record<DerivativeKind, string>;
  kindEyebrow: Record<DerivativeKind, string>;
  selectContract: string;
  bidTag: string;
  askTag: string;
  mark: string;
  index: string;
  strike: string;
  iv: string;
  delta: string;
  expiry: string;
  funding: string;
  openInterest: string;
  perpetual: string;
  fixture: string;
  publicRealtime: string;
  noQuote: string;
  refresh: string;
  replayBanner: string;
  openMainTerminal: string;
  /* instrument rail */
  marketsAria: string;
  longOptionsOnly: string;
  noVenues: string;
  linearContractsLine: (venues: string) => string;
  contractBrowser: string;
  instruments: string;
  searchDerivatives: string;
  searchContracts: string;
  expirySettlement: string;
  premiumPerBase: (pair: string) => string;
  retryChainQuotes: string;
  loadingBatchQuotes: string;
  liveDataHidden: string;
  loadingInstruments: string;
  retry: string;
  noMatchingContracts: string;
  strikeGroup: (strike: string) => string;
  missingAtStrike: (right: string) => string;
  call: string;
  put: string;
  linear: string;
  coin: string;
  inverseViewOnly: string;
  option: string;
  /* contract details */
  marketDataAria: string;
  contractDetails: string;
  retryQuote: string;
  expiredNotice: string;
  delistedNotice: string;
  position: string;
  contractSize: string;
  minStep: string;
  priceTick: string;
  margin: string;
  entryPrice: string;
  status: string;
  positionValue: (side: string, quantity: string) => string;
  frozenAwaiting: string;
  localLedgerOnly: string;
  paidPremium: string;
  isolated: string;
  allFields: string;
  nativeId: string;
  settlement: string;
  underlyingIndex: string;
  quoteTime: string;
  nextFunding: string;
  /* candles */
  candlesAria: string;
  priceHistory: string;
  liveHistoryHidden: string;
  liveHistoryUnavailable: string;
  optionCandlesUnsupported: string;
  noCandleData: string;
  selectContractCandles: string;
  candleImageAria: string;
  /* account */
  accountAria: string;
  frozenSnapshotTitle: string;
  pageTitle: string;
  paperAccount: (suffix: string) => string;
  refreshSnapshot: string;
  refreshLedger: string;
  ledgerUnavailable: (detail: string) => string;
  loadingLocalAccounts: string;
  noPaperAccountsStored: string;
  noLocalAccounts: string;
  noAccountForSettlement: string;
  available: string;
  realizedPnl: string;
  feesPaid: string;
  positions: string;
  positionsWithCount: (count: number) => string;
  noOpenPositions: string;
  orderHistoryWithCount: (count: number) => string;
  orderHistoryShowing: (shown: number, total: number) => string;
  loadOlder: string;
  loadingOlder: string;
  loadOlderFailed: string;
  noPaperFills: string;
  positionColumns: readonly string[];
  ledgerPositionColumns: readonly string[];
  orderColumns: readonly string[];
  viewPosition: (instrumentId: string) => string;
  frozen: string;
  close: string;
  frozenLedgerNote: string;
  localLedgerNote: string;
  ledgerReadOnlyNote: string;
  ledgerHint: string;
  /* paper ticket */
  ticketAria: string;
  paperTicket: string;
  separateAccount: string;
  entryHidden: string;
  orderEntryPaused: string;
  pausedExpired: string;
  pausedDelisted: string;
  pausedListLoading: string;
  pausedGeneric: string;
  accountUnavailable: string;
  loadingPaperAccount: string;
  initialBalance: string;
  seedNote: (settle: string) => string;
  openPaperAccount: string;
  action: string;
  orderActionAria: string;
  buyToOpen: string;
  open: string;
  sellToClose: string;
  closeReduceOnly: string;
  positionSide: string;
  positionSideAria: string;
  long: string;
  short: string;
  quantityContracts: string;
  step: (step: string) => string;
  quantityAria: string;
  decreaseContracts: string;
  increaseContracts: string;
  size: string;
  max: string;
  isolatedLeverage: string;
  isolatedLeverageAria: string;
  preset: string;
  buyCeiling: (unit: string) => string;
  sellFloor: (unit: string) => string;
  settleFallback: string;
  priceProtectionAria: string;
  fill: string;
  fillWithBid: string;
  fillWithMark: string;
  fillWithAsk: string;
  bidButton: (value: string) => string;
  markButton: (value: string) => string;
  askButton: (value: string) => string;
  reduceOnlyNote: string;
  immediateFillNote: string;
  submitting: string;
  submitOrder: string;
  checkingFreshness: string;
  fundingNote: string;
  /* status bar and engine policy */
  localWorkspace: (identity: string) => string;
  noContract: string;
  statusbar: string;
  engineModel: string;
  engineTitle: string;
  engineEyebrow: string;
  engineFill: string;
  engineMargin: string;
  engineFunding: string;
  engineExpiry: string;
  engineOptions: string;
  engineUnknown: string;
  /* quote caption and errors */
  snapshotTitle: (date: string) => string;
  noBookSnapshot: string;
  stalePrefix: string;
  requestFailed: string;
  exchangeResources: Record<"contracts" | "quote" | "candles" | "chainQuotes", string>;
  exchangeUnreachable: (resource: string) => string;
  exchangeLoadFailed: (resource: string, detail: string | null) => string;
  ledgerUnavailableDefault: string;
  reasonNeedsQuote: string;
  reasonSelectContract: string;
  blockReasons: Record<DerivativeBlockCode, string>;
  invalidOrder: string;
  accountOpened: string;
  orderConfirmed: string;
  orderFilled: string;
  commandFailed: string;
  commandFailedRefresh: (detail: string) => string;
}

/**
 * English is byte-identical to the pre-i18n strings so tests, screenshots and
 * muscle memory keep working. Symbols, venue names, timeframe tokens and the
 * quote abbreviations (B / M / A) stay literal in both languages.
 */
const DERIVATIVES_COPY: CopyTable<DerivativesCopy> = {
  en: {
    title: "/ Derivatives",
    navLabel: "Workspace navigation",
    workflowLabel: "Research workflow",
    markets: "Markets",
    research: "Research",
    replay: "Replay",
    derivatives: "Derivatives",
    workspaceShortcut: (label, num) => `${label} workspace, shortcut ${num}`,
    switchShortcut: (label, num) => `Switch to ${label} with ${num}`,
    currentWorkspaceAria: "Current workspace: Derivatives, shortcut 4",
    currentWorkspaceTitle: "Current workspace: Derivatives [4]",
    paperLiveOff: "PAPER · LIVE OFF",
    kinds: { perpetual: "Perpetuals", future: "Futures", option: "Options" },
    kindEyebrow: { perpetual: "PERPETUAL SWAP", future: "DATED FUTURE", option: "OPTION" },
    selectContract: "SELECT A CONTRACT",
    bidTag: "Bid",
    askTag: "Ask",
    mark: "Mark",
    index: "Index",
    strike: "Strike",
    iv: "IV",
    delta: "Delta",
    expiry: "Expiry",
    funding: "Funding",
    openInterest: "OI",
    perpetual: "Perpetual",
    fixture: "FIXTURE · TEST DATA",
    publicRealtime: "PUBLIC REALTIME",
    noQuote: "NO QUOTE",
    refresh: "Refresh",
    replayBanner: "Live derivative markets and Paper actions are paused during Replay. The local Paper ledger remains available below as a read-only snapshot. Return to Markets in the main terminal to resume.",
    openMainTerminal: "Open main terminal",
    marketsAria: "Derivative markets",
    longOptionsOnly: "Deribit · Long options only",
    noVenues: "No venues",
    linearContractsLine: (venues) => `${venues} · Linear contracts`,
    contractBrowser: "Contract browser",
    instruments: "Instruments",
    searchDerivatives: "Search derivatives",
    searchContracts: "Search contracts",
    expirySettlement: "Expiry and settlement",
    premiumPerBase: (pair) => `${pair} · premium per base · B / mark / A reference`,
    retryChainQuotes: "Retry chain quotes",
    loadingBatchQuotes: "Loading batch reference quotes…",
    liveDataHidden: "Live data hidden while Paper is disabled.",
    loadingInstruments: "Loading instruments…",
    retry: "Retry",
    noMatchingContracts: "No matching contracts.",
    strikeGroup: (strike) => `Strike ${strike}`,
    missingAtStrike: (right) => `No ${right} at this strike`,
    call: "call",
    put: "put",
    linear: "Linear",
    coin: "Coin",
    inverseViewOnly: "Inverse · view only",
    option: "Option",
    marketDataAria: "Contract market data",
    contractDetails: "Contract details",
    retryQuote: "Retry quote",
    expiredNotice: "This contract has expired. The venue no longer publishes its live metadata or quote; the local position is frozen awaiting official settlement.",
    delistedNotice: "This contract is not in the current contract list. Only the locally stored position terms are shown; live quotes and candles are unavailable.",
    position: "Position",
    contractSize: "Contract size",
    minStep: "Min / step",
    priceTick: "Price tick",
    margin: "Margin",
    entryPrice: "Entry price",
    status: "Status",
    positionValue: (side, quantity) => `${side} · ${quantity} contracts`,
    frozenAwaiting: "Frozen · awaiting official settlement",
    localLedgerOnly: "Local ledger only · not traded",
    paidPremium: "Paid premium",
    isolated: "Isolated",
    allFields: "All contract fields",
    nativeId: "Native ID",
    settlement: "Settlement",
    underlyingIndex: "Underlying index",
    quoteTime: "Quote time",
    nextFunding: "Next funding",
    candlesAria: "Contract candles",
    priceHistory: "Price history · 1h",
    liveHistoryHidden: "Live history is hidden while Paper is disabled.",
    liveHistoryUnavailable: "Live price history is unavailable because this contract is not in the current contract list.",
    optionCandlesUnsupported: "Option candles are not supported. Use the native quote and contract details above.",
    noCandleData: "No candle data available.",
    selectContractCandles: "Select a contract to view candles.",
    candleImageAria: "Contract OHLC candles, 1 hour",
    accountAria: "Derivatives account",
    frozenSnapshotTitle: "Frozen Replay ledger snapshot",
    pageTitle: "Derivatives workstation",
    paperAccount: (suffix) => `Paper account ${suffix}`,
    refreshSnapshot: "Refresh snapshot",
    refreshLedger: "Refresh ledger",
    ledgerUnavailable: (detail) => `Local account ledger unavailable: ${detail}`,
    loadingLocalAccounts: "Loading local accounts…",
    noPaperAccountsStored: "No local derivatives Paper accounts are stored yet.",
    noLocalAccounts: "No local derivatives accounts. Open one after a contract is available.",
    noAccountForSettlement: "No account is open for this settlement currency yet.",
    available: "Available",
    realizedPnl: "Realized P&L",
    feesPaid: "Fees paid",
    positions: "Positions",
    positionsWithCount: (count) => `Positions · ${count}`,
    noOpenPositions: "No open positions.",
    orderHistoryWithCount: (count) => `Order history · ${count}`,
    orderHistoryShowing: (shown, total) => `Showing ${shown} of ${total} fills.`,
    loadOlder: "Load older",
    loadingOlder: "Loading older fills…",
    loadOlderFailed: "Could not load older fills. Try again.",
    noPaperFills: "No Paper fills.",
    positionColumns: ["Instrument", "Side", "Qty", "Entry", "Margin", "uPnL", "Action"],
    ledgerPositionColumns: ["Instrument", "Side", "Qty", "Entry", "Margin"],
    orderColumns: ["Time (UTC)", "Instrument", "Action", "Qty", "Fill", "Fee"],
    viewPosition: (instrumentId) => `View position ${instrumentId}`,
    frozen: "Frozen",
    close: "Close",
    frozenLedgerNote: "Frozen Replay snapshot · local SQLite · read only",
    localLedgerNote: "Local Paper ledger · read only without a live quote",
    ledgerReadOnlyNote: "Position navigation and Paper actions are disabled in Replay; this snapshot is read only.",
    ledgerHint: "Balances and history are local. Select a position to load its contract; orders stay disabled until exchange metadata and a fresh quote are available.",
    ticketAria: "Derivatives Paper ticket",
    paperTicket: "Paper ticket",
    separateAccount: "Separate local settle account. Spot and legacy balances are never used or migrated.",
    entryHidden: "Paper order entry is hidden during Replay.",
    orderEntryPaused: "ORDER ENTRY PAUSED",
    pausedExpired: "This contract has expired. The local position is frozen awaiting official settlement and cannot be traded.",
    pausedDelisted: "This contract is not in the current contract list. The local position remains readable, but no live metadata or quote is available for Paper execution.",
    pausedListLoading: "Contract search pending. Paper actions are paused until the filtered contracts load.",
    pausedGeneric: "Order entry is paused until exchange metadata and a fresh quote are available. Existing balances, positions, and history remain readable in the local ledger.",
    accountUnavailable: "Local Paper account unavailable. Refresh the local ledger before trading.",
    loadingPaperAccount: "Loading local Paper account…",
    initialBalance: "Initial balance",
    seedNote: (settle) => `Local seed in ${settle}. Fee rate: 0.1% per fill. Opening an existing account never credits it again.`,
    openPaperAccount: "Open Paper account",
    action: "Action",
    orderActionAria: "Order action",
    buyToOpen: "Buy to open",
    open: "Open",
    sellToClose: "Sell to close",
    closeReduceOnly: "Close · reduce only",
    positionSide: "Position side",
    positionSideAria: "Position side",
    long: "Long",
    short: "Short",
    quantityContracts: "Quantity (contracts)",
    step: (step) => `step ${step}`,
    quantityAria: "Quantity in contracts",
    decreaseContracts: "Decrease contracts",
    increaseContracts: "Increase contracts",
    size: "Size:",
    max: "MAX",
    isolatedLeverage: "Isolated leverage",
    isolatedLeverageAria: "Isolated leverage",
    preset: "Preset:",
    buyCeiling: (unit) => `Buy ceiling (${unit}/base)`,
    sellFloor: (unit) => `Sell floor (${unit}/base)`,
    settleFallback: "settle",
    priceProtectionAria: "Price protection",
    fill: "Fill:",
    fillWithBid: "Fill with current native bid",
    fillWithMark: "Fill with current mark price",
    fillWithAsk: "Fill with current native ask",
    bidButton: (value) => `Bid ${value}`,
    markButton: (value) => `Mark ${value}`,
    askButton: (value) => `Ask ${value}`,
    reduceOnlyNote: "Reduce only. Use the existing position side and leverage; quantity cannot exceed that position.",
    immediateFillNote: "Immediate local fill at native bid / ask within your price protection.",
    submitting: "Submitting…",
    submitOrder: "Submit Paper order",
    checkingFreshness: "Checking quote freshness.",
    fundingNote: "Funding is not accrued. Expiry freezes positions awaiting official settlement. Local isolated margin does not simulate exchange liquidation.",
    localWorkspace: (identity) => `LOCAL WORKSPACE · ${identity}`,
    noContract: "NO CONTRACT",
    statusbar: "DERIVATIVES · LIVE TRADING DISABLED · SQLITE LOCAL PERSISTENCE",
    engineModel: "Engine model",
    engineTitle: "Local isolated Paper",
    engineEyebrow: "EXECUTION POLICY",
    engineFill: "Paper fills use fresh native bid / ask quotes and explicit price protection. No orders are sent to an exchange.",
    engineMargin: "Each position has local isolated margin. Contract trading losses are capped at allocated collateral; exchange liquidation is not simulated. Fees are charged separately.",
    engineFunding: "Funding is displayed when available, but is not accrued without an official funding ledger.",
    engineExpiry: "Expired contracts freeze awaiting official settlement. No synthetic settlement or automatic exercise is applied.",
    engineOptions: "Options support buy-to-open and sell-to-close long positions at 1x. Premiums and prices are in settle currency per base coin; quantities are contracts.",
    engineUnknown: "Unknown fields remain unavailable (—). Test fixtures are labelled and only available in the E2E test process.",
    snapshotTitle: (date) => `Exchange snapshot ${date} · reference only`,
    noBookSnapshot: "No public book snapshot",
    stalePrefix: "STALE · ",
    requestFailed: "Derivatives request failed.",
    exchangeResources: { contracts: "contracts", quote: "quote", candles: "candles", chainQuotes: "option-chain quotes" },
    exchangeUnreachable: (resource) => `Exchange ${resource} is temporarily unreachable. Check your internet connection or exchange access, then retry. Your local Paper ledger is stored separately.`,
    exchangeLoadFailed: (resource, detail) => `Could not load exchange ${resource}${detail ? `: ${detail}` : "."} Your local Paper ledger is still available.`,
    ledgerUnavailableDefault: "Local account ledger unavailable.",
    reasonNeedsQuote: "A matching two-sided fresh native quote is required for Paper execution.",
    reasonSelectContract: "Select a contract with native metadata.",
    blockReasons: {
      selectContract: "Select a contract with native metadata.",
      inactive: "This contract is inactive.",
      expired: "Expired contract: awaiting official settlement. Paper trading is frozen.",
      missingExpiry: "Official expiry is unavailable. Paper trading is disabled.",
      notLinear: "Only linear contracts settled in quote currency support Paper execution.",
      missingConstraints: "Native contract constraints are unavailable. Paper trading is disabled.",
      needsQuote: "A matching two-sided native quote is required for Paper execution.",
      staleQuote: "Quote is stale or has an invalid native timestamp. Refresh before submitting.",
    },
    invalidOrder: "Enter a valid quantity, leverage, and price protection before submitting.",
    accountOpened: "Local Paper account opened.",
    orderConfirmed: "Previously filled order confirmed.",
    orderFilled: "Paper order filled.",
    commandFailed: "Paper command failed.",
    commandFailedRefresh: (detail) => `${detail} Refresh the local ledger to confirm the outcome before changing this order. Retrying unchanged order details uses the same client order ID.`,
  },
  zh: {
    title: "/ 衍生品",
    navLabel: "工作区导航",
    workflowLabel: "研究工作流",
    markets: "行情",
    research: "研究",
    replay: "回放",
    derivatives: "衍生品",
    workspaceShortcut: (label, num) => `${label}工作区，快捷键 ${num}`,
    switchShortcut: (label, num) => `按 ${num} 切换到${label}`,
    currentWorkspaceAria: "当前工作区：衍生品，快捷键 4",
    currentWorkspaceTitle: "当前工作区：衍生品 [4]",
    paperLiveOff: "模拟盘 · 实盘关闭",
    kinds: { perpetual: "永续合约", future: "交割合约", option: "期权" },
    kindEyebrow: { perpetual: "永续合约", future: "交割期货", option: "期权" },
    selectContract: "选择合约",
    bidTag: "买一",
    askTag: "卖一",
    mark: "标记价",
    index: "指数",
    strike: "行权价",
    iv: "隐含波动率",
    delta: "Delta",
    expiry: "到期",
    funding: "资金费率",
    openInterest: "未平仓量",
    perpetual: "永续",
    fixture: "测试数据 · 非实盘",
    publicRealtime: "公开实时",
    noQuote: "无报价",
    refresh: "刷新",
    replayBanner: "回放期间实时衍生品行情与模拟盘操作已暂停。本地模拟盘账本仍以只读快照形式保留在下方。返回主终端的行情工作区即可恢复。",
    openMainTerminal: "打开主终端",
    marketsAria: "衍生品市场",
    longOptionsOnly: "Deribit · 仅支持做多期权",
    noVenues: "无可用交易所",
    linearContractsLine: (venues) => `${venues} · 线性合约`,
    contractBrowser: "合约浏览",
    instruments: "标的",
    searchDerivatives: "搜索衍生品",
    searchContracts: "搜索合约",
    expirySettlement: "到期与结算",
    premiumPerBase: (pair) => `${pair} · 每基础币权利金 · B / 标记价 / A 参考`,
    retryChainQuotes: "重试期权链报价",
    loadingBatchQuotes: "正在加载批量参考报价…",
    liveDataHidden: "模拟盘关闭期间隐藏实时行情。",
    loadingInstruments: "正在加载标的…",
    retry: "重试",
    noMatchingContracts: "无匹配合约。",
    strikeGroup: (strike) => `行权价 ${strike}`,
    missingAtStrike: (right) => `该行权价无${right}`,
    call: "看涨",
    put: "看跌",
    linear: "线性",
    coin: "币本位",
    inverseViewOnly: "反向 · 仅查看",
    option: "期权",
    marketDataAria: "合约行情",
    contractDetails: "合约详情",
    retryQuote: "重试报价",
    expiredNotice: "该合约已到期。交易所不再发布其实时元数据或报价；本地持仓已冻结，等待官方结算。",
    delistedNotice: "该合约不在当前合约列表中。这里仅显示本地存储的持仓条款；实时报价与 K 线不可用。",
    position: "持仓",
    contractSize: "合约乘数",
    minStep: "最小 / 步长",
    priceTick: "最小价格变动",
    margin: "保证金",
    entryPrice: "开仓价",
    status: "状态",
    positionValue: (side, quantity) => `${side} · ${quantity} 张`,
    frozenAwaiting: "已冻结 · 等待官方结算",
    localLedgerOnly: "仅本地账本 · 未交易",
    paidPremium: "已付权利金",
    isolated: "逐仓",
    allFields: "全部合约字段",
    nativeId: "原生 ID",
    settlement: "结算",
    underlyingIndex: "标的指数",
    quoteTime: "报价时间",
    nextFunding: "下次资金费率",
    candlesAria: "合约 K 线",
    priceHistory: "价格历史 · 1h",
    liveHistoryHidden: "模拟盘关闭期间隐藏实时历史。",
    liveHistoryUnavailable: "实时价格历史不可用，因为该合约不在当前合约列表中。",
    optionCandlesUnsupported: "不支持期权 K 线。请使用上方的原生报价与合约详情。",
    noCandleData: "暂无 K 线数据。",
    selectContractCandles: "选择合约以查看 K 线。",
    candleImageAria: "合约 OHLC K 线，1 小时",
    accountAria: "衍生品账户",
    frozenSnapshotTitle: "冻结回放账本快照",
    pageTitle: "衍生品工作区",
    paperAccount: (suffix) => `模拟盘账户 ${suffix}`,
    refreshSnapshot: "刷新快照",
    refreshLedger: "刷新账本",
    ledgerUnavailable: (detail) => `本地账户账本不可用：${detail}`,
    loadingLocalAccounts: "正在加载本地账户…",
    noPaperAccountsStored: "尚未存储本地衍生品模拟盘账户。",
    noLocalAccounts: "暂无本地衍生品账户。合约可用后可开立。",
    noAccountForSettlement: "该结算币种尚未开立账户。",
    available: "可用",
    realizedPnl: "已实现盈亏",
    feesPaid: "已付手续费",
    positions: "持仓",
    positionsWithCount: (count) => `持仓 · ${count}`,
    noOpenPositions: "暂无持仓。",
    orderHistoryWithCount: (count) => `委托历史 · ${count}`,
    orderHistoryShowing: (shown, total) => `显示 ${shown} 笔，共 ${total} 笔成交。`,
    loadOlder: "加载更早成交",
    loadingOlder: "正在加载更早成交…",
    loadOlderFailed: "无法加载更早成交，请重试。",
    noPaperFills: "暂无模拟盘成交。",
    positionColumns: ["标的", "方向", "数量", "开仓价", "保证金", "未实现盈亏", "操作"],
    ledgerPositionColumns: ["标的", "方向", "数量", "开仓价", "保证金"],
    orderColumns: ["时间 (UTC)", "标的", "操作", "数量", "成交价", "手续费"],
    viewPosition: (instrumentId) => `查看持仓 ${instrumentId}`,
    frozen: "已冻结",
    close: "平仓",
    frozenLedgerNote: "冻结回放快照 · 本地 SQLite · 只读",
    localLedgerNote: "本地模拟盘账本 · 无实时报价时只读",
    ledgerReadOnlyNote: "回放期间无法跳转持仓或执行模拟盘操作；本快照为只读。",
    ledgerHint: "余额与历史保存在本机。选择持仓以加载其合约；在交易所元数据与新鲜报价可用前，委托保持禁用。",
    ticketAria: "衍生品模拟盘委托",
    paperTicket: "模拟盘委托",
    separateAccount: "独立的本地结算账户。现货与旧版余额绝不会被使用或迁移。",
    entryHidden: "回放期间隐藏模拟盘委托录入。",
    orderEntryPaused: "委托录入已暂停",
    pausedExpired: "该合约已到期。本地持仓已冻结，等待官方结算，无法交易。",
    pausedDelisted: "该合约不在当前合约列表中。持仓仍可查看，但没有可用于模拟盘执行的实时元数据或报价。",
    pausedListLoading: "合约搜索进行中。筛选后的合约加载完成前，模拟盘操作已暂停。",
    pausedGeneric: "在交易所元数据与新鲜报价可用前，委托录入已暂停。现有余额、持仓与历史仍可在本地账本中查看。",
    accountUnavailable: "本地模拟盘账户不可用。交易前请刷新本地账本。",
    loadingPaperAccount: "正在加载本地模拟盘账户…",
    initialBalance: "初始资金",
    seedNote: (settle) => `本地初始注资 ${settle}。费率为每笔成交 0.1%。再次开立已有账户不会重复注资。`,
    openPaperAccount: "开立模拟盘账户",
    action: "操作",
    orderActionAria: "委托操作",
    buyToOpen: "买入开仓",
    open: "开仓",
    sellToClose: "卖出平仓",
    closeReduceOnly: "平仓 · 只减仓",
    positionSide: "持仓方向",
    positionSideAria: "持仓方向",
    long: "做多",
    short: "做空",
    quantityContracts: "数量（合约）",
    step: (step) => `步长 ${step}`,
    quantityAria: "合约数量",
    decreaseContracts: "减少合约数",
    increaseContracts: "增加合约数",
    size: "规模：",
    max: "最大",
    isolatedLeverage: "逐仓杠杆",
    isolatedLeverageAria: "逐仓杠杆",
    preset: "预设：",
    buyCeiling: (unit) => `买入上限价（${unit}/基础币）`,
    sellFloor: (unit) => `卖出下限价（${unit}/基础币）`,
    settleFallback: "结算币",
    priceProtectionAria: "价格保护",
    fill: "成交：",
    fillWithBid: "按当前买一价填入",
    fillWithMark: "按当前标记价填入",
    fillWithAsk: "按当前卖一价填入",
    bidButton: (value) => `买一 ${value}`,
    markButton: (value) => `标记 ${value}`,
    askButton: (value) => `卖一 ${value}`,
    reduceOnlyNote: "仅减仓。使用原持仓方向与杠杆；数量不能超过该持仓。",
    immediateFillNote: "在价格保护范围内按原生买一 / 卖一即时本地成交。",
    submitting: "提交中…",
    submitOrder: "提交模拟盘委托",
    checkingFreshness: "正在检查报价新鲜度。",
    fundingNote: "不累计资金费率。到期后持仓冻结，等待官方结算。本地逐仓保证金不模拟交易所强平。",
    localWorkspace: (identity) => `本地工作区 · ${identity}`,
    noContract: "无合约",
    statusbar: "衍生品 · 实盘交易已禁用 · SQLITE 本地持久化",
    engineModel: "引擎模型",
    engineTitle: "本地逐仓模拟盘",
    engineEyebrow: "执行策略",
    engineFill: "模拟盘成交使用新鲜的交易所原生买一 / 卖一报价，并显式执行价格保护。任何委托都不会发送到交易所。",
    engineMargin: "每个持仓使用本地逐仓保证金。合约交易亏损以分配抵押品为上限；不模拟交易所强平。手续费单独收取。",
    engineFunding: "有数据时显示资金费率，但缺少官方资金费率账本时不进行累计。",
    engineExpiry: "已到期合约冻结，等待官方结算。不应用合成结算或自动行权。",
    engineOptions: "期权仅支持 1 倍杠杆的买入开仓与卖出平仓多头持仓。权利金与价格以每基础币的结算币计；数量以合约张数计。",
    engineUnknown: "未知字段保持不可用（—）。测试数据会明确标注，仅存在于 E2E 测试进程。",
    snapshotTitle: (date) => `交易所快照 ${date} · 仅供参考`,
    noBookSnapshot: "无公开盘口快照",
    stalePrefix: "已过期 · ",
    requestFailed: "衍生品请求失败。",
    exchangeResources: { contracts: "合约", quote: "报价", candles: "K 线", chainQuotes: "期权链报价" },
    exchangeUnreachable: (resource) => `交易所${resource}暂时不可达。请检查网络连接或交易所访问权限后重试。本地模拟盘账本单独存储。`,
    exchangeLoadFailed: (resource, detail) => `无法加载交易所${resource}${detail ? `：${detail}` : "。"}本地模拟盘账本仍可使用。`,
    ledgerUnavailableDefault: "本地账户账本不可用。",
    reasonNeedsQuote: "需要匹配的双边新鲜原生报价才能执行模拟盘。",
    reasonSelectContract: "请选择具有原生元数据的合约。",
    blockReasons: {
      selectContract: "请选择具有原生元数据的合约。",
      inactive: "该合约已停止交易。",
      expired: "合约已到期，等待官方结算；模拟盘已冻结。",
      missingExpiry: "缺少官方到期时间，无法启用模拟盘。",
      notLinear: "仅支持以报价币结算的线性合约执行模拟盘交易。",
      missingConstraints: "缺少合约原生约束（乘数／步长／最小张数／价位），无法启用模拟盘。",
      needsQuote: "需要匹配的双边原生报价才能执行模拟盘。",
      staleQuote: "报价已过期或时间戳无效，请刷新后再提交。",
    },
    invalidOrder: "提交前请输入有效的数量、杠杆与价格保护。",
    accountOpened: "本地模拟盘账户已开立。",
    orderConfirmed: "已确认此前成交的委托。",
    orderFilled: "模拟盘委托已成交。",
    commandFailed: "模拟盘指令失败。",
    commandFailedRefresh: (detail) => `${detail} 请先刷新本地账本确认结果，再修改此委托。重复提交未更改的委托详情会复用同一客户端委托 ID。`,
  },
};

async function readJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { cache: "no-store", ...init });
  const payload = await response.json();
  if (!response.ok) throw new Error(payload.error ?? translate(DERIVATIVES_COPY).requestFailed);
  return payload as T;
}

function optionQuoteNumber(value: number | null): string {
  return typeof value === "number" && Number.isFinite(value)
    ? value.toLocaleString("en-US", { maximumSignificantDigits: 7 }) : "—";
}

type ExchangeResource = keyof DerivativesCopy["exchangeResources"];

function exchangeErrorMessage(error: unknown, resource: ExchangeResource): string {
  const copy = translate(DERIVATIVES_COPY);
  const detail = error instanceof Error ? error.message : "";
  const noun = copy.exchangeResources[resource];
  if (/fetch failed|failed to fetch|network(?:error| error)?|econn|enotfound|etimedout|timed? out|socket/i.test(detail)) {
    return copy.exchangeUnreachable(noun);
  }
  return copy.exchangeLoadFailed(noun, detail || null);
}

function QuoteFreshSubmit({ instrument, quote, disabled, submitting }: {
  instrument: DerivativeInstrument | null;
  quote: DerivativeQuote | null;
  disabled: boolean;
  submitting: boolean;
}): React.JSX.Element {
  const copy = useCopy(DERIVATIVES_COPY);
  /* Keep time state inside this tiny leaf. A stale-quote tick must not cause
     the contracts, option chain, or candlestick chart to render again. */
  const [now, setNow] = useState(0);
  useEffect(() => {
    const immediate = window.setTimeout(() => setNow(Date.now()), 0);
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => { window.clearTimeout(immediate); window.clearInterval(timer); };
  }, []);
  const blockCode = now > 0 ? derivativeBlockCode(instrument, quote, now) : null;
  const reason = now > 0 ? (blockCode ? copy.blockReasons[blockCode] : null) : copy.checkingFreshness;
  return <>
    <Button type="submit" block variant="primary" disabled={disabled || !quote || !instrument || now === 0 || !!reason}>
      {submitting ? copy.submitting : copy.submitOrder}
    </Button>
    {quote && now > 0 && reason && <p role="status" className="derivatives-ticket-note alert">
      {reason}
    </p>}
  </>;
}

function OptionSnapshot({ quote, stale }: { quote: DerivativeQuote | undefined; stale: boolean }): React.JSX.Element {
  const copy = useCopy(DERIVATIVES_COPY);
  const [now, setNow] = useState(0);
  useEffect(() => {
    const update = () => setNow(Date.now());
    update();
    if (!quote) return;
    const delay = Math.max(0, quote.timestamp + 30_001 - Date.now());
    const timer = window.setTimeout(update, Math.min(delay, 2_147_483_647));
    return () => window.clearTimeout(timer);
  }, [quote]);
  const isStale = stale || (now > 0 && !!quote && derivativeQuoteSnapshotIsStale(quote, now));
  return <span className="num block truncate text-[10px] leading-tight" title={quote ? copy.snapshotTitle(derivativeDate(quote.timestamp)) : copy.noBookSnapshot}>
    {isStale && <b className="text-[var(--c-down)]">{copy.stalePrefix}</b>}
    B {optionQuoteNumber(quote?.bid ?? null)} · M {optionQuoteNumber(quote?.mark ?? null)} · A {optionQuoteNumber(quote?.ask ?? null)}
  </span>;
}

function PositionRow({ position, quote, busy, onClose, onView }: { position: DerivativesPosition; quote: DerivativeQuote | null; busy: boolean; onClose: (position: DerivativesPosition) => void; onView: (position: DerivativesPosition) => void }): React.JSX.Element {
  const copy = useCopy(DERIVATIVES_COPY);
  const [now, setNow] = useState(0);
  useEffect(() => {
    const update = () => setNow(Date.now());
    update();
    const timer = window.setInterval(update, 1000);
    return () => window.clearInterval(timer);
  }, []);
  const matchingQuote = quote?.instrumentId === position.instrumentId && now > 0 && Number.isFinite(quote.timestamp) && quote.timestamp > 0 && now >= quote.timestamp && now - quote.timestamp <= 15_000 ? quote : null;
  const unrealized = derivativeUnrealized(position, matchingQuote?.mark ?? null, now);
  return <tr>
    <td className="max-w-0" title={position.instrumentId}>
      <button type="button" className="derivatives-position-link truncate" aria-label={copy.viewPosition(position.instrumentId)} onClick={() => onView(position)}>{position.instrumentId}</button>
    </td>
    <td>{position.side}</td><td>{position.quantity}</td><td>{position.entryPrice}</td><td>{position.margin} · {position.leverage}x</td>
    <td className={unrealized == null ? "" : unrealized < 0 ? "down" : unrealized > 0 ? "up" : ""}>{unrealized === null ? "—" : `${unrealized > 0 ? "+" : ""}${unrealized}`}</td>
    <td>{now > 0 && derivativePositionIsExpired(position, now) ? <span className="meta">{copy.frozen}</span> : <Button size="sm" variant="outline" disabled={busy} onClick={() => onClose(position)}>{copy.close}</Button>}</td>
  </tr>;
}

function OrderHistory({ account }: { account: DerivativesAccount }): React.JSX.Element {
  const copy = useCopy(DERIVATIVES_COPY);
  const [orders, setOrders] = useState(() => [...account.orders].reverse());
  const [hasMore, setHasMore] = useState(() => account.orderCount > account.orders.length);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const request = useRef<AbortController | null>(null);

  useEffect(() => () => { request.current?.abort(); }, []);

  async function loadOlder() {
    const oldest = orders[orders.length - 1];
    if (!oldest || request.current) return;
    const controller = new AbortController();
    request.current = controller;
    setLoading(true);
    setError(false);
    const params = new URLSearchParams({ venue: account.venue, settle: account.settle, before: oldest.clientOrderId });
    try {
      const page = await readJson<{ orders: DerivativesAccount["orders"]; hasMore: boolean }>(`/api/derivatives/orders?${params}`, { signal: controller.signal });
      if (!controller.signal.aborted) {
        setOrders((current) => [...current, ...page.orders]);
        setHasMore(page.hasMore);
      }
    } catch {
      if (!controller.signal.aborted) setError(true);
    } finally {
      if (!controller.signal.aborted) {
        request.current = null;
        setLoading(false);
      }
    }
  }

  return <div aria-busy={loading}>
    <p className="meta mt-1" aria-live="polite">{copy.orderHistoryShowing(orders.length, account.orderCount)}</p>
    {!orders.length ? <p className="mt-1 text-[var(--c-fg-4)] text-[11px]">{copy.noPaperFills}</p>
      : <div className="derivatives-table-scroll mt-1 border border-[var(--c-line)]">
        <table className="derivatives-table">
          <thead><tr>{copy.orderColumns.map((label) => <th key={label}>{label}</th>)}</tr></thead>
          <tbody>{orders.map((order) => <tr key={order.clientOrderId}>
            <td>{derivativeDate(order.createdAt)}</td><td className="max-w-0 truncate" title={order.instrumentId}>{order.instrumentId}</td>
            <td>{order.action} {order.side}</td><td>{order.quantity}</td><td>{order.fillPrice}</td><td>{order.fee}</td>
          </tr>)}</tbody>
        </table>
      </div>}
    {error && <p role="alert" className="mt-1 text-[var(--c-down)] text-[11px]">{copy.loadOlderFailed}</p>}
    {hasMore && <Button type="button" size="sm" variant="outline" className="mt-1 min-h-[44px] min-w-[44px]" disabled={loading} onClick={loadOlder}>{loading ? copy.loadingOlder : error ? copy.retry : copy.loadOlder}</Button>}
    {loading && <span role="status" className="sr-only">{copy.loadingOlder}</span>}
  </div>;
}

function LocalAccountLedger({ accounts, readOnly = false, onSelectPosition }: {
  accounts: DerivativesAccount[];
  readOnly?: boolean;
  onSelectPosition?: (position: DerivativesPosition, settle: string) => void;
}): React.JSX.Element {
  const copy = useCopy(DERIVATIVES_COPY);
  return <div className="space-y-2">
    <p className="meta">{readOnly ? copy.frozenLedgerNote : copy.localLedgerNote}</p>
    {accounts.map((entry) => <details key={entry.id} className="derivatives-details" open={accounts.length === 1}>
      <summary className="flex items-center justify-between gap-3">
        <span>{entry.venue.toUpperCase()} / {entry.settle}</span>
        <span className="num">{entry.available} {entry.settle}</span>
      </summary>
      <div className="mt-2 space-y-3">
        <dl className="derivatives-account-grid">
          <div><dt>{copy.realizedPnl}</dt><dd>{entry.realizedPnl} <small>{entry.settle}</small></dd></div>
          <div><dt>{copy.feesPaid}</dt><dd>{entry.feesPaid} <small>{entry.settle}</small></dd></div>
        </dl>
        <div>
          <span className="meta">{copy.positionsWithCount(entry.positions.length)}</span>
          {!entry.positions.length ? <p className="mt-1 text-[var(--c-fg-4)] text-[11px]">{copy.noOpenPositions}</p>
            : <div className="derivatives-table-scroll mt-1 border border-[var(--c-line)]">
              <table className="derivatives-table">
                <thead><tr>{copy.ledgerPositionColumns.map((label) => <th key={label}>{label}</th>)}</tr></thead>
                <tbody>{entry.positions.map((position) => <tr key={`${position.instrumentId}:${position.side}`}>
                  <td className="max-w-0 truncate" title={position.instrumentId}>
                    {readOnly || !onSelectPosition ? position.instrumentId : (
                      <button type="button" className="derivatives-position-link truncate" aria-label={copy.viewPosition(position.instrumentId)} onClick={() => onSelectPosition(position, entry.settle)}>
                        {position.instrumentId}
                      </button>
                    )}
                  </td>
                  <td>{position.side}</td><td>{position.quantity}</td><td>{position.entryPrice}</td><td>{position.margin} · {position.leverage}x</td>
                </tr>)}</tbody>
              </table>
            </div>}
        </div>
        <details className="derivatives-details" open={accounts.length === 1 && entry.orders.length > 0}>
          <summary>{copy.orderHistoryWithCount(entry.orderCount)}</summary>
          <OrderHistory key={`${entry.id}:${entry.orderCount}`} account={entry} />
        </details>
      </div>
    </details>)}
    <p className="derivatives-ticket-note">{readOnly ? copy.ledgerReadOnlyNote : copy.ledgerHint}</p>
  </div>;
}

function EngineModel(): React.JSX.Element {
  const copy = useCopy(DERIVATIVES_COPY);
  return <AkPopover trigger={<Button className="derivatives-engine-trigger" size="sm" variant="outline">{copy.engineModel}</Button>} title={copy.engineTitle} eyebrow={copy.engineEyebrow}>
    <div className="space-y-2 text-xs">
      <p>{copy.engineFill}</p>
      <p>{copy.engineMargin}</p>
      <p>{copy.engineFunding}</p>
      <p>{copy.engineExpiry}</p>
      <p>{copy.engineOptions}</p>
      <p>{copy.engineUnknown}</p>
    </div>
  </AkPopover>;
}

const CandleSeries = memo(function CandleSeries({ bars }: { bars: Candle[] }): React.JSX.Element {
  const copy = useCopy(DERIVATIVES_COPY);
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const fittedRef = useRef(false);
  /* Same contract as the spot chart: the ramp is read from a ref so a
     colour-vision change repaints this chart without rebuilding it. */
  const palette = chartPalette(usePreferences().colorVision);
  const paletteRef = useRef<ChartPalette>(palette);
  /* Declared before the chart-creating effect so the first commit already reads
     the right ramp. Assigning in an effect (not during render) keeps React's
     ref rules satisfied — a render must not mutate a ref. */
  useEffect(() => {
    paletteRef.current = palette;
  }, [palette]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const chart = createChart(container, {
      autoSize: false,
      width: container.clientWidth,
      height: container.clientHeight,
      layout: {
        background: { type: ColorType.Solid, color: "#0d1117" },
        textColor: "#8b949e",
        fontFamily: "Inter, ui-sans-serif, system-ui, sans-serif",
        fontSize: 11,
      },
      grid: {
        vertLines: { color: "rgba(139,148,158,0.07)" },
        horzLines: { color: "rgba(139,148,158,0.07)" },
      },
      rightPriceScale: { borderColor: "rgba(139,148,158,0.18)" },
      timeScale: { borderColor: "rgba(139,148,158,0.18)", timeVisible: true, secondsVisible: false },
    });
    const series = chart.addSeries(CandlestickSeries, {
      upColor: paletteRef.current.up,
      downColor: paletteRef.current.down,
      borderUpColor: paletteRef.current.up,
      borderDownColor: paletteRef.current.down,
      wickUpColor: paletteRef.current.up,
      wickDownColor: paletteRef.current.down,
    });
    chartRef.current = chart;
    fittedRef.current = false;
    seriesRef.current = series;
    const resizeObserver = new ResizeObserver(([entry]) => {
      if (!entry) return;
      chart.applyOptions({ width: Math.floor(entry.contentRect.width), height: Math.floor(entry.contentRect.height) });
    });
    resizeObserver.observe(container);
    return () => {
      resizeObserver.disconnect();
      chart.remove();
      chartRef.current = null;
      seriesRef.current = null;
    };
  }, []);

  useEffect(() => {
    seriesRef.current?.applyOptions({
      upColor: palette.up,
      downColor: palette.down,
      borderUpColor: palette.up,
      borderDownColor: palette.down,
      wickUpColor: palette.up,
      wickDownColor: palette.down,
    });
  }, [palette]);

  useEffect(() => {
    const uniqueBars = new Map<number, Candle>();
    for (const bar of bars) {
      const time = Math.floor(bar.timestamp / 1000);
      if (Number.isFinite(time)) uniqueBars.set(time, bar);
    }
    const data = [...uniqueBars.entries()]
      .sort(([left], [right]) => left - right)
      .map(([time, bar]) => ({
        time: time as UTCTimestamp,
        open: bar.open,
        high: bar.high,
        low: bar.low,
        close: bar.close,
      }));
    seriesRef.current?.setData(data);
    if (data.length > 0 && !fittedRef.current) {
      chartRef.current?.timeScale().fitContent();
      fittedRef.current = true;
    }
  }, [bars]);

  /* 192px read as a sparkline beside the contract details above it; the chart
     now carries its panel at roughly half again the height. */
  return <div ref={containerRef} className="h-56 w-full sm:h-72" role="img" aria-label={copy.candleImageAria} />;
});
export function DerivativesWorkspace(): React.JSX.Element {
  const copy = useCopy(DERIVATIVES_COPY);
  const router = useRouter();
  const globalWorkspace = useWorkspaceStore((state) => state.activeWorkspace);
  const [remoteReplay, setRemoteReplay] = useState<boolean | null>(null);
  const [kind, setKind] = useState<DerivativeKind>("perpetual");
  const [query, setQuery] = useState("");
  const [items, setItems] = useState<DerivativeInstrument[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [market, setMarket] = useState<{ instrument: DerivativeInstrument; quote: DerivativeQuote } | null>(null);
  const [marketError, setMarketError] = useState<string | null>(null);
  const [listError, setListError] = useState<string | null>(null);
  const [listLoading, setListLoading] = useState(true);
  const [bars, setBars] = useState<Candle[]>([]);
  const [candleError, setCandleError] = useState<string | null>(null);
  const [ledgerAccounts, setLedgerAccounts] = useState<DerivativesAccount[] | null>(null);
  const [ledgerError, setLedgerError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ tone: "good" | "alert"; text: string } | null>(null);
  /* Independent retry counters: a failed instrument list, a failed quote and a
     failed option-chain quote must each re-arm only the request they belong to.
     One shared counter restarted all three and spent upstream calls on data the
     user did not ask to reload. */
  const [listRevision, setListRevision] = useState(0);
  const [marketRevision, setMarketRevision] = useState(0);
  const [optionRevision, setOptionRevision] = useState(0);
  const [ledgerRevision, setLedgerRevision] = useState(0);
  const [action, setAction] = useState<"open" | "close">("open");
  const [side, setSide] = useState<"long" | "short">("long");
  const [quantity, setQuantity] = useState("");
  const [leverage, setLeverage] = useState("1");
  const [maximumPrice, setMaximumPrice] = useState("");
  const [chainKey, setChainKey] = useState<string | null>(null);
  const [optionQuoteData, setOptionQuoteData] = useState<{ key: string; quotes: Record<string, DerivativeQuote>; staleIds: string[]; error: string | null }>({ key: "", quotes: {}, staleIds: [], error: null });
  /* A ledger position can outlive its venue listing (expired options, delisted
     futures). Keep that identity selected so its local terms stay inspectable
     instead of silently falling back to the first listed contract. */
  const [positionFocus, setPositionFocus] = useState<DerivativesPosition | null>(null);
  const retainSelection = useRef(false);
  /* The account list is a local SQLite snapshot, independent of market data.
     The clock that gates order freshness lives in QuoteFreshSubmit, a leaf. */
  const pendingOrder = useRef<DerivativesOrderRequest | null>(null);
  const mutationLock = useRef(false);
  /* remoteReplay null = first poll still outstanding: hide the markets rather
     than flashing a boundary banner that usually resolves to "available". */
  const blocked = globalWorkspace === "replay" || remoteReplay === true;
  const instrument = !blocked && !listLoading && market?.instrument.id === selectedId ? market.instrument : null;
  const selectedSettlement = instrument?.settle ?? (!blocked && !listLoading ? items.find((item) => item.id === selectedId)?.settle : undefined);
  const quote = !blocked && !listLoading && market?.quote.instrumentId === selectedId && !marketError ? market.quote : null;
  const initialBalance = instrument?.settle === "BTC" ? "1" : instrument?.settle === "ETH" ? "10" : "10000";
  const account = instrument && !blocked ? ledgerAccounts?.find((entry) => entry.venue === instrument.venue && entry.settle === instrument.settle) ?? null : null;
  const accountReady = !blocked && ledgerAccounts !== null && ledgerError === null;
  /* A local position may reference a contract the venue no longer lists, so
     its terms come from the ledger rather than a fresh market response. */
  const focusedPosition = positionFocus?.instrumentId === selectedId ? positionFocus : null;
  const focusedExpired = focusedPosition !== null && derivativePositionIsExpired(focusedPosition, Date.now());
  /* The list is capped and may omit a live contract, so only an expired
     position or a failed live lookup proves that local terms are all we have. */
  const focusedLocalOnly = focusedPosition !== null && !listLoading && !instrument && (focusedExpired || marketError !== null) ? focusedPosition : null;

  // Read the shared boundary, without mounting WorkspaceSync or writing spot state.
  useEffect(() => {
    let disposed = false;
    let inFlight = false;
    const refresh = async () => {
      if (inFlight || disposed) return;
      inFlight = true;
      try {
        const data = await readJson<{ state: { activeWorkspace: string } }>("/api/workspace");
        if (!disposed) setRemoteReplay(data.state.activeWorkspace === "replay");
      } catch { if (!disposed) setRemoteReplay(null); }
      finally { inFlight = false; }
    };
    void refresh();
    const timer = window.setInterval(() => { if (!document.hidden) void refresh(); }, 1500);
    return () => { disposed = true; window.clearInterval(timer); };
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void readJson<{ accounts: DerivativesAccount[] }>("/api/derivatives/accounts", { signal: controller.signal })
      .then((data) => { setLedgerAccounts(data.accounts); setLedgerError(null); })
      .catch((error: unknown) => { if (!controller.signal.aborted) { setLedgerAccounts(null); setLedgerError(error instanceof Error ? error.message : translate(DERIVATIVES_COPY).ledgerUnavailableDefault); } });
    return () => controller.abort();
  }, [blocked, ledgerRevision]);
  useEffect(() => {
    if (blocked) return;
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      setListLoading(true); setListError(null);
      void readJson<{ instruments: DerivativeInstrument[] }>(`/api/derivatives/markets?kind=${kind}&query=${encodeURIComponent(query)}`, { signal: controller.signal })
        .then((data) => {
          setItems(data.instruments);
          setSelectedId((id) => data.instruments.some((item) => item.id === id) || retainSelection.current ? id : data.instruments[0]?.id ?? "");
        }).catch((error: unknown) => { if (!controller.signal.aborted) { setItems([]); setSelectedId((id) => retainSelection.current ? id : ""); setListError(exchangeErrorMessage(error, "contracts")); } })
        .finally(() => { if (!controller.signal.aborted) setListLoading(false); });
    }, 200);
    return () => { controller.abort(); window.clearTimeout(timer); };
  }, [kind, query, listRevision, blocked]);


  /* A search edit invalidates the visible selection immediately. Polling the
     old contract while the list reconciles would show a quote for a row the
     user can no longer see, and an expired local position has no live quote. */
  useEffect(() => {
    if (blocked || listLoading || focusedExpired || !selectedId) return;
    let disposed = false;
    let inFlight = false;
    let retryTimer = 0;
    let delay = 5000;
    const controller = new AbortController();

    const schedule = () => {
      retryTimer = window.setTimeout(() => {
        if (disposed || controller.signal.aborted) return;
        if (document.hidden) { schedule(); return; }
        void refresh();
      }, delay);
    };
    const refresh = async () => {
      if (inFlight || controller.signal.aborted) return;
      inFlight = true;
      try {
        const data = await readJson<{ instrument: DerivativeInstrument; quote: DerivativeQuote }>(`/api/derivatives/market?instrumentId=${encodeURIComponent(selectedId)}&view=quote`, { signal: controller.signal });
        if (!disposed) { setMarket(data); setMarketError(null); }
        delay = 5000;
      } catch (error) {
        if (!disposed) { setMarket(null); setMarketError(exchangeErrorMessage(error, "quote")); }
        delay = Math.min(delay * 2, 60000);
      } finally {
        inFlight = false;
        if (!disposed && !controller.signal.aborted) schedule();
      }
    };
    const onVisibilityChange = () => {
      if (document.hidden || inFlight) return;
      window.clearTimeout(retryTimer);
      void refresh();
    };
    document.addEventListener("visibilitychange", onVisibilityChange);
    void refresh();

    return () => {
      disposed = true;
      controller.abort();
      window.clearTimeout(retryTimer);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [selectedId, marketRevision, blocked, listLoading, focusedExpired]);

  useEffect(() => {
    if (kind === "option") {
      setBars([]);
      setCandleError(null);
      return;
    }
    if (blocked || listLoading || focusedExpired || !selectedId) return;
    let disposed = false;
    let inFlight = false;
    let retryTimer = 0;
    let delay = 60000;
    const controller = new AbortController();

    const schedule = () => {
      retryTimer = window.setTimeout(() => {
        if (disposed || controller.signal.aborted) return;
        if (document.hidden) { schedule(); return; }
        void refresh();
      }, delay);
    };
    const refresh = async () => {
      if (inFlight || controller.signal.aborted) return;
      inFlight = true;
      try {
        const data = await readJson<{ candles: Candle[]; candleError: string | null }>(`/api/derivatives/market?instrumentId=${encodeURIComponent(selectedId)}&view=candles`, { signal: controller.signal });
        if (!disposed) { setBars(data.candles); setCandleError(data.candleError); }
        delay = 60000;
      } catch (error) {
        if (!disposed && !controller.signal.aborted) setCandleError(exchangeErrorMessage(error, "candles"));
        delay = Math.min(delay * 2, 300000);
      } finally {
        inFlight = false;
        if (!disposed && !controller.signal.aborted) schedule();
      }
    };
    const onVisibilityChange = () => {
      if (document.hidden || inFlight) return;
      window.clearTimeout(retryTimer);
      void refresh();
    };
    document.addEventListener("visibilitychange", onVisibilityChange);
    if (document.hidden) schedule();
    else void refresh();

    return () => {
      disposed = true;
      controller.abort();
      window.clearTimeout(retryTimer);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [selectedId, marketRevision, blocked, listLoading, focusedExpired, kind]);

  function select(id: string, focus: DerivativesPosition | null = null): void {
    retainSelection.current = focus !== null;
    setPositionFocus(focus);
    if (id === selectedId) return;
    setSelectedId(id); setMarket(null); setMarketError(null); setBars([]); setCandleError(null);
    setMaximumPrice(""); setQuantity(""); setNotice(null);
  }
  function changeKind(next: DerivativeKind): void {
    setKind(next); setItems([]); setListLoading(true); select(""); setSide("long"); setLeverage("1"); setAction("open"); setChainKey(null);
  }

  const changeKindRef = useRef(changeKind);
  changeKindRef.current = changeKind;

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent): void => {
      const target = event.target as HTMLElement | null;
      if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.tagName === "SELECT")) return;
      /* Workspace navigation is shell behaviour, not trading behaviour: a
         Replay isolation or a missing quote must never trap the reader on this
         page while the nav still advertises those digits. */
      if (!event.altKey && !event.ctrlKey && !event.metaKey) {
        if (event.key === "1") { router.push(WORKSPACE_PATH.terminal); return; }
        if (event.key === "2") { router.push(WORKSPACE_PATH.research); return; }
        if (event.key === "3") { router.push(WORKSPACE_PATH.replay); return; }
      }
      if (blocked) return;
      if (event.altKey && event.key === "1") {
        event.preventDefault();
        changeKindRef.current("perpetual");
      } else if (event.altKey && event.key === "2") {
        event.preventDefault();
        changeKindRef.current("future");
      } else if (event.altKey && event.key === "3") {
        event.preventDefault();
        changeKindRef.current("option");
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [blocked, router]);

  const stepContracts = (direction: -1 | 1): void => {
    const current = Number(quantity) || 0;
    const step = instrument?.quantityStep ?? (current >= 1 ? 1 : 0.01);
    const next = Math.max(instrument?.minContracts ?? step, Number((current + direction * step).toFixed(4)));
    setQuantity(String(next));
  };

  const sizeDerivativesBudget = (fraction: number): void => {
    if (!account || !instrument || !quote) return;
    const avail = Number(account.available) || 0;
    const refPrice = Number(quote.mark || quote.bid || maximumPrice) || 0;
    if (avail <= 0 || refPrice <= 0) return;
    const lev = Number(leverage) || 1;
    const cSize = instrument.contractSize || 1;
    const marginPerContract = (cSize * refPrice) / lev;
    if (marginPerContract <= 0) return;
    const budget = avail * fraction;
    const step = instrument.quantityStep || 1;
    const contracts = Math.floor((budget / marginPerContract) / step) * step;
    if (contracts > 0) {
      setQuantity(String(Number(contracts.toFixed(4))));
    }
  };
  function selectPosition(position: DerivativesPosition, settle?: string): void {
    // A settlement account can contain several contracts, and Deribit USDC
    // accounts can mix dated futures and options. Any ledger jump must switch
    // the whole workspace to that exact native contract.
    if (position.kind !== kind) {
      setKind(position.kind);
      setItems([]);
      setListLoading(true);
      setChainKey(null);
      setSide("long"); setLeverage("1"); setAction("open");
    }
    // A search term could hide the selected contract; ledger navigation always
    // shows the unfiltered venue listing.
    if (query !== "") { setQuery(""); setListLoading(true); }
    if (derivativePositionIsExpired(position, Date.now())) {
      // Drop a quote that belonged to this instrument before it expired; the
      // frozen view must come from the ledger, not a stale live response.
      setMarket(null); setMarketError(null); setBars([]); setCandleError(null);
    }
    if (position.kind === "option" && position.expiry !== null) {
      const nativeId = position.instrumentId.split(":").slice(2).join(":");
      const base = nativeId.split(/[-_]/, 1)[0];
      const settlement = settle ?? account?.settle;
      if (base && settlement) setChainKey(`${position.expiry}:${base}:${settlement}`);
    }
    select(position.instrumentId, position);
  }
  function beginClose(position: DerivativesPosition): void {
    // Pre-fill the exact position terms so a close is ready after its own quote loads.
    selectPosition(position, account?.settle);
    setAction("close"); setSide(position.side); setLeverage(String(position.leverage)); setQuantity(position.quantity);
    setNotice(null);
  }
  // Render-time validation uses the quote's timestamp. The submit handler and
  // QuoteFreshSubmit recheck against the wall clock without ticking this tree.
  const blockCode = quote ? derivativeBlockCode(instrument, quote, quote.timestamp) : null;
  const reason = quote
    ? (blockCode ? copy.blockReasons[blockCode] : null)
    : instrument ? copy.reasonNeedsQuote : copy.reasonSelectContract;
  const validOrder = /^\d+(?:\.\d+)?$/.test(quantity) && Number(quantity) > 0 && /^\d+(?:\.\d+)?$/.test(maximumPrice) && Number(maximumPrice) > 0 && Number.isInteger(Number(leverage)) && Number(leverage) >= 1 && Number(leverage) <= 20;

  async function command(openAccount: boolean): Promise<void> {
    if (mutationLock.current || blocked || !instrument || !accountReady) return;
    const currentCode = quote ? derivativeBlockCode(instrument, quote, Date.now()) : null;
    const currentReason = quote
      ? (currentCode ? copy.blockReasons[currentCode] : null)
      : reason;
    if (!openAccount && (currentReason || !validOrder)) {
      setNotice({ tone: "alert", text: currentReason ?? copy.invalidOrder });
      return;
    }
    mutationLock.current = true; setBusy(true); setNotice(null);
    try {
      let body: object;
      if (openAccount) body = { action: "open", instrumentId: instrument.id };
      else {
        const draft = { venue: instrument.venue, settle: instrument.settle, instrumentId: instrument.id, action, side, quantity, leverage: Number(leverage), reduceOnly: action === "close", maximumPrice };
        const previous = pendingOrder.current;
        const { clientOrderId: _id, ...previousDraft } = previous ?? { clientOrderId: "" };
        void _id;
        const request = previous && JSON.stringify(previousDraft) === JSON.stringify(draft) ? previous : { ...draft, clientOrderId: crypto.randomUUID() };
        pendingOrder.current = request;
        body = { action: "order", instrumentId: request.instrumentId, clientOrderId: request.clientOrderId, side: (request.action === "open") === (request.side === "long") ? "buy" : "sell", contracts: request.quantity, leverage: request.leverage, reduceOnly: request.reduceOnly, limitPrice: request.maximumPrice };
      }
      const data = await readJson<{ account: DerivativesAccount; deduplicated?: boolean }>("/api/derivatives/account", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      setLedgerAccounts((current) => [...(current ?? []).filter((entry) => entry.id !== data.account.id), data.account]);
      setNotice({ tone: "good", text: openAccount ? copy.accountOpened : data.deduplicated ? copy.orderConfirmed : copy.orderFilled });
      pendingOrder.current = null;
    } catch (error) {
      setNotice({ tone: "alert", text: copy.commandFailedRefresh(error instanceof Error ? error.message : copy.commandFailed) });
    } finally { mutationLock.current = false; setBusy(false); }
  }

  /* Grouping ~100 options runs on every render otherwise; items only change on
     list refetch, so the chain is keyed to that, not to clock ticks. */
  const chain = useMemo(() => (kind === "option" ? derivativeOptionChain(items) : []), [kind, items]);
  const activeChain = useMemo(
    () => chain.find((entry) => entry.key === chainKey) ?? chain[0] ?? null,
    [chain, chainKey],
  );
  const optionQuoteIds = useMemo(
    () => activeChain ? activeChain.rows.flatMap((row) => [row.call?.id, row.put?.id].filter((id): id is string => !!id)) : [],
    [activeChain],
  );
  const optionQuoteKey = optionQuoteIds.join("|");
  const currentOptionQuoteData = optionQuoteData.key === optionQuoteKey ? optionQuoteData : null;
  const optionQuotes = currentOptionQuoteData?.quotes ?? {};
  const staleOptionQuoteIds = useMemo(() => new Set(currentOptionQuoteData?.staleIds ?? []), [currentOptionQuoteData]);
  const optionQuoteError = currentOptionQuoteData?.error ?? null;

  useEffect(() => {
    if (blocked || listLoading || focusedExpired || kind !== "option" || optionQuoteIds.length === 0) return;
    let disposed = false;
    let inFlight = false;
    let retryTimer = 0;
    let delay = 5000;
    const controller = new AbortController();

    const schedule = () => {
      retryTimer = window.setTimeout(() => {
        if (disposed || controller.signal.aborted) return;
        if (document.hidden) { schedule(); return; }
        void refresh();
      }, delay);
    };
    const refresh = async () => {
      if (inFlight || controller.signal.aborted) return;
      inFlight = true;
      try {
        const data = await readJson<{ quotes: DerivativeQuote[]; asOf: number }>("/api/derivatives/options/quotes", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ instrumentIds: optionQuoteIds }),
          signal: controller.signal,
        });
        if (!disposed) {
          const asOf = Number.isFinite(data.asOf) ? data.asOf : Date.now();
          setOptionQuoteData({
            key: optionQuoteKey,
            quotes: Object.fromEntries(data.quotes.map((item) => [item.instrumentId, item])),
            staleIds: data.quotes.filter((item) => derivativeQuoteSnapshotIsStale(item, asOf)).map((item) => item.instrumentId),
            error: null,
          });
        }
        delay = 5000;
      } catch (error) {
        if (!disposed && !controller.signal.aborted) {
          setOptionQuoteData((current) => current.key === optionQuoteKey
            ? { ...current, error: exchangeErrorMessage(error, "chainQuotes") }
            : { key: optionQuoteKey, quotes: {}, staleIds: [], error: exchangeErrorMessage(error, "chainQuotes") });
        }
        delay = Math.min(delay * 2, 60_000);
      } finally {
        inFlight = false;
        if (!disposed && !controller.signal.aborted) schedule();
      }
    };
    const onVisibilityChange = () => {
      if (document.hidden) {
        setOptionQuoteData((current) => current.key === optionQuoteKey ? { ...current, staleIds: optionQuoteIds } : current);
        return;
      }
      if (inFlight) return;
      window.clearTimeout(retryTimer);
      void refresh();
    };
    document.addEventListener("visibilitychange", onVisibilityChange);
    void refresh();
    return () => {
      disposed = true;
      controller.abort();
      window.clearTimeout(retryTimer);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [blocked, kind, optionQuoteIds, optionQuoteKey, optionRevision, listLoading, focusedExpired]);
  const marketVenues = [...new Set(items.map((item) => item.venue))]
    .map((venue) => venue === "okx" ? "OKX" : "Deribit")
    .join(" + ");


  return <div className="derivatives-shell font-mono">
    <header className="derivatives-topbar">
      <Link href="/" className="derivatives-brand flex items-center gap-2">
        <div className="brand-mark p-1 rounded-xs bg-[var(--c-surface-3)] border border-[var(--ak-border-strong)] text-[var(--c-accent)] flex items-center justify-center">
          <Activity size={14} strokeWidth={2.4} />
        </div>
        <div className="font-bold text-xs tracking-wide flex items-center gap-1.5 font-mono">
          <span className="text-[var(--ak-text-primary)] font-semibold">newBeing</span>
          <span className="text-[var(--c-fg-4)] text-[10px] px-1 py-0.2 bg-[var(--c-surface-2)] border border-[var(--c-line)] rounded-xs">PRTS</span>
        </div>
      </Link>
      <h1 className="meta">{copy.title}</h1>
      <div className="topbar-divider h-5 w-[1px] bg-[var(--ak-border)] mx-1" />
      <nav className="workspace-nav flex items-center gap-1 shrink-0" aria-label={copy.navLabel}>
        <div className="workspace-flow-sequence flex items-center gap-1" role="group" aria-label={copy.workflowLabel}>
          <Link
            href={WORKSPACE_PATH.terminal}
            className="workspace-tab px-3 py-1 text-xs font-sans font-medium text-[var(--ak-text-secondary)] hover:text-white transition-all shrink-0"
            aria-label={copy.workspaceShortcut(copy.markets, "1")}
            title={copy.switchShortcut(copy.markets, "1")}
          >{copy.markets}</Link>
          <Link
            href={WORKSPACE_PATH.research}
            className="workspace-tab px-3 py-1 text-xs font-sans font-medium text-[var(--ak-text-secondary)] hover:text-white transition-all shrink-0"
            aria-label={copy.workspaceShortcut(copy.research, "2")}
            title={copy.switchShortcut(copy.research, "2")}
          >{copy.research}</Link>
          <Link
            href={WORKSPACE_PATH.replay}
            className="workspace-tab px-3 py-1 text-xs font-sans font-medium text-[var(--ak-text-secondary)] hover:text-white transition-all shrink-0"
            aria-label={copy.workspaceShortcut(copy.replay, "3")}
            title={copy.switchShortcut(copy.replay, "3")}
          >{copy.replay}</Link>
          <span
            className="workspace-tab active px-3 py-1 text-xs font-sans font-medium text-[var(--ak-text-primary)] bg-[var(--c-surface-2)] border-b-2 border-[var(--c-accent)] shadow-xs transition-all shrink-0 cursor-default"
            aria-current="page"
            aria-label={copy.currentWorkspaceAria}
            title={copy.currentWorkspaceTitle}
          >
            {copy.derivatives}
          </span>
        </div>
      </nav>
      <div className="flex-1" />
      <div className="topbar-status flex items-center gap-1.5 px-2.5 h-7 bg-[var(--ak-surface-sunken-2)] border border-[var(--ak-border-subtle)] rounded-xs whitespace-nowrap shrink-0 shadow-sm">
        <span className="w-1.5 h-1.5 rounded-full bg-[var(--ak-signal-success)] shrink-0" />
        <span className="text-[10px] font-mono text-[var(--ak-text-secondary)] font-semibold tracking-wider">{copy.paperLiveOff}</span>
      </div>
      <EngineModel />
    </header>

    {/* market plate: same grammar as the terminal's market-heading */}
    <div className="derivatives-plate">
      <div className="derivatives-identity">
        <span className="eyebrow">
          {instrument ? `${instrument.venue === "okx" ? "OKX" : "Deribit"} · ${copy.kindEyebrow[kind]}` : selectedId ? `${selectedId.split(":")[0]?.toUpperCase() ?? ""} · ${copy.kindEyebrow[kind]}` : copy.selectContract}
        </span>
        <span className="title">
          <span className="truncate" title={instrument?.nativeId ?? selectedId ?? undefined}>{instrument ? instrument.nativeId : selectedId ? (selectedId.split(":")[2] ?? selectedId) : <span className="text-[var(--c-fg-4)]">—</span>}</span>
          {selectedSettlement && <small>{selectedSettlement}</small>}
        </span>
      </div>
      {instrument && quote && <>
        <div className="derivatives-quote">
          <span className="side bid"><span className="value">{derivativeNumber(quote.bid)}</span><span className="tag">{copy.bidTag}</span></span>
          <span className="side ask"><span className="value">{derivativeNumber(quote.ask)}</span><span className="tag">{copy.askTag}</span></span>
        </div>
        <dl className="derivatives-context">
          <div className="kv"><dt>{copy.mark}</dt><dd>{derivativeNumber(quote.mark)}</dd></div>
          <div className="kv"><dt>{copy.index}</dt><dd>{derivativeNumber(quote.index)}</dd></div>
          {instrument.kind === "option" && <div className="kv"><dt>{copy.strike}</dt><dd>{derivativeNumber(instrument.strike)} {instrument.quote}</dd></div>}
          {instrument.kind === "option" && quote.iv != null && <div className="kv"><dt>{copy.iv}</dt><dd>{(quote.iv * 100).toFixed(1)}%</dd></div>}
          {instrument.kind === "option" && quote.delta != null && <div className="kv"><dt>{copy.delta}</dt><dd>{derivativeNumber(quote.delta)}</dd></div>}
          {/* A perpetual has no expiry; printing "Expiry: Perpetual" filled a
              labelled column with a category name instead of a date. */}
          {instrument.kind === "future" && <div className="kv"><dt>{copy.expiry}</dt><dd>{derivativeDate(instrument.expiry)}</dd></div>}
          {quote.fundingRate != null && <div className="kv"><dt>{copy.funding}</dt><dd>{(quote.fundingRate * 100).toFixed(4)}%</dd></div>}
          {quote.openInterest != null && <div className="kv"><dt>{copy.openInterest}</dt><dd>{derivativeNumber(quote.openInterest)}</dd></div>}
        </dl>
      </>}
      <div className="flex-1" />
      <div className="flex items-center gap-3">
        <AkTag variant={quote?.source === "fixture" ? "danger" : quote ? "default" : "neutral"}>
          {quote?.source === "fixture" ? copy.fixture : quote ? copy.publicRealtime : copy.noQuote}
        </AkTag>
        {!blocked && <Button size="sm" variant="outline" disabled={busy} onClick={() => { setListRevision((n) => n + 1); setMarketRevision((n) => n + 1); setOptionRevision((n) => n + 1); }}>{copy.refresh}</Button>}
      </div>
    </div>

    {blocked && <div role="status" className="derivatives-banner">
      <span>{copy.replayBanner}</span>
      <Link href="/" className="underline">{copy.openMainTerminal}</Link>
    </div>}

    {/* kind switch: the workspace-tab grammar from the main terminal nav */}
    <div role="tablist" aria-label={copy.marketsAria} className="derivatives-kind-tabs flex items-center gap-1 px-4 py-2 bg-[var(--ak-surface-sunken)] border-b border-[var(--c-line)]">
      {KINDS.map((value) => (
        <button
          key={value}
          type="button"
          role="tab"
          id={'derivatives-' + value}
          aria-selected={kind === value}
          aria-controls="derivatives-panel"
          className={'px-3 py-1 text-xs font-medium rounded-xs transition-all cursor-pointer ' + (kind === value ? "bg-[var(--c-surface-3)] text-[var(--c-fg)] font-semibold border-b-2 border-[var(--c-accent)] shadow-xs" : "text-[var(--c-fg-3)] hover:text-white hover:bg-[var(--c-surface-2)]")}
          disabled={busy || blocked}
          onClick={() => changeKind(value)}
        >
          {copy.kinds[value]}
        </button>
      ))}
      <div className="flex-1" />
      <span className="derivatives-kind-summary text-[11px] text-[var(--c-fg-4)] font-mono">{kind === "option" ? copy.longOptionsOnly : copy.linearContractsLine(marketVenues || copy.noVenues)}</span>
    </div>
    <div id="derivatives-panel" role="tabpanel" aria-labelledby={'derivatives-' + kind} className="flex flex-col flex-1">
    <main className="derivatives-layout" style={{ ["--mode" as string]: kind === "option" ? "var(--c-up)" : "var(--c-accent)" }}>
      {/* instrument rail: the watchlist vocabulary */}
      <h1 className="sr-only">{copy.pageTitle}</h1>
      <section className="derivatives-panel derivatives-rail" aria-label={copy.contractBrowser}>
        <div className="derivatives-panel-head">
          <span>{copy.instruments}</span>
          <span className="num">{blocked ? "—" : listLoading ? "…" : String(items.length).padStart(2, "0")}</span>
        </div>
        <div className="p-2 border-b border-[var(--c-line)]">
          <AkInput aria-label={copy.searchDerivatives} placeholder={copy.searchContracts} value={query} disabled={busy || blocked} onChange={(event) => { setPositionFocus(null); retainSelection.current = false; setListLoading(true); setListError(null); setQuery(event.target.value); }} />
        </div>
        {!blocked && kind === "option" && chain.length > 0 && <div className="flex flex-wrap gap-1 p-2 border-b border-[var(--c-line)]" role="group" aria-label={copy.expirySettlement}>
          {chain.map((entry) => (
            <button key={entry.key} type="button" disabled={busy}
              className={'px-2 py-0.5 text-[10px] font-mono font-bold tracking-wider border ' + ((activeChain?.key === entry.key) ? "text-[var(--c-accent)] border-[var(--c-accent)] bg-[color-mix(in_srgb,var(--c-accent)_12%,transparent)]" : "text-[var(--c-fg-3)] border-[var(--c-line)] hover:text-[var(--c-fg)]")}
              aria-pressed={activeChain?.key === entry.key}
              onClick={() => { if (activeChain?.key !== entry.key) { setOptionQuoteData({ key: "", quotes: {}, staleIds: [], error: null }); setChainKey(entry.key); } }}>
              {derivativeExpiryLabel(entry.expiry)} · {entry.base}/{entry.settle}
            </button>
          ))}
        </div>}
        {kind === "option" && activeChain && !blocked && <div className="space-y-1 border-b border-[var(--c-line)] px-2 py-1.5">
          <p className="meta">{copy.premiumPerBase(`${activeChain.base}/${activeChain.settle}`)}</p>
          {optionQuoteError && <div role="alert" className="space-y-1 text-[var(--c-down)] text-[10px]">
            <p>{optionQuoteError}</p>
            <Button size="sm" variant="outline" disabled={busy} onClick={() => setOptionRevision((n) => n + 1)}>{copy.retryChainQuotes}</Button>
          </div>}
          {!optionQuoteError && optionQuoteIds.length > 0 && !currentOptionQuoteData && <p role="status" className="text-[var(--c-fg-4)] text-[10px]">{copy.loadingBatchQuotes}</p>}
        </div>}
        <div className="derivatives-list">
          {blocked ? <p className="p-3 text-[var(--c-fg-4)] text-[11px]">{copy.liveDataHidden}</p>
            : listLoading ? <p className="p-3 text-[var(--c-fg-4)] text-[11px]">{copy.loadingInstruments}</p>
              : listError ? <div className="p-3 space-y-2"><p className="text-[var(--c-fg-3)] text-[11px]">{listError}</p><Button size="sm" variant="outline" onClick={() => setListRevision((n) => n + 1)}>{copy.retry}</Button></div>
                : !items.length ? <p className="p-3 text-[var(--c-fg-4)] text-[11px]">{copy.noMatchingContracts}</p>
                  : kind === "option" && activeChain ? activeChain.rows.map((row) => (
                    <div key={activeChain.expiry + "-" + row.strike} className="grid grid-cols-[1fr_auto_1fr] items-stretch border-b border-[var(--c-line-soft)]" role="group" aria-label={copy.strikeGroup(derivativeNumber(row.strike))}>
                      {(["call", "put"] as const).map((right) => {
                        const option = row[right];
                        if (!option) return <div key={right} className="min-h-[44px]" aria-label={copy.missingAtStrike(right === "call" ? copy.call : copy.put)} />;
                        const strikeTag = right === "call" ? "C" : "P";
                        const chainQuote = optionQuotes[option.id];
                        const quoteStale = staleOptionQuoteIds.has(option.id);
                        return (
                          <button key={right} type="button"
                            className={'derivatives-row !border-b-0 ' + (selectedId === option.id ? "selected" : "") + (right === "call" ? " border-r border-[var(--c-line-soft)]" : "")}
                            disabled={busy} aria-current={selectedId === option.id} onClick={() => select(option.id)}>
                            <span className="min-w-0 flex-1">
                              <strong className="truncate">{derivativeNumber(row.strike)} <span className="text-[var(--c-accent)]">{strikeTag}</span></strong>
                              <small>{option.settle} · {option.linear ? copy.linear : copy.coin}</small>
                              <OptionSnapshot quote={chainQuote} stale={quoteStale} />
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  ))
                  : items.map((item) => (
                    <button key={item.id} type="button" className={`derivatives-row ${selectedId === item.id ? "selected" : ""}`} disabled={busy} aria-current={selectedId === item.id} onClick={() => select(item.id)}>
                      <span className="min-w-0">
                        <strong className="truncate">{item.nativeId}</strong>
                        <small>{item.settle} · {item.linear ? copy.linear : item.inverse ? copy.inverseViewOnly : copy.option}</small>
                      </span>
                    </button>
                  ))}
        </div>
      </section>

      <div className="min-w-0 space-y-3 flex-1 overflow-y-auto min-h-0">
        <section className="derivatives-panel" aria-label={copy.marketDataAria}>
          <div className="derivatives-panel-head">
            <span>{copy.contractDetails}</span>
            {(instrument?.id || focusedLocalOnly?.instrumentId) && <span className="num normal-case tracking-normal font-mono text-[10px] text-[var(--c-fg-4)]">{instrument ? instrument.id : focusedLocalOnly?.instrumentId}</span>}
          </div>
          {marketError && !focusedLocalOnly && <div role="alert" className="m-3 space-y-2 text-[var(--c-down)] text-[11px]"><p>{marketError}</p><Button size="sm" variant="outline" disabled={busy} onClick={() => setMarketRevision((n) => n + 1)}>{copy.retryQuote}</Button></div>}
          {focusedLocalOnly && (
            <div className="derivatives-panel-body space-y-2">
              <p role="status" className="derivatives-ticket-note alert">
                {focusedExpired ? copy.expiredNotice : copy.delistedNotice}
              </p>
              <dl className="derivatives-context">
                <div className="kv"><dt>{copy.position}</dt><dd>{copy.positionValue(focusedLocalOnly.side, focusedLocalOnly.quantity)}</dd></div>
                <div className="kv"><dt>{copy.contractSize}</dt><dd>{focusedLocalOnly.contractSize}</dd></div>
                <div className="kv"><dt>{copy.entryPrice}</dt><dd>{focusedLocalOnly.entryPrice}</dd></div>
                <div className="kv"><dt>{copy.margin}</dt><dd>{focusedLocalOnly.margin} · {focusedLocalOnly.leverage}x</dd></div>
                <div className="kv"><dt>{copy.expiry}</dt><dd>{focusedLocalOnly.expiry === null ? copy.perpetual : derivativeDate(focusedLocalOnly.expiry)}</dd></div>
                <div className="kv"><dt>{copy.status}</dt><dd>{focusedExpired ? copy.frozenAwaiting : copy.localLedgerOnly}</dd></div>
              </dl>
            </div>
          )}
          {selectedId && !instrument && !marketError && !focusedLocalOnly && (
            <div className="derivatives-panel-body py-3 space-y-3 opacity-50 animate-pulse motion-reduce:animate-none">
              <div className="flex flex-wrap gap-x-6 gap-y-2">
                <div className="flex flex-col gap-1"><span className="meta">{copy.contractSize}</span><span className="w-16 h-3.5 bg-[var(--c-surface-3)] rounded-[2px]" /></div>
                <div className="flex flex-col gap-1"><span className="meta">{copy.minStep}</span><span className="w-16 h-3.5 bg-[var(--c-surface-3)] rounded-[2px]" /></div>
                <div className="flex flex-col gap-1"><span className="meta">{copy.priceTick}</span><span className="w-14 h-3.5 bg-[var(--c-surface-3)] rounded-[2px]" /></div>
                <div className="flex flex-col gap-1"><span className="meta">{copy.margin}</span><span className="w-16 h-3.5 bg-[var(--c-surface-3)] rounded-[2px]" /></div>
              </div>
            </div>
          )}
          {instrument && quote && <div className="derivatives-panel-body">
            <div className="flex flex-wrap gap-x-6 gap-y-1">
              <div className="flex flex-col gap-1"><span className="meta">{copy.contractSize}</span><span className="num">{derivativeNumber(instrument.contractSize)} {instrument.base}</span></div>
              <div className="flex flex-col gap-1"><span className="meta">{copy.minStep}</span><span className="num">{derivativeNumber(instrument.minContracts)} / {derivativeNumber(instrument.quantityStep)}</span></div>
              <div className="flex flex-col gap-1"><span className="meta">{copy.priceTick}</span><span className="num">{derivativeNumber(instrument.priceTick)}</span></div>
              <div className="flex flex-col gap-1"><span className="meta">{copy.margin}</span><span className="num">{instrument.kind === "option" ? copy.paidPremium : copy.isolated}</span></div>
            </div>
            <details className="derivatives-details">
              <summary>{copy.allFields}</summary>
              <dl className="derivatives-context mt-2">
                <div className="kv"><dt>{copy.nativeId}</dt><dd>{instrument.nativeId}</dd></div>
                <div className="kv"><dt>{copy.settlement}</dt><dd>{instrument.settle}</dd></div>
                <div className="kv"><dt>{copy.underlyingIndex}</dt><dd>{instrument.quote}/{instrument.base}</dd></div>
                {instrument.kind === "option" && <div className="kv"><dt>{copy.expiry}</dt><dd>{derivativeDate(instrument.expiry)}</dd></div>}
                <div className="kv"><dt>{copy.quoteTime}</dt><dd>{derivativeDate(quote.timestamp)}</dd></div>
                {quote.nextFundingAt != null && <div className="kv"><dt>{copy.nextFunding}</dt><dd>{derivativeDate(quote.nextFundingAt)}</dd></div>}
              </dl>
            </details>
            {reason && <p role="status" className="derivatives-ticket-note alert">{reason}</p>}
          </div>}
        </section>

        <section className="derivatives-panel" aria-label={copy.candlesAria}>
          <div className="derivatives-panel-head"><span>{copy.priceHistory}</span>{bars.length > 0 && <span className="num font-mono text-[10px] text-[var(--c-fg-4)]">{bars.length}</span>}</div>
          <div className={`derivatives-panel-body ${!bars.length ? "min-h-[240px] flex flex-col items-center justify-center text-center" : ""}`}>
            {blocked ? <p className="text-[var(--c-fg-4)] text-[11px]">{copy.liveHistoryHidden}</p>
              : focusedLocalOnly ? <p className="text-[var(--c-fg-4)] text-[11px]">{copy.liveHistoryUnavailable}</p>
              : kind === "option" ? <p className="text-[var(--c-fg-4)] text-[11px]">{copy.optionCandlesUnsupported}</p>
                : candleError ? <p role="status" className="text-[var(--c-fg-4)] text-[11px]">{candleError}</p>
                  : bars.length ? <CandleSeries bars={bars} />
                    : <p className="text-[var(--c-fg-4)] text-[11px]">{selectedId ? copy.noCandleData : copy.selectContractCandles}</p>}
          </div>
        </section>

        <section className="derivatives-panel" aria-label={copy.accountAria}>
          <div className="derivatives-panel-head">
            <span>{blocked ? copy.frozenSnapshotTitle : copy.paperAccount(instrument ? `· ${instrument.venue.toUpperCase()} / ${instrument.settle}` : "")}</span>
            <Button size="sm" variant="outline" disabled={ledgerAccounts === null} onClick={() => setLedgerRevision((n) => n + 1)}>{blocked ? copy.refreshSnapshot : copy.refreshLedger}</Button>
          </div>
          <div className="derivatives-panel-body">
            {ledgerError ? <p role="alert" className="text-[var(--c-down)] text-[11px]">{copy.ledgerUnavailable(ledgerError)}</p>
              : ledgerAccounts === null ? <p className="text-[var(--c-fg-4)] text-[11px]">{copy.loadingLocalAccounts}</p>
                : blocked ? ledgerAccounts.length
                  ? <LocalAccountLedger accounts={ledgerAccounts} readOnly />
                  : <p className="text-[var(--c-fg-4)] text-[11px]">{copy.noPaperAccountsStored}</p>
                : account ? null
                  : ledgerAccounts.length ? <LocalAccountLedger accounts={ledgerAccounts} onSelectPosition={selectPosition} />
                    : <p className="text-[var(--c-fg-4)] text-[11px]">{copy.noLocalAccounts}</p>}
            {blocked ? null
              : account ? <>
                      <dl className="derivatives-account-grid">
                        <div><dt>{copy.available}</dt><dd>{account.available} <small>{account.settle}</small></dd></div>
                        <div><dt>{copy.realizedPnl}</dt><dd className={account.realizedPnl.startsWith("-") ? "text-[var(--c-down)]" : account.realizedPnl === "0" ? "" : "text-[var(--c-up)]"}>{account.realizedPnl} <small>{account.settle}</small></dd></div>
                        <div><dt>{copy.feesPaid}</dt><dd>{account.feesPaid} <small>{account.settle}</small></dd></div>
                      </dl>
                      <div>
                        <span className="meta">{copy.positions}</span>
                        {!account.positions.length ? <p className="mt-1 text-[var(--c-fg-4)] text-[11px]">{copy.noOpenPositions}</p>
                          : <div className="derivatives-table-scroll mt-2 border border-[var(--c-line)]">
                            <table className="derivatives-table derivatives-positions-table">
                              <thead><tr>{copy.positionColumns.map((label) => <th key={label}>{label}</th>)}</tr></thead>
                              <tbody>{account.positions.map((position) => <PositionRow key={`${position.instrumentId}:${position.side}`} position={position} quote={quote} busy={busy} onClose={beginClose} onView={selectPosition} />)}</tbody>
                            </table>
                          </div>}
                      </div>
                      <div>
                        <span className="meta">{copy.orderHistoryWithCount(account.orderCount)}</span>
                        <OrderHistory key={`${account.id}:${account.orderCount}`} account={account} />
                      </div>
                    </> : accountReady && instrument && ledgerAccounts.length > 0 ? <p className="text-[var(--c-fg-4)] text-[11px]">{copy.noAccountForSettlement}</p> : null}
          </div>
        </section>
      </div>

      {/* ticket: the spot inspector's paper ticket grammar */}
      <section className="derivatives-panel" aria-label={copy.ticketAria}>
        <div className="derivatives-panel-head"><span>{copy.paperTicket}</span>{instrument && <span className="num normal-case tracking-normal font-mono text-[10px] text-[var(--c-fg-4)]">{instrument.venue.toUpperCase()}/{instrument.settle}</span>}</div>
        <div className="derivatives-panel-body derivatives-ticket">
          {instrument && quote && <p className="derivatives-ticket-note">{copy.separateAccount}</p>}
          {blocked ? <p role="status" className="derivatives-ticket-note">{copy.entryHidden}</p>
            : !instrument || !quote ? (
              <div className="degraded-panel p-3 border space-y-1.5 font-mono">
                <div className="degraded-caption flex items-center gap-1.5 font-bold text-[10px] tracking-wider uppercase">
                  <span className="degraded-dot w-1.5 h-1.5 rounded-full animate-pulse motion-reduce:animate-none shrink-0" />
                  <span>{copy.orderEntryPaused}</span>
                </div>
                <p role="status" className="derivatives-ticket-note alert m-0 text-[11px] leading-relaxed">
                  {focusedLocalOnly
                    ? focusedExpired ? copy.pausedExpired : copy.pausedDelisted
                    : listLoading ? copy.pausedListLoading : copy.pausedGeneric}
                </p>
              </div>
            )
              : !accountReady ? <p role="status" className="derivatives-ticket-note">{ledgerError ? copy.accountUnavailable : copy.loadingPaperAccount}</p>
                : !account ? <>
            <div className="flex flex-col gap-1 flex items-baseline justify-between"><span className="meta">{copy.initialBalance}</span><span className="num">{initialBalance} {instrument.settle}</span></div>
            <p className="derivatives-ticket-note">{copy.seedNote(instrument.settle)}</p>
            <Button block variant="primary" disabled={busy || blocked} onClick={() => void command(true)}>{copy.openPaperAccount}</Button>
          </> : <form className="derivatives-ticket" onSubmit={(event) => { event.preventDefault(); void command(false); }}>
            <fieldset disabled={busy || blocked || !account} className="derivatives-ticket">
              <label className="field">
                <span>{copy.action}</span>
                <AkSelect aria-label={copy.orderActionAria} value={action} onChange={(event) => setAction(event.target.value as "open" | "close")}>
                  <option value="open">{kind === "option" ? copy.buyToOpen : copy.open}</option>
                  <option value="close">{kind === "option" ? copy.sellToClose : copy.closeReduceOnly}</option>
                </AkSelect>
              </label>
              <label className="field">
                <span>{copy.positionSide}</span>
                <AkSelect aria-label={copy.positionSideAria} value={side} onChange={(event) => setSide(event.target.value as "long" | "short")}>
                  <option value="long">{copy.long}</option>
                  {kind !== "option" && <option value="short">{copy.short}</option>}
                </AkSelect>
              </label>
              <label className="field">
                <div className="flex items-center justify-between">
                  <span>{copy.quantityContracts}</span>
                  {instrument && (
                    <span className="text-[10px] text-[var(--c-fg-4)]">{copy.step(derivativeNumber(instrument.quantityStep))}</span>
                  )}
                </div>
                <div className="flex items-center gap-1">
                  <div className="flex-1">
                    <AkInput aria-label={copy.quantityAria} inputMode="decimal" value={quantity} onChange={(event) => setQuantity(event.target.value)} />
                  </div>
                  <button
                    type="button"
                    disabled={busy || blocked || !account}
                    onClick={() => stepContracts(-1)}
                    aria-label={copy.decreaseContracts}
                    className="min-h-[44px] min-w-[44px] px-2.5 py-1 bg-[var(--ak-surface-sunken)] border border-[var(--ak-border-subtle)] hover:bg-[var(--ak-surface-sunken-2)] active:scale-95 text-xs text-[var(--ak-text-primary)] font-mono select-none"
                  >
                    -
                  </button>
                  <button
                    type="button"
                    disabled={busy || blocked || !account}
                    onClick={() => stepContracts(1)}
                    aria-label={copy.increaseContracts}
                    className="min-h-[44px] min-w-[44px] px-2.5 py-1 bg-[var(--ak-surface-sunken)] border border-[var(--ak-border-subtle)] hover:bg-[var(--ak-surface-sunken-2)] active:scale-95 text-xs text-[var(--ak-text-primary)] font-mono select-none"
                  >
                    +
                  </button>
                </div>
                {account && (
                  <div className="flex items-center gap-1 mt-1">
                    <span className="text-[10px] text-[var(--c-fg-4)] uppercase mr-1">{copy.size}</span>
                    {[0.25, 0.5, 0.75, 1].map((fraction) => (
                      <button
                        key={fraction}
                        type="button"
                        disabled={busy || blocked}
                        onClick={() => sizeDerivativesBudget(fraction)}
                        className="min-h-[44px] flex-1 py-0.5 px-1 bg-[var(--ak-surface-sunken)] border border-[var(--c-line)] hover:border-[var(--c-accent)] active:scale-95 text-[10px] font-mono text-[var(--c-fg-2)] transition-transform"
                      >
                        {fraction === 1 ? copy.max : `${fraction * 100}%`}
                      </button>
                    ))}
                  </div>
                )}
              </label>
              <label className="field">
                <span>{copy.isolatedLeverage}</span>
                <AkSelect aria-label={copy.isolatedLeverageAria} value={leverage} onChange={(event) => setLeverage(event.target.value)}>
                  {Array.from({ length: kind === "option" ? 1 : 20 }, (_, n) => <option key={n + 1} value={n + 1}>{n + 1}x</option>)}
                </AkSelect>
                {kind !== "option" && (
                  <div className="flex items-center gap-1 mt-1">
                    <span className="text-[10px] text-[var(--c-fg-4)] mr-1">{copy.preset}</span>
                    {[1, 2, 5, 10, 20].map((lev) => (
                      <button
                        key={lev}
                        type="button"
                        disabled={busy || blocked}
                        onClick={() => setLeverage(String(lev))}
                        className={`min-h-[44px] flex-1 py-0.5 text-[10px] font-mono border transition-transform active:scale-95 ${Number(leverage) === lev ? "border-[var(--c-accent)] text-[var(--c-accent)] bg-[color-mix(in_srgb,var(--c-accent)_12%,transparent)] font-bold" : "border-[var(--c-line)] text-[var(--c-fg-3)] hover:text-[var(--c-fg)]"}`}
                      >
                        {lev}x
                      </button>
                    ))}
                  </div>
                )}
              </label>
              <label className="field">
                <span>{(action === "open") === (side === "long") ? copy.buyCeiling(instrument?.settle ?? copy.settleFallback) : copy.sellFloor(instrument?.settle ?? copy.settleFallback)}</span>
                <AkInput aria-label={copy.priceProtectionAria} inputMode="decimal" value={maximumPrice} onChange={(event) => setMaximumPrice(event.target.value)} />
                {quote && (
                  <div className="flex items-center gap-1 mt-1 text-[10px]">
                    <span className="text-[10px] text-[var(--c-fg-4)] mr-1">{copy.fill}</span>
                    <button
                      type="button"
                      disabled={busy || blocked || typeof quote.bid !== "number" || !Number.isFinite(quote.bid) || quote.bid <= 0}
                      onClick={() => {
                        if (typeof quote.bid === "number" && Number.isFinite(quote.bid) && quote.bid > 0) {
                          setMaximumPrice(String(quote.bid));
                        }
                      }}
                      className="min-h-[44px] px-1.5 py-0.5 border border-[var(--c-line)] hover:border-[var(--c-accent)] text-[var(--c-up)] font-mono text-[10px] active:scale-95 transition-transform disabled:opacity-40"
                      title={copy.fillWithBid}
                    >
                      {copy.bidButton(derivativeNumber(quote.bid))}
                    </button>
                    <button
                      type="button"
                      disabled={busy || blocked || typeof quote.mark !== "number" || !Number.isFinite(quote.mark) || quote.mark <= 0}
                      onClick={() => {
                        if (typeof quote.mark === "number" && Number.isFinite(quote.mark) && quote.mark > 0) {
                          setMaximumPrice(String(quote.mark));
                        }
                      }}
                      className="min-h-[44px] px-1.5 py-0.5 border border-[var(--c-line)] hover:border-[var(--c-accent)] text-[var(--c-fg-2)] font-mono text-[10px] active:scale-95 transition-transform disabled:opacity-40"
                      title={copy.fillWithMark}
                    >
                      {copy.markButton(derivativeNumber(quote.mark))}
                    </button>
                    <button
                      type="button"
                      disabled={busy || blocked || typeof quote.ask !== "number" || !Number.isFinite(quote.ask) || quote.ask <= 0}
                      onClick={() => {
                        if (typeof quote.ask === "number" && Number.isFinite(quote.ask) && quote.ask > 0) {
                          setMaximumPrice(String(quote.ask));
                        }
                      }}
                      className="min-h-[44px] px-1.5 py-0.5 border border-[var(--c-line)] hover:border-[var(--c-accent)] text-[var(--c-down)] font-mono text-[10px] active:scale-95 transition-transform disabled:opacity-40"
                      title={copy.fillWithAsk}
                    >
                      {copy.askButton(derivativeNumber(quote.ask))}
                    </button>
                  </div>
                )}
              </label>
              <p className="derivatives-ticket-note">{action === "close" ? copy.reduceOnlyNote : copy.immediateFillNote}</p>
              {instrument && quote
                ? <QuoteFreshSubmit instrument={instrument} quote={quote} disabled={busy || blocked || !account || !validOrder || !!reason} submitting={busy} />
                : <Button type="submit" block variant="primary" disabled>{copy.submitOrder}</Button>}
            </fieldset>
          </form>}
          {notice && <p role="status" className={`derivatives-ticket-note ${notice.tone}`}>{notice.text}</p>}
          {instrument && quote && <p className="derivatives-ticket-note">{copy.fundingNote}</p>}
        </div>
      </section>
    </main>
    </div>

    <footer className="derivatives-statusbar">
      <span>{copy.localWorkspace(instrument ? `${instrument.nativeId} · ${instrument.settle}` : copy.noContract)}</span>
      <span>{copy.statusbar}</span>
    </footer>
    <nav className="mobile-mode-nav derivatives-mobile-nav" aria-label={copy.navLabel}>
      <Link href={WORKSPACE_PATH.terminal}>{copy.markets}</Link>
      <Link href={WORKSPACE_PATH.research}>{copy.research}</Link>
      <Link href={WORKSPACE_PATH.replay}>{copy.replay}</Link>
      <Link href="/derivatives" aria-current="page" className="active">{copy.derivatives}</Link>
    </nav>
  </div>;
}
