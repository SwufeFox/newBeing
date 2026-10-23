"use client";

import { replayReport, type ReplayExecution, type ReplayOrderInput } from "@newbeing/core";
import { useEffect, useMemo, useState } from "react";
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
import { AkTag, AkNotice, AkField, AkFieldLabel, AkInput, AkSelect, AkCard, AkNum, AkButton } from "@swufefox/ak-ui-react";

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

function OrderBook({ symbol, exchange, onPickPrice }: { symbol: string; exchange: ExchangeId; onPickPrice?: (price: number) => void }): React.JSX.Element {
  const [book, setBook] = useState<OrderBookSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let disposed = false;
    const refresh = async (): Promise<void> => {
      try {
        const response = await fetch(`/api/market?kind=book&exchange=${exchange}&symbol=${encodeURIComponent(symbol)}`, { cache: "no-store" });
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
    const interval = window.setInterval(() => void refresh(), exchange === "binance" ? 3_000 : 15_000);
    return () => { disposed = true; window.clearInterval(interval); };
  }, [symbol, exchange]);

  const maxSize = Math.max(0.000001, ...(book?.bids.map((level) => level.amount) ?? []), ...(book?.asks.map((level) => level.amount) ?? []));
  const quote = symbol.split("/")[1] ?? "USDT";
  const midPrice = book && book.asks[0] && book.bids[0] ? (book.asks[0].price + book.bids[0].price) / 2 : null;
  const spread = book && book.asks[0] && book.bids[0] ? book.asks[0].price - book.bids[0].price : null;

  return (
    <div className="orderbook-panel bg-[var(--ak-surface-canvas)] p-2.5 font-mono text-xs">
      <div className="book-columns flex justify-between text-[10px] text-[var(--ak-text-secondary)] uppercase font-mono pb-1 border-b border-[var(--ak-border-subtle)]">
        <span>PRICE ({quote})</span>
        <span>SIZE</span>
      </div>
      {error && !book && <div className="small-error text-xs text-[var(--ak-signal-danger)] p-1">{error}</div>}

      <div className="asks-ladder py-1 space-y-0.5">
        {book?.asks.slice(0, 7).reverse().map((level, index) => (
          <div
            className="book-row ask relative flex justify-between py-0.5 px-1 hover:bg-red-950/20 cursor-pointer select-none group"
            key={`ask-${index}`}
            onClick={() => onPickPrice?.(level.price)}
            title="Click to copy price to ticket"
          >
            <span
              className="depth-bar absolute right-0 top-0 bottom-0 bg-red-500/15 pointer-events-none transition-all duration-200"
              style={{ width: `${Math.max(2, (level.amount / maxSize) * 100)}%` }}
            />
            <span className="text-[var(--ak-signal-danger)] font-bold group-hover:underline">{price(level.price)}</span>
            <span className="text-[var(--ak-text-secondary)]">{level.amount.toFixed(4)}</span>
          </div>
        ))}
      </div>

      {midPrice !== null && (
        <div className="book-mid my-1 py-1 px-1.5 bg-[var(--ak-surface-sunken)] border-y border-[var(--ak-border-subtle)] flex items-center justify-between">
          <strong className="text-sm font-bold text-[var(--ak-text-primary)]">{price(midPrice)}</strong>
          <span className="book-spread text-[10px] text-[var(--ak-text-secondary)] flex items-center gap-1">
            <em className="not-italic opacity-70">SPREAD</em>
            <b className="text-[var(--ak-signal-action)]">{price(spread)}</b>
          </span>
        </div>
      )}

      <div className="bids-ladder py-1 space-y-0.5">
        {book?.bids.slice(0, 7).map((level, index) => (
          <div
            className="book-row bid relative flex justify-between py-0.5 px-1 hover:bg-emerald-950/20 cursor-pointer select-none group"
            key={`bid-${index}`}
            onClick={() => onPickPrice?.(level.price)}
            title="Click to copy price to ticket"
          >
            <span
              className="depth-bar absolute right-0 top-0 bottom-0 bg-emerald-500/15 pointer-events-none transition-all duration-200"
              style={{ width: `${Math.max(2, (level.amount / maxSize) * 100)}%` }}
            />
            <span className="text-[var(--ak-signal-success)] font-bold group-hover:underline">{price(level.price)}</span>
            <span className="text-[var(--ak-text-secondary)]">{level.amount.toFixed(4)}</span>
          </div>
        ))}
      </div>

      {!book && !error && <div className="book-loading p-4 text-center text-xs text-[var(--ak-text-secondary)]">Loading public depth…</div>}
      <div className="data-stamp text-[9px] text-[var(--ak-text-secondary)] opacity-60 mt-2 text-right">
        {error ? `STALE · ${exchangeLabel(exchange)} public depth` : `${exchangeLabel(exchange)} depth snapshot`}
      </div>
    </div>
  );
}

