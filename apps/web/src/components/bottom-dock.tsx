"use client";

import { useEffect, useRef, useState } from "react";
import { AreaSeries, ColorType, createChart, type IChartApi, type Time, type UTCTimestamp } from "lightweight-charts";
import { AlertCircle, ArrowDownRight, ArrowUpRight, Boxes, Clock3, FileText, ListChecks, RefreshCw, Wallet } from "lucide-react";
import type { BacktestResult, ExchangeId, PaperOrder, PaperPortfolio, ReplaySession } from "@newbeing/core";
import { Button } from "@/components/ui/button";
import { EXCHANGE_LABELS } from "@/lib/exchanges";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useShallow } from "zustand/react/shallow";
import { useWorkspaceStore } from "@/store/workspace";

/** Format an amount in the symbol's own quote currency (USD on Coinbase and
 *  Kraken, USDT elsewhere) rather than assuming USDT everywhere. */
function money(value: number, currency = "USDT"): string {
  return `${value < 0 ? "−" : ""}${Math.abs(value).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${currency}`;
}

function percentage(value: number): string {
  return `${value >= 0 ? "+" : "−"}${(Math.abs(value) * 100).toFixed(2)}%`;
}

function timestamp(value: number): string {
  return new Date(value).toLocaleString([], { month: "short", day: "2-digit", hour: "2-digit", minute: "2-digit" });
}

