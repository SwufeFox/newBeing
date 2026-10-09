"use client";

import { useEffect, useMemo, useState } from "react";
import { BookOpen, Braces, Check, Clock3, Copy, History, Layers3, Radio, TrendingDown, TrendingUp, Wallet } from "lucide-react";
import type { BacktestResult, OrderPreview, PaperOrder, PaperPortfolio, ReplaySession } from "@newbeing/core";
import type { MarketSummary, OrderBookSnapshot, RecentTrade } from "@newbeing/market-data/types";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { StrategyLab } from "@/components/strategy-lab";
import { useWorkspaceStore } from "@/store/workspace";
import { useShallow } from "zustand/react/shallow";

function price(value: number | null | undefined): string {
  return typeof value === "number" && Number.isFinite(value)
    ? value.toLocaleString("en-US", { minimumFractionDigits: value < 1 ? 4 : 2, maximumFractionDigits: 6 })
    : "—";
}

interface InspectorProps {
  summary: MarketSummary | null;
  result: BacktestResult | null;
  running: boolean;
  replayMode: boolean;
  replaySession: ReplaySession | null;
  replayPortfolio: PaperPortfolio | null;
  replayOrders: PaperOrder[];
  replayBusy: boolean;
  onRun: () => void;
  onReplayOrder: (side: "buy" | "sell", quantity: number) => Promise<void>;
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

function OrderBook({ symbol }: { symbol: string }): React.JSX.Element {
  const [book, setBook] = useState<OrderBookSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let disposed = false;
    const refresh = async (): Promise<void> => {
      try {
        const response = await fetch(`/api/market?kind=book&symbol=${encodeURIComponent(symbol)}`, { cache: "no-store" });
        const payload: unknown = await response.json();
        if (!response.ok) throw new Error("Order book is unavailable.");
        const parsed = parseBook(payload);
        if (!parsed) throw new Error("Invalid order book response.");
        if (!disposed) { setBook(parsed); setError(null); }
      } catch (reason) {
        if (!disposed) setError(reason instanceof Error ? reason.message : "Order book request failed.");
      }
    };
    void refresh();
    const interval = window.setInterval(() => void refresh(), 3_000);
    return () => { disposed = true; window.clearInterval(interval); };
  }, [symbol]);

  const maxSize = Math.max(0.000001, ...(book?.bids.map((level) => level.amount) ?? []), ...(book?.asks.map((level) => level.amount) ?? []));
  return (
    <div className="orderbook-panel">
      <div className="book-columns"><span>PRICE (USDT)</span><span>SIZE</span></div>
      {error && !book && <div className="small-error">{error}</div>}
      {book?.asks.slice(0, 6).reverse().map((level, index) => <div className="book-row ask" key={`ask-${index}`}>
        <span className="depth-bar" style={{ width: `${Math.max(2, (level.amount / maxSize) * 100)}%` }} />
        <span>{price(level.price)}</span><span>{level.amount.toFixed(4)}</span>
      </div>)}
      {book && <div className="book-mid"><span>{price(((book.asks[0]?.price ?? 0) + (book.bids[0]?.price ?? 0)) / 2)}</span><small>SPREAD {book.asks[0] && book.bids[0] ? price(book.asks[0].price - book.bids[0].price) : "—"}</small></div>}
      {book?.bids.slice(0, 6).map((level, index) => <div className="book-row bid" key={`bid-${index}`}>
        <span className="depth-bar" style={{ width: `${Math.max(2, (level.amount / maxSize) * 100)}%` }} />
        <span>{price(level.price)}</span><span>{level.amount.toFixed(4)}</span>
      </div>)}
      {!book && !error && <div className="book-loading">Loading public depth…</div>}
      <div className="data-stamp">Binance public depth snapshot</div>
    </div>
  );
}

function RecentTrades({ symbol }: { symbol: string }): React.JSX.Element {
  const [trades, setTrades] = useState<RecentTrade[]>([]);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let disposed = false;
    const refresh = async (): Promise<void> => {
      try {
        const response = await fetch(`/api/market?kind=trades&symbol=${encodeURIComponent(symbol)}`, { cache: "no-store" });
        const payload: unknown = await response.json();
        if (!response.ok) throw new Error("Recent trades are unavailable.");
        const next = parseTrades(payload);
        if (!disposed) { setTrades(next); setError(null); }
      } catch (reason) {
        if (!disposed) setError(reason instanceof Error ? reason.message : "Recent trade request failed.");
      }
    };
    void refresh();
    const interval = window.setInterval(() => void refresh(), 3_000);
    return () => { disposed = true; window.clearInterval(interval); };
  }, [symbol]);

  return <div className="recent-trades-panel">
    <div className="trades-columns"><span>PRICE</span><span>AMOUNT</span><span>TIME</span></div>
    {error && trades.length === 0 && <div className="small-error">{error}</div>}
    {trades.slice(0, 12).map((trade) => <div className="trade-row" key={trade.id}>
      <span className={trade.side === "buy" ? "positive" : trade.side === "sell" ? "negative" : ""}>{price(trade.price)}</span>
      <span>{trade.amount.toFixed(5)}</span>
      <span>{new Date(trade.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}</span>
    </div>)}
    {trades.length === 0 && !error && <div className="book-loading">Loading latest trades…</div>}
    <div className="data-stamp">Exchange tape · public trades</div>
  </div>;
}