function RecentTrades({ symbol, exchange, onPickPrice }: { symbol: string; exchange: ExchangeId; onPickPrice?: (price: number) => void }): React.JSX.Element {
  const [trades, setTrades] = useState<RecentTrade[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let disposed = false;
    const refresh = async (): Promise<void> => {
      try {
        const response = await fetch(`/api/market?kind=trades&exchange=${exchange}&symbol=${encodeURIComponent(symbol)}`, { cache: "no-store" });
        const payload: unknown = await response.json();
        if (!response.ok) throw new Error("Recent trades are unavailable.");
        const next = parseTrades(payload);
        if (!disposed) { setTrades(next); setError(null); }
      } catch (reason) {
        if (!disposed) setError(reason instanceof Error ? reason.message : "Recent trade request failed.");
      }
    };
    void refresh();
    const interval = window.setInterval(() => void refresh(), exchange === "binance" ? 3_000 : 15_000);
    return () => { disposed = true; window.clearInterval(interval); };
  }, [symbol, exchange]);

  return (
    <div className="recent-trades-panel bg-[var(--ak-surface-canvas)] p-2.5 font-mono text-xs">
      <div className="trades-columns flex justify-between text-[10px] text-[var(--ak-text-secondary)] uppercase pb-1 border-b border-[var(--ak-border-subtle)]">
        <span>PRICE</span>
        <span>AMOUNT</span>
        <span>TIME</span>
      </div>
      {error && trades.length === 0 && <div className="small-error text-xs text-[var(--ak-signal-danger)] p-1">{error}</div>}

      <div className="trades-list space-y-0.5 py-1">
        {trades.slice(0, 14).map((trade) => {
          const isBuy = trade.side === "buy";
          return (
            <div
              className="trade-row flex justify-between py-0.5 px-1 hover:bg-[var(--ak-surface-sunken)] cursor-pointer select-none group"
              key={trade.id}
              onClick={() => onPickPrice?.(trade.price)}
              title="Click to copy price to ticket"
            >
              <span className={`font-bold group-hover:underline flex items-center gap-1 ${isBuy ? "text-[var(--ak-signal-success)]" : "text-[var(--ak-signal-danger)]"}`}>
                {isBuy ? <ArrowUpRight size={10} /> : <ArrowDownRight size={10} />}
                {price(trade.price)}
              </span>
              <span className="text-[var(--ak-text-secondary)]">{trade.amount.toFixed(4)}</span>
              <span className="text-[10px] text-[var(--ak-text-secondary)] opacity-70">
                {new Date(trade.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
              </span>
            </div>
          );
        })}
      </div>

      {trades.length === 0 && !error && <div className="book-loading p-4 text-center text-xs text-[var(--ak-text-secondary)]">Loading latest trades…</div>}
      <div className="data-stamp text-[9px] text-[var(--ak-text-secondary)] opacity-60 mt-2 text-right">
        {error ? `STALE · ${exchangeLabel(exchange)} public trades` : `${exchangeLabel(exchange)} public stream`}
      </div>
    </div>
  );
}

function WorkspaceContext(): React.JSX.Element {
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

  const copy = async (): Promise<void> => {
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
          <span className="font-bold text-xs tracking-wider">MCP CONTEXT BRIDGE</span>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="w-1.5 h-1.5 rounded-full bg-[var(--ak-signal-info)] animate-pulse" />
          <span className="text-[10px] text-[var(--ak-signal-info)] uppercase">ACTIVE</span>
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
        <summary className="cursor-pointer opacity-70 hover:opacity-100 py-0.5">All context fields</summary>
        <div className="context-list grid grid-cols-2 gap-1.5 p-2 mt-1 bg-[var(--ak-surface-sunken-2)] border border-[var(--ak-border-subtle)]">
          <ContextField label="STRATEGY" value={state.selectedStrategyId} />
          <ContextField label="EXECUTION" value="Paper (Local)" />
          <ContextField label="ACTIVE BACKTEST" value={state.activeBacktestId ? `${state.activeBacktestId.slice(0, 10)}…` : "None"} />
          <ContextField
            label="CHART RANGE"
            value={state.visibleRange.from && state.visibleRange.to
              ? `${new Date(state.visibleRange.from).toISOString().slice(5, 10)} → ${new Date(state.visibleRange.to).toISOString().slice(5, 10)}`
              : "Dynamic"}
          />
        </div>
        <p className="context-note opacity-70 leading-normal mt-1.5 m-0">
          The stdio MCP server reads this live SQLite workspace snapshot. No account credentials or exchange API keys are exposed.
        </p>
      </details>

      <Button
        variant="outline"
        size="sm"
        block
        onClick={() => void copy()}
        icon={copied ? <Check size={13} className="text-[var(--ak-signal-success)]" /> : <Copy size={13} />}
        className="text-xs"
      >
        {copied ? "Copied JSON to clipboard" : "Copy Context JSON"}
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

function PaperTicket({ symbol, summary, prefilledPrice }: { symbol: string; summary: MarketSummary | null; prefilledPrice?: number | null }): React.JSX.Element {
  const exchange = useWorkspaceStore((state) => state.exchange);
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
    const interval = window.setInterval(() => void refresh(), 8_000);
    return () => { disposed = true; window.clearInterval(interval); };
  }, [symbol, notice, exchange]);

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
      setNotice(response.status === 202 ? "Confirmation saved · execution pending" : action === "confirm" ? "Paper preview confirmed · simulated order recorded" : "Preview dismissed");
      const refresh = await fetch(`/api/paper?symbol=${encodeURIComponent(symbol)}&exchange=${exchange}`, { cache: "no-store" });
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
        body: JSON.stringify({ clientOrderId, symbol, side, quantity: number, mode: "paper", exchange }),
      });
      const payload: unknown = await response.json();
      if (!response.ok && response.status !== 202) {
        const message = typeof payload === "object" && payload !== null && "error" in payload && typeof payload.error === "string" ? payload.error : "Paper order failed.";
        throw new Error(message);
      }
      if (typeof payload === "object" && payload !== null && "portfolio" in payload) {
        const p = (payload as { portfolio?: unknown }).portfolio;
        if (typeof p === "object" && p !== null && "quoteBalance" in p) setPortfolio(p as PaperPortfolio);
      }
      const savedOrder = typeof payload === "object" && payload !== null && "order" in payload ? payload.order as PaperOrder : null;
      if (savedOrder?.status === "filled") setNotice(`${side.toUpperCase()} filled in Paper at a public quote`);
      else if (savedOrder?.status === "cancelled") setNotice("Paper order cancelled");
      else setNotice(`Saved Paper status: ${savedOrder?.status ?? "unavailable"}`);
      window.setTimeout(() => setNotice(null), 3_500);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not submit paper order.");
    } finally {
      setBusy(false);
    }
  };

  // Quick percentage calculators for supreme tactile feel
  const applyPercent = (pct: number, side: "buy" | "sell"): void => {
    if (!portfolio || !referencePrice) return;
    if (side === "buy") {
      const avail = portfolio.quoteBalance * pct;
      const computed = avail / referencePrice;
      setQuantity(Math.max(0.0001, Number(computed.toFixed(4))).toString());
    } else {
      const computed = portfolio.baseBalance * pct;
      setQuantity(Math.max(0.0001, Number(computed.toFixed(4))).toString());
    }
  };

  const activePortfolio = portfolio;
  const activePreviews = previews;
  const estimated = referencePrice !== null && Number.isFinite(number) ? number * referencePrice : null;
  const pnl = activePortfolio && referencePrice !== null && activePortfolio.averageEntryPrice !== null
    ? activePortfolio.baseBalance * (referencePrice - activePortfolio.averageEntryPrice)
    : 0;

  return (
    <div className="paper-ticket p-3 bg-[var(--ak-surface-canvas)] space-y-2.5 font-mono text-xs border-t border-[var(--ak-border-subtle)]">
      <div className="ticket-heading flex items-center justify-between pb-1 border-b border-[var(--ak-border-subtle)]">
        <div className="flex items-center gap-1.5">
          <Wallet size={13} className="text-[var(--ak-signal-action)]" />
          <span className="font-bold text-xs tracking-wider">PAPER EXECUTION TICKET</span>
        </div>
        <AkTag variant="advanced" className="text-[10px]">SIMULATED</AkTag>
      </div>

      <div className="grid grid-cols-2 gap-2 bg-[var(--ak-surface-sunken)] p-2 border border-[var(--ak-border-subtle)]">
        <div className="flex flex-col">
          <span className="text-[9px] text-[var(--ak-text-secondary)] uppercase">{quote} AVAILABLE</span>
          <strong className="text-xs text-[var(--ak-text-primary)] font-bold">
            {activePortfolio ? `$${activePortfolio.quoteBalance.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : "—"}
          </strong>
        </div>
        <div className="flex flex-col">
          <span className="text-[9px] text-[var(--ak-text-secondary)] uppercase">{base} POSITION</span>
          <strong className="text-xs text-[var(--ak-text-primary)] font-bold">
            {activePortfolio ? `${activePortfolio.baseBalance.toFixed(5)} ${base}` : "—"}
          </strong>
          <small className={`text-[10px] font-bold ${pnl >= 0 ? "text-[var(--ak-signal-success)]" : "text-[var(--ak-signal-danger)]"}`}>
            uPnL {pnl >= 0 ? "+" : ""}{pnl.toFixed(2)} {quote}
          </small>
        </div>
      </div>

      <div className="ticket-field flex flex-col gap-1">
        <div className="flex items-center justify-between">
          <label htmlFor="paper-qty" className="text-[10px] font-bold text-[var(--ak-text-secondary)] uppercase tracking-wider">
            QUANTITY · {base}
          </label>
          <div className="flex items-center gap-1">
            {([0.25, 0.5, 0.75, 1] as const).map((pct) => (
              <button
                key={pct}
                type="button"
                onClick={() => applyPercent(pct, "buy")}
                className="text-[9px] px-1.5 py-0.5 bg-[var(--ak-surface-sunken-2)] border border-[var(--ak-border-subtle)] text-[var(--ak-text-secondary)] hover:text-[var(--ak-text-primary)] hover:border-[var(--ak-signal-info)] transition-colors"
                title={`Set ${pct * 100}% of available`}
              >
                {pct === 1 ? "MAX" : `${pct * 100}%`}
              </button>
            ))}
          </div>
        </div>
        <AkInput
          id="paper-qty"
          data-testid="paper-quantity"
          aria-label={`QUANTITY · ${base}`}
          type="number"
          min="0"
          step="0.0001"
          value={quantity}
          onChange={(event) => setQuantity(event.target.value)}
          className="h-8 text-xs font-mono"
        />
      </div>

      <div className="ticket-estimate flex items-center justify-between p-1.5 bg-[var(--ak-surface-sunken)] border border-[var(--ak-border-subtle)]">
        <span className="text-[10px] text-[var(--ak-text-secondary)] uppercase">ESTIMATED NOTIONAL</span>
        <strong className="text-xs text-[var(--ak-text-primary)] font-bold">
          {estimated === null ? "—" : `$${estimated.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${quote}`}
        </strong>
      </div>

      <div className="ticket-actions grid grid-cols-2 gap-2 pt-1">
        <Button
          data-testid="paper-buy"
          variant="primary"
          size="sm"
          disabled={busy || !Number.isFinite(number) || number <= 0 || mode !== "paper"}
          onClick={() => void submit("buy")}
          icon={<TrendingUp size={13} />}
          className="h-8 font-bold text-xs"
        >
          Buy
        </Button>
        <Button
          variant="danger"
          size="sm"
          disabled={busy || !Number.isFinite(number) || number <= 0 || !activePortfolio || number > activePortfolio.baseBalance || mode !== "paper"}
          onClick={() => void submit("sell")}
          icon={<TrendingDown size={13} />}
          className="h-8 font-bold text-xs"
        >
          Sell
        </Button>
      </div>

      <PaperRecoveryPanel />

      {activePreviews.map((preview) => (
        <div className="order-preview-card p-2 bg-[var(--ak-surface-sunken-2)] border-l-2 border-[var(--ak-signal-action)] space-y-1.5" key={preview.id}>
          <div className="preview-topline flex items-center justify-between">
            <span className="text-[10px] font-bold text-[var(--ak-signal-info)]">AI ORDER PREVIEW</span>
            <AkTag variant="advanced" className="text-[9px]">{preview.status.toUpperCase()}</AkTag>
          </div>
          <strong className={`block text-xs font-bold ${preview.side === "buy" ? "text-[var(--ak-signal-success)]" : "text-[var(--ak-signal-danger)]"}`}>
            {preview.side.toUpperCase()} {preview.quantity} {base}
          </strong>
          <div className="text-[10px] text-[var(--ak-text-secondary)] space-y-0.5">
            <div>Ref {price(preview.referencePrice)} · Est {price(preview.estimatedNotional)} {quote} · Fee {price(preview.estimatedFee)}</div>
            <div>Expires: {new Date(preview.expiresAt).toLocaleTimeString()}</div>
          </div>
          <div className="preview-actions flex gap-2 pt-1">
            <Button size="sm" variant="primary" className="h-6 text-[10px]" disabled={resolvingPreview === preview.id} onClick={() => void resolvePreview(preview.id, "confirm")}>
              Confirm Paper
            </Button>
            <Button size="sm" variant="ghost" className="h-6 text-[10px]" disabled={resolvingPreview === preview.id} onClick={() => void resolvePreview(preview.id, "dismiss")}>
              Dismiss
            </Button>
          </div>
        </div>
      ))}

      {error && <div className="error-inline text-xs text-[var(--ak-signal-danger)] p-1.5 bg-red-950/20 border border-red-800/40">{error}</div>}
      {notice && <div className="success-inline text-xs text-[var(--ak-signal-success)] p-1.5 bg-emerald-950/20 border border-emerald-800/40">{notice}</div>}
      <div className="ticket-disclaimer text-[9px] text-[var(--ak-text-secondary)] opacity-60 leading-tight">
        Simulated execution only · price references real public bid/ask quotes; no live capital is at risk.
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
  onCommand,
}: {
  execution: ReplayExecution | null;
  onCommand: (command: Record<string, unknown>) => Promise<void>;
  symbol: string;
  session: ReplaySession | null;
  portfolio: PaperPortfolio | null;
  orders: PaperOrder[];
  busy: boolean;
  onOrder: (side: "buy" | "sell", quantity: number, options?: Partial<ReplayOrderInput>) => Promise<void>;
}): React.JSX.Element {
  const [quantity, setQuantity] = useState("0.001");
  const [orderType, setOrderType] = useState<ReplayOrderInput["type"]>("market");
  const [trigger, setTrigger] = useState("");
  const [stopLoss, setStopLoss] = useState("");
  const [takeProfit, setTakeProfit] = useState("");
  const [notes, setNotes] = useState(execution?.notes ?? "");
  const [tags, setTags] = useState(execution?.tags.join(", ") ?? "");

  const submit = (side: "buy" | "sell"): void => {
    void onOrder(side, Number(quantity), {
      type: orderType,
      ...(orderType !== "market" ? { price: Number(trigger) } : {}),
      ...(side === "buy" && stopLoss ? { stopLoss: Number(stopLoss) } : {}),
      ...(side === "buy" && takeProfit ? { takeProfit: Number(takeProfit) } : {}),
    }).catch(() => undefined);
  };

  const size = Number(quantity);
  const current = session?.bars.at(-1);
  const unrealized = portfolio && current && portfolio.averageEntryPrice !== null
    ? portfolio.baseBalance * (current.close - portfolio.averageEntryPrice)
    : 0;
  const quote = symbol.split("/")[1] ?? "USDT";
  const base = symbol.split("/")[0] ?? "BTC";

  if (!session || !portfolio || !current) {
    return (
      <div className="paper-ticket replay-ticket p-4 bg-[var(--ak-surface-canvas)] font-mono text-xs space-y-2">
        <div className="ticket-heading flex items-center justify-between pb-1 border-b border-[var(--ak-border-subtle)]">
          <div className="flex items-center gap-1.5">
            <Clock3 size={13} className="text-[var(--ak-signal-info)]" />
            <span className="font-bold">REPLAY ACCOUNT</span>
          </div>
          <AkTag variant="advanced" className="text-[10px]">ISOLATED</AkTag>
        </div>
        <span className="ticket-disclaimer text-[11px] text-[var(--ak-text-secondary)] opacity-80 block">
          Start a historical session to create its isolated Paper wallet. No live market quotes are used.
        </span>
      </div>
    );
  }

  const report = execution ? replayReport(execution, current.close) : null;
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
          <span className="font-bold">REPLAY SIMULATOR</span>
        </div>
        <AkTag variant={session.status === "active" ? "default" : "neutral"} className="text-[10px]">
          {session.status.toUpperCase()}
        </AkTag>
      </div>

      <div className="grid grid-cols-2 gap-2 bg-[var(--ak-surface-sunken)] p-2 border border-[var(--ak-border-subtle)]">
        <div className="flex flex-col">
          <span className="text-[9px] text-[var(--ak-text-secondary)] uppercase">{quote} AVAILABLE</span>
          <strong className="text-xs text-[var(--ak-text-primary)] font-bold">
            ${portfolio.quoteBalance.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </strong>
        </div>
        <div className="flex flex-col">
          <span className="text-[9px] text-[var(--ak-text-secondary)] uppercase">{base} POSITION</span>
          <strong className="text-xs text-[var(--ak-text-primary)] font-bold">
            {portfolio.baseBalance.toFixed(6)} {base}
          </strong>
          <small className={`text-[10px] font-bold ${unrealized >= 0 ? "text-[var(--ak-signal-success)]" : "text-[var(--ak-signal-danger)]"}`}>
            uPnL {unrealized >= 0 ? "+" : ""}{unrealized.toFixed(2)} {quote}
          </small>
        </div>
      </div>

      <div className="ticket-estimate flex items-center justify-between p-1.5 bg-[var(--ak-surface-sunken)] border border-[var(--ak-border-subtle)]">
        <span className="text-[10px] text-[var(--ak-text-secondary)] uppercase">CURSOR CLOSE PRICE</span>
        <strong className="text-xs text-[var(--ak-text-primary)] font-bold">{price(current.close)} {quote}</strong>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <label className="ticket-field flex flex-col gap-1">
          <span className="text-[10px] font-bold text-[var(--ak-text-secondary)] uppercase">ORDER TYPE</span>
          <AkSelect
            aria-label="Replay order type"
            value={orderType}
            onChange={(event) => setOrderType(event.target.value as ReplayOrderInput["type"])}
            className="h-7 text-xs font-bold"
          >
            <option value="market">Market</option>
            <option value="limit">Limit</option>
            <option value="stop">Stop</option>
          </AkSelect>
        </label>
        <label className="ticket-field flex flex-col gap-1">
          <span className="text-[10px] font-bold text-[var(--ak-text-secondary)] uppercase">QUANTITY · {base}</span>
          <AkInput
            type="number"
            aria-label={`QUANTITY · ${base}`}
            min="0"
            step="0.0001"
            value={quantity}
            onChange={(event) => setQuantity(event.target.value)}
            className="h-7 text-xs font-mono"
          />
        </label>
      </div>

      {orderType !== "market" && (
        <label className="ticket-field flex flex-col gap-1">
          <span className="text-[10px] font-bold text-[var(--ak-text-secondary)] uppercase">LIMIT / STOP PRICE · {quote}</span>
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
          <span className="text-[10px] text-[var(--ak-text-secondary)] uppercase">STOP LOSS (OPT)</span>
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
          <span className="text-[10px] text-[var(--ak-text-secondary)] uppercase">TAKE PROFIT (OPT)</span>
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
          disabled={busy || session.status !== "active" || !Number.isFinite(size) || size <= 0}
          onClick={() => submit("buy")}
          icon={<TrendingUp size={13} />}
          className="h-8 font-bold text-xs"
        >
          Queue buy
        </Button>
        <Button
          variant="danger"
          size="sm"
          disabled={busy || session.status !== "active" || !Number.isFinite(size) || size <= 0 || size > portfolio.baseBalance}
          onClick={() => submit("sell")}
          icon={<TrendingDown size={13} />}
          className="h-8 font-bold text-xs"
        >
          Queue sell
        </Button>
      </div>

      {orders.length > 0 && (
        <div className="space-y-1 max-h-32 overflow-auto p-1 bg-[var(--ak-surface-sunken-2)] border border-[var(--ak-border-subtle)]">
          {orders.slice().reverse().map((order) => (
            <div className="flex items-center justify-between p-1 text-[10px] border-b border-[var(--ak-border-subtle)]" key={order.clientOrderId}>
              <span className={`font-bold ${order.side === "buy" ? "text-[var(--ak-signal-success)]" : "text-[var(--ak-signal-danger)]"}`}>
                {order.side.toUpperCase()} {order.quantity} · {order.status}
              </span>
              <span className="text-[var(--ak-text-secondary)]">{order.fillPrice === null ? "—" : price(order.fillPrice)}</span>
              {order.status === "submitted" && (
                <Button size="sm" variant="ghost" className="h-5 text-[9px] px-1" disabled={busy} onClick={() => void onCommand({ action: "cancel", clientOrderId: order.clientOrderId }).catch(() => undefined)}>
                  Cancel
                </Button>
              )}
            </div>
          ))}
        </div>
      )}

      <div className="space-y-1.5 pt-1 border-t border-[var(--ak-border-subtle)]">
        <label className="ticket-field flex flex-col gap-1">
          <span className="text-[10px] font-bold text-[var(--ak-text-secondary)] uppercase">SESSION NOTES</span>
          <textarea
            aria-label="SESSION NOTES"
            value={notes}
            maxLength={20_000}
            onChange={(event) => setNotes(event.target.value)}
            className="p-1.5 bg-[var(--ak-surface-sunken)] border border-[var(--ak-border)] text-xs font-mono outline-none h-14 resize-none"
            placeholder="Record your entry reasoning..."
          />
        </label>
        <label className="ticket-field flex flex-col gap-1">
          <span className="text-[10px] font-bold text-[var(--ak-text-secondary)] uppercase">TAGS · COMMA SEPARATED</span>
          <AkInput
            aria-label="TAGS · COMMA SEPARATED"
            value={tags}
            onChange={(event) => setTags(event.target.value)}
            className="h-7 text-xs font-mono"
            placeholder="breakout, trend-following"
          />
        </label>
        <div className="flex gap-2">
          <Button size="sm" variant="subtle" className="flex-1 h-7 text-xs" disabled={busy} onClick={() => void onCommand({ action: "journal", notes, tags: tags.split(",").map((tag) => tag.trim()).filter(Boolean) }).catch(() => undefined)}>
            Save notes / tags
          </Button>
          <Button size="sm" variant="outline" className="flex-1 h-7 text-xs" disabled={busy || !execution} onClick={exportJournal}>
            Export journal JSON
          </Button>
        </div>
      </div>

      {report && (
        <div className="ticket-disclaimer text-[10px] text-[var(--ak-text-secondary)] p-1.5 bg-[var(--ak-surface-sunken)] border border-[var(--ak-border-subtle)]">
          Equity: {price(report.equity)} {quote} · Net PnL: {price(report.netPnl)} · {report.fillCount} fills · Max DD: {(report.maxDrawdown * 100).toFixed(2)}%
        </div>
      )}
    </div>
  );
}

export function Inspector({ workspace = "terminal", summary, result, running, replayMode, replaySession, replayPortfolio, replayOrders, replayExecution, onReplayCommand, replayBusy, onRun, onReplayOrder }: InspectorProps): React.JSX.Element {
  const [paperMode, setPaperMode] = useState<"legacy" | "shared-spot">("legacy");
  const [symbol, exchange, tab, setTab] = useWorkspaceStore(useShallow((state) => [state.symbol, state.exchange, state.inspectorTab, state.setInspectorTab]));

  const tabsForWorkspace =
    workspace === "terminal" ? (["book", "trades", "strategy", "context"] as const)
      : workspace === "research" ? (["book", "trades", "strategy", "context"] as const)
        : (["context"] as const);
  const offered = (replayMode ? (["context"] as const) : tabsForWorkspace) as readonly string[];
  const selectedTab: string = offered.includes(tab) ? tab : (offered[0] ?? "context");

  return (
    <aside className="inspector-panel flex flex-col h-full bg-[var(--ak-surface-canvas)] border-l border-[var(--ak-border-strong)]">
      <Tabs value={selectedTab} onValueChange={(value) => setTab(value as "book" | "trades" | "strategy" | "context")} className="inspector-tabs flex-1 flex flex-col min-h-0">
        <TabsList className="inspector-tab-list flex border-b border-[var(--ak-border-strong)] bg-[var(--ak-surface-sunken)]">
          {offered.includes("book") && (
            <TabsTrigger value="book" aria-label="Order book" className="flex-1 py-2 text-xs font-bold tracking-wider uppercase">
              <BookOpen size={13} className="mr-1 text-[var(--ak-signal-info)]" />
              <span>Book</span>
            </TabsTrigger>
          )}
          {offered.includes("trades") && (
            <TabsTrigger value="trades" aria-label="Recent trades" className="flex-1 py-2 text-xs font-bold tracking-wider uppercase">
              <History size={13} className="mr-1 text-[var(--ak-signal-action)]" />
              <span>Trades</span>
            </TabsTrigger>
          )}
          {offered.includes("strategy") && (
            <TabsTrigger value="strategy" aria-label="Strategy lab" className="flex-1 py-2 text-xs font-bold tracking-wider uppercase">
              <Layers3 size={13} className="mr-1 text-[var(--ak-signal-info)]" />
              <span>Strategy</span>
            </TabsTrigger>
          )}
          {offered.includes("context") && (
            <TabsTrigger value="context" aria-label="AI context" className="flex-1 py-2 text-xs font-bold tracking-wider uppercase">
              <Braces size={13} className="mr-1 text-[var(--ak-signal-info)]" />
              <span>AI</span>
            </TabsTrigger>
          )}
        </TabsList>

        <div className="flex-1 overflow-auto min-h-0">
          <TabsContent value="book"><OrderBook key={`${exchange}|${symbol}`} symbol={symbol} exchange={exchange} /></TabsContent>
          <TabsContent value="trades"><RecentTrades key={`${exchange}|${symbol}`} symbol={symbol} exchange={exchange} /></TabsContent>
          <TabsContent value="strategy"><StrategyLab onRun={onRun} running={running} /></TabsContent>
          <TabsContent value="context"><WorkspaceContext /></TabsContent>
        </div>
      </Tabs>

      {replayMode ? (
        <ReplayTicket
          key={replaySession?.id ?? "empty"}
          execution={replayExecution}
          onCommand={onReplayCommand}
          symbol={symbol}
          session={replaySession}
          portfolio={replayPortfolio}
          orders={replayOrders}
          busy={replayBusy}
          onOrder={onReplayOrder}
        />
      ) : (
        selectedTab !== "strategy" && <div className="max-h-[55vh] overflow-auto">
          <label className="flex flex-col p-2 text-xs">Paper account mode<AkSelect aria-label="Paper account mode" value={paperMode} onChange={(event) => setPaperMode(event.target.value as "legacy" | "shared-spot")}><option value="legacy">Legacy pair wallet</option><option value="shared-spot">New shared spot wallet</option></AkSelect></label>
          {paperMode === "shared-spot" ? <SharedSpotTicket key={`${exchange}|${symbol}`} exchange={exchange} symbol={symbol} referencePrice={summary?.ask ?? summary?.last ?? null} /> : <PaperTicket key={`${exchange}|${symbol}`} symbol={symbol} summary={summary} />}
        </div>
      )}
    </aside>
  );
}