function EquityChart({ result }: { result: BacktestResult }): React.JSX.Element {
  const root = useRef<HTMLDivElement>(null);
  const theme = useWorkspaceStore((state) => state.theme);
  useEffect(() => {
    const container = root.current;
    if (!container || result.equityCurve.length === 0) return;
    const chart = createChart(container, {
      autoSize: false,
      width: container.clientWidth,
      height: container.clientHeight,
      layout: { background: { type: ColorType.Solid, color: "transparent" }, textColor: theme === "dark" ? "#87909a" : "#64748b", fontSize: 10 },
      grid: { vertLines: { visible: false }, horzLines: { color: theme === "dark" ? "rgba(139,148,158,.08)" : "rgba(100,116,139,.12)" } },
      rightPriceScale: { borderVisible: false },
      timeScale: { visible: false, borderVisible: false },
      crosshair: { vertLine: { visible: false }, horzLine: { visible: false } },
    });
    const isUp = result.metrics.finalEquity >= result.metrics.initialCapital;
    const series = chart.addSeries(AreaSeries, {
      lineColor: isUp ? "#1fb180" : "#ea525e",
      topColor: isUp ? "rgba(31,177,128,.20)" : "rgba(234,82,94,.20)",
      bottomColor: isUp ? "rgba(31,177,128,.015)" : "rgba(234,82,94,.015)",
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
  }, [result, theme]);
  return <div className="equity-chart" ref={root} />;
}

interface PaperPayload {
  portfolio: PaperPortfolio;
  orders: PaperOrder[];
}

function PaperPositions({ symbol, exchange }: { symbol: string; exchange: ExchangeId }): React.JSX.Element {
  const [payload, setPayload] = useState<PaperPayload | null>(null);
  const [price, setPrice] = useState<number | null>(null);
  const [stale, setStale] = useState(false);
  useEffect(() => {
    let disposed = false;
    const refresh = async (): Promise<void> => {
      try {
        const [accountResponse, tickerResponse] = await Promise.all([
          fetch(`/api/paper?symbol=${encodeURIComponent(symbol)}&exchange=${exchange}`, { cache: "no-store" }),
          fetch(`/api/market?kind=summary&exchange=${exchange}&symbol=${encodeURIComponent(symbol)}`, { cache: "no-store" }),
        ]);
        const account: unknown = await accountResponse.json();
        const ticker: unknown = await tickerResponse.json();
        if (disposed) return;
        if (!accountResponse.ok || typeof account !== "object" || account === null || !("portfolio" in account) || !("orders" in account)) throw new Error("Paper account unavailable.");
        setPayload(account as PaperPayload);
        const tickerValid = tickerResponse.ok && typeof ticker === "object" && ticker !== null && "last" in ticker && typeof ticker.last === "number";
        if (tickerResponse.ok && typeof ticker === "object" && ticker !== null && "last" in ticker && typeof ticker.last === "number") setPrice(ticker.last);
        setStale(!tickerValid);
      } catch {
        if (!disposed) setStale(true);
      }
    };
    void refresh();
    const timer = window.setInterval(() => void refresh(), 8_000);
    return () => { disposed = true; window.clearInterval(timer); };
  }, [symbol, exchange]);
  if (!payload) return <div className="empty-state"><Wallet size={18} /><strong>Paper account unavailable</strong><span>Waiting for local account state.</span></div>;
  const { portfolio } = payload;
  const unrealized = portfolio.averageEntryPrice !== null && price !== null
    ? (price - portfolio.averageEntryPrice) * portfolio.baseBalance
    : 0;
  /* The wallet is denominated in the pair's quote asset. */
  const quoteCurrency = symbol.split("/")[1] ?? "USDT";
  return <div className="position-table-wrap">
    <div className="paper-isolation-note"><span className="paper-chip">PAPER ONLY</span><span>Isolated per-symbol demo wallet · never routes an order to {EXCHANGE_LABELS[exchange]}</span></div>
    {stale && <div className="table-footnote">STALE · Showing the last {EXCHANGE_LABELS[exchange]} account snapshot; mark price may also be out of date.</div>}
    <table className="data-table"><thead><tr><th>ASSET</th><th>SIZE</th><th>AVG ENTRY</th><th>MARK</th><th>UNREALIZED PNL</th><th>REALIZED PNL</th><th>AVAILABLE</th></tr></thead>
      <tbody><tr>
        <td className="instrument"><strong>{symbol.split("/")[0]}</strong><small>/{symbol.split("/")[1]}</small></td>
        <td>{portfolio.baseBalance.toFixed(6)}</td>
        <td>{portfolio.averageEntryPrice?.toLocaleString(undefined, { maximumFractionDigits: 6 }) ?? "—"}</td>
        <td>{price?.toLocaleString(undefined, { maximumFractionDigits: 6 }) ?? "—"}</td>
        <td className={unrealized >= 0 ? "positive" : "negative"}>{money(unrealized, quoteCurrency)}</td>
        <td className={portfolio.realizedPnl >= 0 ? "positive" : "negative"}>{money(portfolio.realizedPnl, quoteCurrency)}</td>
        <td>{money(portfolio.quoteBalance, quoteCurrency)}</td>
      </tr></tbody>
    </table>
    {portfolio.baseBalance === 0 && <div className="table-footnote">No open Paper position for {symbol.split("/")[0]}.</div>}
  </div>;
}

function ReplayPositions({ session, portfolio }: { session: ReplaySession | null; portfolio: PaperPortfolio | null }): React.JSX.Element {
  if (!session || !portfolio) return <div className="empty-state"><Wallet size={18} /><strong>No replay account loaded</strong><span>Start a historical replay to create its isolated account.</span></div>;
  const current = session.bars.at(-1);
  const unrealized = current && portfolio.averageEntryPrice !== null
    ? (current.close - portfolio.averageEntryPrice) * portfolio.baseBalance
    : 0;
  const quoteCurrency = session.symbol.split("/")[1] ?? "USDT";
  return <div className="position-table-wrap">
    <div className="paper-isolation-note"><span className="paper-chip">REPLAY</span><span>Separate per-session account · marked only to the last revealed bar close</span></div>
    <table className="data-table"><thead><tr><th>ASSET</th><th>SIZE</th><th>AVG ENTRY</th><th>REPLAY CLOSE</th><th>UNREALIZED PNL</th><th>REALIZED PNL</th><th>AVAILABLE</th></tr></thead><tbody>
      <tr><td className="instrument"><strong>{session.symbol.split("/")[0]}</strong><small>/{session.symbol.split("/")[1]} · {session.timeframe}</small></td><td>{portfolio.baseBalance.toFixed(6)}</td><td>{portfolio.averageEntryPrice?.toLocaleString(undefined, { maximumFractionDigits: 6 }) ?? "—"}</td><td>{current?.close.toLocaleString(undefined, { maximumFractionDigits: 6 }) ?? "—"}</td><td className={unrealized >= 0 ? "positive" : "negative"}>{money(unrealized, quoteCurrency)}</td><td className={portfolio.realizedPnl >= 0 ? "positive" : "negative"}>{money(portfolio.realizedPnl, quoteCurrency)}</td><td>{money(portfolio.quoteBalance, quoteCurrency)}</td></tr>
    </tbody></table>
  </div>;
}

function OrdersTable({ orders }: { orders: PaperOrder[] }): React.JSX.Element {
  if (orders.length === 0) return <div className="empty-state"><ListChecks size={18} /><strong>No simulated orders yet</strong><span>Paper orders will appear here with their client IDs and state.</span></div>;
  return <div className="table-scroll"><table className="data-table"><thead><tr><th>TIME</th><th>SYMBOL</th><th>SIDE</th><th>QUANTITY</th><th>STATUS</th><th>FILL</th><th>CLIENT ORDER ID</th></tr></thead><tbody>
    {orders.map((order) => <tr key={order.clientOrderId}><td>{new Date(order.createdAt).toLocaleTimeString()}</td><td>{order.symbol}</td><td className={order.side === "buy" ? "positive" : "negative"}>{order.side.toUpperCase()}</td><td>{order.quantity}</td><td><span className={`status-pill status-${order.status}`}>{order.status}</span></td><td>{order.fillPrice?.toLocaleString(undefined, { maximumFractionDigits: 6 }) ?? "—"}</td><td className="mono">{order.clientOrderId}</td></tr>)}
  </tbody></table></div>;
}

function BacktestView({ result, onOpenStrategy }: { result: BacktestResult | null; onOpenStrategy: () => void }): React.JSX.Element {
  if (!result) return <div className="empty-state"><FileText size={18} /><strong>No backtest selected</strong><span>Start with a reviewed built-in strategy, then run a deterministic historical test on any supported venue.</span><Button variant="outline" size="sm" onClick={onOpenStrategy}>Open Strategy Lab</Button></div>;
  const metric = result.metrics;
  return <div className="backtest-view">
    <div className="backtest-summary-row">
      <div className="metric-strip">
        <Metric label="TOTAL RETURN" value={percentage(metric.totalReturn)} tone={metric.totalReturn >= 0 ? "positive" : "negative"} />
        <Metric label="MAX DRAWDOWN" value={percentage(-metric.maxDrawdown)} tone="negative" />
        <Metric label="SHARPE · BAR" value={metric.sharpeRatio?.toFixed(2) ?? "—"} title={result.execution?.sharpeMethod} />
        <Metric label="WIN RATE" value={percentage(metric.winRate)} />
        <Metric label="PROFIT FACTOR" value={metric.profitFactor?.toFixed(2) ?? "—"} />
        <Metric label="TRADES" value={String(metric.tradeCount)} />
      </div>
      <div className="equity-chart-wrap"><div className="equity-chart-label">EQUITY CURVE · {result.symbol.split("/")[1]}</div><EquityChart result={result} /></div>
    </div>
    <div className="backtest-meta">
      <span>{result.symbol} · {result.timeframe}</span><span>{result.strategyId} v{result.strategyVersion}</span>
      <span>Fee {(result.assumptions.feeRate * 10_000).toFixed(1)} bps · Slippage {(result.assumptions.slippageRate * 10_000).toFixed(1)} bps</span>
      <span title={result.execution?.fillTiming}>{result.execution?.fillTiming ?? "Next-bar open"} · {result.engineVersion}</span>
    </div>
    <div className="table-scroll trade-table-scroll">
      {result.trades.length === 0 ? <div className="empty-inline"><AlertCircle size={14} />No completed trades under these parameters.</div> : <table className="data-table"><thead><tr><th>#</th><th>SIDE</th><th>ENTRY UTC</th><th>ENTRY</th><th>EXIT UTC</th><th>EXIT</th><th>NET PNL</th><th>FEES</th><th>REASON</th></tr></thead><tbody>
        {result.trades.map((trade, index) => <tr key={trade.id}><td>{index + 1}</td><td className={trade.side === "long" ? "positive" : "negative"}>{trade.side.toUpperCase()}</td><td>{timestamp(trade.entryTime)}</td><td>{trade.entryPrice.toLocaleString(undefined, { maximumFractionDigits: 6 })}</td><td>{timestamp(trade.exitTime)}</td><td>{trade.exitPrice.toLocaleString(undefined, { maximumFractionDigits: 6 })}</td><td className={trade.netPnl >= 0 ? "positive" : "negative"}>{money(trade.netPnl, result.symbol.split("/")[1])}</td><td>{money(trade.fees, result.symbol.split("/")[1])}</td><td>{trade.exitReason}</td></tr>)}
      </tbody></table>}
    </div>
    <div className="result-provenance">Result {result.resultId} · dataset {result.datasetId} · {new Date(result.createdAt).toLocaleString()}</div>
  </div>;
}

function Metric({ label, value, tone, title }: { label: string; value: string; tone?: "positive" | "negative"; title?: string }): React.JSX.Element {
  const Icon = tone === "positive" ? ArrowUpRight : tone === "negative" ? ArrowDownRight : null;
  return <div className="metric-cell" title={title}><span>{label}</span><strong className={tone ?? ""}>{Icon && <Icon size={12} />}{value}</strong></div>;
}

function ExperimentHistory({ onSelect }: { onSelect: (id: string) => void }): React.JSX.Element {
  const [items, setItems] = useState<BacktestResult[]>([]);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let disposed = false;
    void fetch("/api/backtests?limit=30", { cache: "no-store" }).then(async (response) => {
      const payload: unknown = await response.json();
      if (!response.ok) throw new Error("Experiment history is unavailable.");
      if (typeof payload === "object" && payload !== null && "items" in payload && Array.isArray(payload.items) && !disposed) setItems(payload.items as BacktestResult[]);
    }).catch((reason: unknown) => { if (!disposed) setError(reason instanceof Error ? reason.message : "History load failed."); });
    return () => { disposed = true; };
  }, []);
  if (error) return <div className="empty-state"><AlertCircle size={18} /><strong>History unavailable</strong><span>{error}</span></div>;
  if (items.length === 0) return <div className="empty-state"><Clock3 size={18} /><strong>No saved experiments</strong><span>Each completed backtest is stored in local SQLite.</span></div>;
  return <div className="table-scroll"><table className="data-table"><thead><tr><th>CREATED</th><th>SYMBOL</th><th>STRATEGY</th><th>RETURN</th><th>MAX DD</th><th>TRADES</th><th>RESULT ID</th></tr></thead><tbody>
    {items.map((item) => <tr key={item.resultId} onClick={() => onSelect(item.resultId)} className="clickable-row"><td>{new Date(item.createdAt).toLocaleString()}</td><td>{item.symbol} · {item.timeframe}</td><td>{item.strategyId}</td><td className={item.metrics.totalReturn >= 0 ? "positive" : "negative"}>{percentage(item.metrics.totalReturn)}</td><td className="negative">{percentage(-item.metrics.maxDrawdown)}</td><td>{item.metrics.tradeCount}</td><td className="mono">{item.resultId.slice(0, 12)}…</td></tr>)}
  </tbody></table></div>;
}