function WorkspaceContext(): React.JSX.Element {
  const state = useWorkspaceStore(useShallow((workspace) => ({
    symbol: workspace.symbol,
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
    exchange: "binance",
    ...state,
    quoteScope: "public market data only; paper portfolio is local; live trading disabled",
  }), [state]);
  const copy = async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(JSON.stringify(context, null, 2));
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      setCopied(false);
    }
  };
  return <div className="context-panel">
    <div className="context-callout"><Braces size={14} /><span>Shared with local MCP</span><span className="live-dot" /></div>
    <div className="context-list">
      <ContextField label="SYMBOL" value={state.symbol} />
      <ContextField label="EXCHANGE" value="Binance Spot" />
      <ContextField label="TIMEFRAME" value={state.timeframe} />
      <ContextField label="WORKSPACE" value={state.activeWorkspace} />
      <ContextField label="STRATEGY" value={state.selectedStrategyId} />
      <ContextField label="MODE" value="Paper · isolated" />
      <ContextField label="BACKTEST" value={state.activeBacktestId ?? "None selected"} />
      <ContextField label="VISIBLE RANGE" value={state.visibleRange.from && state.visibleRange.to
        ? `${new Date(state.visibleRange.from).toISOString().slice(0, 16)} → ${new Date(state.visibleRange.to).toISOString().slice(0, 16)} UTC`
        : "Chart range not pinned"} />
    </div>
    <div className="context-note">The stdio MCP process reads the same SQLite workspace snapshot. No account secrets or API keys are included.</div>
    <Button variant="outline" size="sm" onClick={() => void copy()}>{copied ? <Check size={13} /> : <Copy size={13} />}{copied ? "Copied context" : "Copy context JSON"}</Button>
  </div>;
}

function ContextField({ label, value }: { label: string; value: string }): React.JSX.Element {
  return <div className="context-field"><span>{label}</span><strong>{value}</strong></div>;
}

function PaperTicket({ symbol, summary }: { symbol: string; summary: MarketSummary | null }): React.JSX.Element {
  const [portfolio, setPortfolio] = useState<PaperPortfolio | null>(null);
  const [previews, setPreviews] = useState<OrderPreview[]>([]);
  const [quantity, setQuantity] = useState("0.001");
  const [busy, setBusy] = useState(false);
  const [resolvingPreview, setResolvingPreview] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const mode = useWorkspaceStore((state) => state.mode);
  const number = Number(quantity);
  const referencePrice = summary?.last ?? null;

  useEffect(() => {
    let disposed = false;
    const refresh = async (): Promise<void> => {
      try {
        const response = await fetch(`/api/paper?symbol=${encodeURIComponent(symbol)}`, { cache: "no-store" });
        const payload: unknown = await response.json();
        const parsed = parsePaper(payload);
        if (response.ok && parsed && !disposed) setPortfolio(parsed.portfolio);
        const previewResponse = await fetch(`/api/order-previews?symbol=${encodeURIComponent(symbol)}`, { cache: "no-store" });
        const previewPayload: unknown = await previewResponse.json();
        if (previewResponse.ok && !disposed) setPreviews(parsePreviews(previewPayload).filter((preview) => preview.status === "prepared"));
      } catch {
        if (!disposed) setPortfolio(null);
      }
    };
    void refresh();
    const interval = window.setInterval(() => void refresh(), 8_000);
    return () => { disposed = true; window.clearInterval(interval); };
  }, [symbol, notice]);

  const resolvePreview = async (previewId: string, action: "confirm" | "dismiss"): Promise<void> => {
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
        const message = typeof payload === "object" && payload !== null && "error" in payload && typeof payload.error === "string" ? payload.error : "Preview action failed.";
        throw new Error(message);
      }
      setNotice(action === "confirm" ? "Paper preview confirmed · simulated order recorded" : "Preview dismissed · no order created");
      const refresh = await fetch(`/api/paper?symbol=${encodeURIComponent(symbol)}`, { cache: "no-store" });
      const account = parsePaper(await refresh.json());
      if (refresh.ok && account) setPortfolio(account.portfolio);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Preview action failed.");
    } finally {
      setResolvingPreview(null);
    }
  };

  const submit = async (side: "buy" | "sell"): Promise<void> => {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const clientOrderId = globalThis.crypto?.randomUUID?.() ?? `paper-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
      const response = await fetch("/api/paper", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clientOrderId, symbol, side, quantity: number, mode: "paper" }),
      });
      const payload: unknown = await response.json();
      if (!response.ok && response.status !== 202) {
        const message = typeof payload === "object" && payload !== null && "error" in payload && typeof payload.error === "string" ? payload.error : "Paper order failed.";
        throw new Error(message);
      }
      if (typeof payload === "object" && payload !== null && "portfolio" in payload) {
        const portfolio = (payload as { portfolio?: unknown }).portfolio;
        if (typeof portfolio === "object" && portfolio !== null && "quoteBalance" in portfolio) setPortfolio(portfolio as PaperPortfolio);
      }
      if (response.status === 202) setNotice("State unknown · not retried");
      else setNotice(`${side.toUpperCase()} filled in Paper at a public quote`);
      window.setTimeout(() => setNotice(null), 3_500);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not submit paper order.");
    } finally {
      setBusy(false);
    }
  };

  const estimated = referencePrice !== null && Number.isFinite(number) ? number * referencePrice : null;
  const pnl = portfolio && referencePrice !== null && portfolio.averageEntryPrice !== null
    ? portfolio.baseBalance * (referencePrice - portfolio.averageEntryPrice)
    : 0;

  return <div className="paper-ticket">
    <div className="ticket-heading"><div><Wallet size={13} /><span>SIMULATED ORDER</span></div><span className="paper-chip">PAPER</span></div>
    <div className="account-summary"><span>USDT AVAILABLE</span><strong>{portfolio ? `$${portfolio.quoteBalance.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : "—"}</strong></div>
    <div className="account-summary position"><span>{symbol.split("/")[0]} POSITION</span><strong>{portfolio ? `${portfolio.baseBalance.toFixed(6)} ${symbol.split("/")[0]}` : "—"}</strong><small className={pnl >= 0 ? "positive" : "negative"}>uPnL {pnl >= 0 ? "+" : ""}{pnl.toFixed(2)} USDT</small></div>
    <label className="ticket-field"><span>QUANTITY · {symbol.split("/")[0]}</span><input data-testid="paper-quantity" type="number" min="0" step="0.0001" value={quantity} onChange={(event) => setQuantity(event.target.value)} /></label>
    <div className="ticket-estimate"><span>Est. notional</span><strong>{estimated === null ? "—" : `$${estimated.toLocaleString("en-US", { maximumFractionDigits: 2 })}`}</strong></div>
    <div className="ticket-actions">
      <Button data-testid="paper-buy" variant="primary" size="sm" disabled={busy || !Number.isFinite(number) || number <= 0 || mode !== "paper"} onClick={() => void submit("buy")}><TrendingUp size={13} />Buy</Button>
      <Button variant="danger" size="sm" disabled={busy || !Number.isFinite(number) || number <= 0 || !portfolio || number > portfolio.baseBalance || mode !== "paper"} onClick={() => void submit("sell")}><TrendingDown size={13} />Sell</Button>
    </div>
    {previews.map((preview) => <div className="order-preview-card" key={preview.id}>
      <div className="preview-topline"><span>AI ORDER PREVIEW</span><span className="paper-chip">{preview.status.toUpperCase()}</span></div>
      <strong className={preview.side === "buy" ? "positive" : "negative"}>{preview.side.toUpperCase()} {preview.quantity} {symbol.split("/")[0]}</strong>
      <small>Ref {price(preview.referencePrice)} · est. {price(preview.estimatedNotional)} USDT · fee {price(preview.estimatedFee)}</small>
      <small>Expires {new Date(preview.expiresAt).toLocaleTimeString()}</small>
      <div className="preview-actions"><Button size="sm" variant="primary" disabled={resolvingPreview === preview.id} onClick={() => void resolvePreview(preview.id, "confirm")}>Confirm Paper</Button><Button size="sm" variant="ghost" disabled={resolvingPreview === preview.id} onClick={() => void resolvePreview(preview.id, "dismiss")}>Dismiss</Button></div>
    </div>)}
    {error && <div className="error-inline">{error}</div>}
    {notice && <div className="success-inline">{notice}</div>}
    <div className="ticket-disclaimer">Simulated only · price references public bid/ask or last; no live order endpoint exists.</div>
  </div>;
}