export function BottomDock({ replayMode = false, replaySession = null, replayPortfolio = null, replayOrders = [], workspace = "terminal" }: {
  workspace?: "terminal" | "research" | "replay";
  replayMode?: boolean;
  replaySession?: ReplaySession | null;
  replayPortfolio?: PaperPortfolio | null;
  replayOrders?: PaperOrder[];
}): React.JSX.Element {
  const [tab, setTab, symbol, exchange, result, activeBacktestId, setBacktest, setWorkspace, setInspectorTab, setExchange] = useWorkspaceStore(useShallow((state) => [
    state.dockTab, state.setDockTab, state.symbol, state.exchange, state.backtest, state.activeBacktestId, state.setBacktest, state.setWorkspace, state.setInspectorTab, state.setExchange,
  ]));
  /* A stored dockTab may belong to another workspace (e.g. "history" while in
     Markets). Resolve to the first tab this mode actually offers.
     Research carries the results board too, which used to live in a separate
     Backtest workspace: parameters, saved runs and the metrics for the run you
     picked are all part of studying one strategy. */
  const allowedTabs = workspace === "terminal" || workspace === "replay"
    ? ["positions", "orders"] as const
    : ["backtest", "history", "logs"] as const;
  const activeTab = (allowedTabs as readonly string[]).includes(tab) ? tab : allowedTabs[0];

  const [paper, setPaper] = useState<PaperPayload | null>(null);
  const [paperError, setPaperError] = useState<string | null>(null);
  const selectResult = (resultId: string): void => {
    void fetch(`/api/backtests/${encodeURIComponent(resultId)}`, { cache: "no-store" }).then(async (response) => {
      const payload: unknown = await response.json();
      if (!response.ok) throw new Error("Backtest result could not be loaded.");
      setBacktest(payload as BacktestResult);
      setTab("backtest");
    }).catch((error: unknown) => setPaperError(error instanceof Error ? error.message : "Could not load result."));
  };
  useEffect(() => {
    if (replayMode || !activeBacktestId || result?.resultId === activeBacktestId) return;
    void fetch(`/api/backtests/${encodeURIComponent(activeBacktestId)}`, { cache: "no-store" }).then(async (response) => {
      const payload: unknown = await response.json();
      if (response.ok) setBacktest(payload as BacktestResult);
    }).catch(() => undefined);
  }, [activeBacktestId, result?.resultId, setBacktest, replayMode]);
  useEffect(() => {
    if (replayMode) return;
    let disposed = false;
    const refresh = async (): Promise<void> => {
      try {
        const response = await fetch(`/api/paper?symbol=${encodeURIComponent(symbol)}&exchange=${exchange}`, { cache: "no-store" });
        const payload: unknown = await response.json();
        if (!response.ok) throw new Error("Paper account could not be loaded.");
        if (typeof payload === "object" && payload !== null && "portfolio" in payload && "orders" in payload && !disposed) {
          setPaper(payload as PaperPayload);
          setPaperError(null);
        }
      } catch (reason) {
        if (!disposed) setPaperError(reason instanceof Error ? reason.message : "Paper data unavailable.");
      }
    };
    void refresh();
    const timer = window.setInterval(() => void refresh(), 8_000);
    return () => { disposed = true; window.clearInterval(timer); };
  }, [symbol, replayMode]);

  return <section className="bottom-dock">
    <div className="dock-toolbar">
      <Tabs value={activeTab} onValueChange={(value) => setTab(value as typeof tab)}>
        <TabsList className="dock-tabs">
          {/* Each workspace offers only the readouts it can act on.
              Markets = desk, Research = experiments, Backtest = results,
              Replay = session + orders. */}
          {(workspace === "terminal" || workspace === "replay") && <TabsTrigger value="positions"><Wallet size={12} />Positions</TabsTrigger>}
          {(workspace === "terminal" || workspace === "replay") && <TabsTrigger value="orders"><ListChecks size={12} />Orders</TabsTrigger>}
          {workspace === "research" && <TabsTrigger value="backtest"><FileText size={12} />Results</TabsTrigger>}
          {workspace === "research" && <TabsTrigger value="history"><Clock3 size={12} />Experiments</TabsTrigger>}
          {workspace === "research" && <TabsTrigger value="logs"><Boxes size={12} />Execution</TabsTrigger>}
        </TabsList>
      </Tabs>
      <div className="dock-toolbar-right"><span className="dock-mode-dot" />{replayMode ? "REPLAY · ISOLATED ACCOUNT" : "PAPER ACCOUNT"}</div>
    </div>
    <div className="dock-content">
      {activeTab === "positions" && (workspace === "terminal" || workspace === "replay") && (replayMode ? <ReplayPositions session={replaySession} portfolio={replayPortfolio} /> : <PaperPositions key={`${exchange}|${symbol}`} symbol={symbol} exchange={exchange} />)}
      {activeTab === "orders" && (replayMode ? <OrdersTable orders={replayOrders} /> : paperError && !paper ? <div className="empty-state"><AlertCircle size={18} /><strong>Orders unavailable</strong><span>{paperError}</span></div> : <><div className="table-footnote">Paper order history · symbols shown for each order</div><OrdersTable orders={paper?.orders ?? []} /></>)}
      {activeTab === "history" && workspace === "research" && (replayMode ? <div className="empty-state"><AlertCircle size={18} /><strong>Experiment history hidden during replay</strong><span>Backtest results can reveal outcomes beyond the current cursor.</span></div> : <ExperimentHistory onSelect={selectResult} />)}
      {activeTab === "backtest" && workspace === "research" && (replayMode ? <div className="empty-state"><AlertCircle size={18} /><strong>Backtest metrics suppressed</strong><span>Only bars through the replay cursor are visible; future-derived results are hidden.</span></div> : <BacktestView result={result} onOpenStrategy={() => setInspectorTab("strategy")} />)}
      {activeTab === "logs" && workspace === "research" && (replayMode ? <div className="execution-log">
        <div className="log-line"><span className="log-time">REPLAY</span><span className="log-info">FUTURE</span><span>Only completed bars at or before the cursor are loaded.</span></div>
        {replaySession && <div className="log-line"><span className="log-time">{new Date(replaySession.cursor).toLocaleTimeString()}</span><span className="log-success">CURSOR</span><span>{replaySession.symbol} · {replaySession.timeframe} · {replaySession.status}</span></div>}
        {replayOrders.slice(0, 12).map((order) => <div className="log-line" key={order.clientOrderId}><span className="log-time">{new Date(order.createdAt).toLocaleTimeString()}</span><span className="log-success">{order.status.toUpperCase()}</span><span>{order.side.toUpperCase()} {order.quantity} {order.symbol} @ {order.fillPrice ?? "—"}</span></div>)}
      </div> : <div className="execution-log">
        <div className="log-line"><span className="log-time">LOCAL</span><span className="log-info">Safety boundary</span><span>Real trading is disabled; MCP exposes no order execution tool.</span></div>
        <div className="log-line"><span className="log-time">DATA</span><span className="log-info">Market data</span><span>Binance public REST through CCXT; public kline WebSocket in browser.</span></div>
        {paper?.orders.slice(0, 12).map((order) => <div className="log-line" key={order.clientOrderId}><span className="log-time">{new Date(order.createdAt).toLocaleTimeString()}</span><span className={order.status === "filled" ? "log-success" : "log-warn"}>{order.status.toUpperCase()}</span><span>{order.side.toUpperCase()} {order.quantity} {order.symbol} · {order.clientOrderId}</span></div>)}
        {paperError && <div className="log-line"><span className="log-time">WARN</span><span className="log-warn">STALE</span><span>{paperError}</span></div>}
      </div>)}
    </div>
  </section>;
}