function ReplayTicket({
  symbol,
  session,
  portfolio,
  orders,
  busy,
  onOrder,
}: {
  symbol: string;
  session: ReplaySession | null;
  portfolio: PaperPortfolio | null;
  orders: PaperOrder[];
  busy: boolean;
  onOrder: (side: "buy" | "sell", quantity: number) => Promise<void>;
}): React.JSX.Element {
  const [quantity, setQuantity] = useState("0.001");
  const size = Number(quantity);
  const current = session?.bars.at(-1);
  const unrealized = portfolio && current && portfolio.averageEntryPrice !== null
    ? portfolio.baseBalance * (current.close - portfolio.averageEntryPrice)
    : 0;
  if (!session || !portfolio || !current) {
    return <div className="paper-ticket replay-ticket"><div className="ticket-heading"><div><Clock3 size={13} /><span>REPLAY ACCOUNT</span></div><span className="paper-chip">ISOLATED</span></div><span className="ticket-disclaimer">Start a historical session to create its isolated Paper wallet. No live market quotes are used.</span></div>;
  }
  return <div className="paper-ticket replay-ticket">
    <div className="ticket-heading"><div><Clock3 size={13} /><span>REPLAY SIMULATOR</span></div><span className="paper-chip">{session.status.toUpperCase()}</span></div>
    <div className="account-summary"><span>USDT AVAILABLE</span><strong>${portfolio.quoteBalance.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</strong></div>
    <div className="account-summary position"><span>{symbol.split("/")[0]} POSITION</span><strong>{portfolio.baseBalance.toFixed(6)} {symbol.split("/")[0]}</strong><small className={unrealized >= 0 ? "positive" : "negative"}>uPnL {unrealized >= 0 ? "+" : ""}{unrealized.toFixed(2)} USDT</small></div>
    <div className="ticket-estimate"><span>Current replay close</span><strong>{price(current.close)} USDT</strong></div>
    <label className="ticket-field"><span>QUANTITY · {symbol.split("/")[0]}</span><input type="number" min="0" step="0.0001" value={quantity} onChange={(event) => setQuantity(event.target.value)} /></label>
    <div className="ticket-actions">
      <Button variant="primary" size="sm" disabled={busy || session.status !== "active" || !Number.isFinite(size) || size <= 0} onClick={() => void onOrder("buy", size)}><TrendingUp size={13} />Buy at close</Button>
      <Button variant="danger" size="sm" disabled={busy || session.status !== "active" || !Number.isFinite(size) || size <= 0 || size > portfolio.baseBalance} onClick={() => void onOrder("sell", size)}><TrendingDown size={13} />Sell at close</Button>
    </div>
    {orders.slice(0, 2).map((order) => <div className="success-inline" key={order.clientOrderId}>{order.side.toUpperCase()} {order.quantity} · {order.status} @ {order.fillPrice === null ? "—" : price(order.fillPrice)}</div>)}
    <div className="ticket-disclaimer">Fill uses the current replay bar close; 0.1% fee applies. No current quote, WebSocket, or live order endpoint is used.</div>
  </div>;
}

export function Inspector({ summary, result, running, replayMode, replaySession, replayPortfolio, replayOrders, replayBusy, onRun, onReplayOrder }: InspectorProps): React.JSX.Element {
  const [symbol, tab, setTab] = useWorkspaceStore(useShallow((state) => [state.symbol, state.inspectorTab, state.setInspectorTab]));
  const selectedTab = replayMode ? "context" : tab === "watchlist" ? "book" : tab;
  return <aside className="inspector-panel">
    <Tabs value={selectedTab} onValueChange={(value) => setTab(value as "book" | "trades" | "strategy" | "context")} className="inspector-tabs">
      <TabsList className="inspector-tab-list">
        {!replayMode && <TabsTrigger value="book" aria-label="Order book"><BookOpen size={13} /><span>Book</span></TabsTrigger>}
        {!replayMode && <TabsTrigger value="trades" aria-label="Recent trades"><History size={13} /><span>Trades</span></TabsTrigger>}
        {!replayMode && <TabsTrigger value="strategy" aria-label="Strategy lab"><Layers3 size={13} /><span>Strategy</span></TabsTrigger>}
        <TabsTrigger value="context" aria-label="AI context"><Braces size={13} /><span>AI</span></TabsTrigger>
      </TabsList>
      <TabsContent value="book"><OrderBook symbol={symbol} /></TabsContent>
      <TabsContent value="trades"><RecentTrades symbol={symbol} /></TabsContent>
      <TabsContent value="strategy"><StrategyLab onRun={onRun} running={running} /></TabsContent>
      <TabsContent value="context"><WorkspaceContext /></TabsContent>
    </Tabs>
    {replayMode
      ? <ReplayTicket symbol={symbol} session={replaySession} portfolio={replayPortfolio} orders={replayOrders} busy={replayBusy} onOrder={onReplayOrder} />
      : selectedTab !== "strategy" && <PaperTicket symbol={symbol} summary={summary} />}
  </aside>;
}
