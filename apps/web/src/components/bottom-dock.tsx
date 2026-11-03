"use client";

import { memo, useCallback, useEffect, useRef, useState } from "react";
import { AreaSeries, ColorType, createChart, type UTCTimestamp } from "lightweight-charts";
import { AlertCircle, ArrowDownRight, ArrowUpRight, Boxes, Clock3, FileText, FlaskConical, ListChecks, RotateCcw, ScanSearch, Wallet, Filter } from "lucide-react";
import { STRATEGIES, type BacktestResult, type ExchangeId, type PaperOrder, type PaperPortfolio, type ReplaySession } from "@newbeing/core";
import type { ExperimentSummary } from "@newbeing/storage";
import { SweepPanel } from "@/components/sweep-panel";
import { EvaluationPanel } from "@/components/evaluation-panel";
import { Button } from "@/components/ui/button";
import { EXCHANGE_LABELS } from "@/lib/exchanges";
import { captureWorkspaceSelection } from "@/lib/workspace-selection";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useShallow } from "zustand/react/shallow";
import { useWorkspaceStore } from "@/store/workspace";
import { AkTag, AkNotice, AkNum, AkButton, AkGauge, AkProgress, AkSpinner, AkCountUp } from "@swufefox/ak-ui-react";

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
        if (!accountResponse.ok || typeof account !== "object" || account === null || !("portfolio" in account) || !("orders" in account)) throw new Error("Paper account unavailable.");
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
        <div className="overflow-auto border border-[var(--ak-border-subtle)] opacity-50 animate-pulse">
          <table className="data-table w-full text-left">
            <thead>
              <tr className="bg-[var(--ak-surface-sunken)] border-b border-[var(--ak-border-subtle)] text-[10px] text-[var(--ak-text-secondary)] uppercase">
                <th className="p-2">ASSET</th>
                <th className="p-2">SIZE</th>
                <th className="p-2">AVG ENTRY</th>
                <th className="p-2">MARK PRICE</th>
                <th className="p-2">UNREALIZED PNL</th>
                <th className="p-2">REALIZED PNL</th>
                <th className="p-2">AVAILABLE</th>
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
        const responseError = response.ok ? null : responseErrorMessage ?? `Paper close returned HTTP ${response.status} after the order filled.`;
        setCloseError(responseError);
        const refreshResponse = await fetch(`/api/paper?symbol=${encodeURIComponent(symbol)}&exchange=${exchange}`, { cache: "no-store" });
        const account: unknown = await refreshResponse.json();
        if (refreshResponse.ok && typeof account === "object" && account !== null && "portfolio" in account && "orders" in account) {
          setPayload(account as PaperPayload);
          setCloseNeedsRefresh(false);
          setCloseError(responseError);
        } else {
          setCloseError(responseErrorMessage
            ? `${responseErrorMessage} Refreshed order history is unavailable; the confirmed portfolio is shown.`
            : "Paper close filled, but refreshed order history is unavailable. The confirmed portfolio is shown; check order history before continuing.");
        }
        return;
      }
      const status = savedOrder?.status;
      const statusMessage = status === "created" || status === "submitted" || status === "unknown"
        ? `Paper close order is ${status}. Inspect its saved status before retrying.`
        : status
          ? `Paper close order is ${status}. The latest account and order state is shown.`
          : "Paper close outcome is unknown. Refresh account state before retrying.";
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
        setCloseError("Paper close filled, but refreshed order history could not be loaded. The confirmed portfolio is shown.");
      } else {
        setCloseNeedsRefresh(true);
        setCloseError(reason instanceof Error
          ? `Paper close outcome could not be confirmed: ${reason.message}. Refresh account state before another close.`
          : "Paper close outcome could not be confirmed. Refresh account state before another close.");
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
      {stale && <div className="table-footnote text-xs text-[var(--ak-signal-action)] mb-2">STALE · Showing last account snapshot; mark price may be delayed.</div>}
      {closeError && <div role="alert" className="error-inline text-xs text-[var(--ak-signal-danger)] mb-2">{closeError}</div>}
      {(closeNeedsRefresh || hasUnresolvedPaperOrder) && <div role="status" className="table-footnote text-xs text-[var(--ak-signal-action)] mb-2">Refresh the account or resolve its pending Paper order before another close.</div>}
      <div className="overflow-auto border border-[var(--ak-border-subtle)] shadow-sm">
        <table className="data-table w-full text-left">
          <thead>
            <tr className="bg-[var(--ak-surface-sunken)] border-b border-[var(--ak-border-subtle)] text-[10px] text-[var(--ak-text-secondary)] uppercase">
              <th className="p-2">ASSET</th>
              <th className="p-2">SIZE</th>
              <th className="p-2">AVG ENTRY</th>
              <th className="p-2">MARK PRICE</th>
              <th className="p-2">UNREALIZED PNL</th>
              <th className="p-2">REALIZED PNL</th>
              <th className="p-2">AVAILABLE</th>
              <th className="p-2 text-right">ACTION</th>
            </tr>
          </thead>
          <tbody>
            <tr className="border-b border-[var(--ak-border-subtle)] hover:bg-[var(--ak-surface-sunken)] transition-colors">
              <td className="p-2 font-bold flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => useWorkspaceStore.getState().setSymbol(symbol)}
                  className="hover:text-[var(--ak-signal-info)] hover:underline inline-flex items-center gap-1 cursor-pointer transition-colors text-left"
                  title={`Select ${symbol}`}
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
                    title={hasUnresolvedPaperOrder ? "Resolve the pending Paper order before another close." : closeNeedsRefresh ? "Wait for a fresh Paper account snapshot before retrying." : "Liquidate/close position at market"}
                  >
                    {closing ? "Closing…" : hasUnresolvedPaperOrder ? "Order pending" : closeNeedsRefresh ? "Refresh required" : "Close"}
                  </Button>
                ) : (
                  <span className="text-[10px] text-[var(--ak-text-secondary)] opacity-40">—</span>
                )}
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      {portfolio.baseBalance === 0 && <div className="table-footnote text-[10px] text-[var(--ak-text-secondary)] mt-2 opacity-70">No open Paper position for {symbol.split("/")[0]}.</div>}
    </div>
  );
}

function ReplayPositions({ session, portfolio }: { session: ReplaySession | null; portfolio: PaperPortfolio | null }): React.JSX.Element {
  if (!session || !portfolio) return <div className="empty-state p-6 text-center text-xs text-[var(--ak-text-secondary)]"><Wallet size={18} className="mx-auto mb-2 text-[var(--ak-signal-info)]" /><strong>No replay account loaded</strong><span>Start a historical replay to create its isolated account.</span></div>;
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
              <th className="p-2">ASSET</th>
              <th className="p-2">SIZE</th>
              <th className="p-2">AVG ENTRY</th>
              <th className="p-2">REPLAY CLOSE</th>
              <th className="p-2">UNREALIZED PNL</th>
              <th className="p-2">REALIZED PNL</th>
              <th className="p-2">AVAILABLE</th>
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
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const copyId = (id: string): void => {
    void navigator.clipboard.writeText(id);
    setCopiedId(id);
    window.setTimeout(() => setCopiedId(null), 1500);
  };

  if (orders.length === 0) return <div className="empty-state p-6 text-center text-xs text-[var(--ak-text-secondary)]"><ListChecks size={18} className="mx-auto mb-2 text-[var(--ak-signal-info)]" /><strong>No simulated orders yet</strong><span>Paper orders will appear here with their client IDs and state.</span></div>;

  return (
    <div className="table-scroll overflow-auto max-h-72 p-2 font-mono text-xs">
      <div className="overflow-auto border border-[var(--ak-border-subtle)] shadow-sm">
        <table className="data-table w-full text-left">
        <thead>
          <tr className="bg-[var(--ak-surface-sunken)] border-b border-[var(--ak-border-subtle)] text-[10px] text-[var(--ak-text-secondary)] uppercase">
            <th className="p-2">TIME</th>
            <th className="p-2">SYMBOL</th>
            <th className="p-2">SIDE</th>
            <th className="p-2">QUANTITY</th>
            <th className="p-2">STATUS</th>
            <th className="p-2">FILL PRICE</th>
            <th className="p-2">CLIENT ORDER ID</th>
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
                    title={`Select ${order.symbol}`}
                  >
                    {order.symbol}
                  </button>
                </td>
                <td className="p-2">
                  <AkTag variant={isBuy ? "default" : "danger"} className="text-[10px] px-1.5 py-0">
                    {order.side.toUpperCase()}
                  </AkTag>
                </td>
                <td className="p-2 font-mono tabular-nums">{order.quantity}</td>
                <td className="p-2">
                  <span className={`status-pill status-${order.status} uppercase font-bold text-[10px]`}>{order.status}</span>
                </td>
                <td className="p-2 font-mono tabular-nums">{order.fillPrice?.toLocaleString(undefined, { maximumFractionDigits: 6 }) ?? "—"}</td>
                <td className="p-2 mono text-[10px] text-[var(--ak-text-secondary)]">
                  <button
                    type="button"
                    onClick={() => copyId(order.clientOrderId)}
                    className="hover:text-[var(--ak-text-primary)] hover:underline inline-flex items-center gap-1 cursor-pointer font-mono text-left"
                    title="Click to copy order ID"
                  >
                    <span>{order.clientOrderId}</span>
                    {copiedId === order.clientOrderId && (
                      <span className="text-[9px] text-[var(--ak-signal-success)] font-bold">COPIED</span>
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
  const [filter, setFilter] = useState<"all" | "long" | "short" | "win" | "loss">("all");
  const [rerunning, setRerunning] = useState(false);
  const [rerunError, setRerunError] = useState<{ resultId: string; message: string } | null>(null);
  const setBacktest = useWorkspaceStore((state) => state.setBacktest);

  if (!result) {
    return (
      <div className="empty-state p-8 text-center text-xs text-[var(--ak-text-secondary)] space-y-2">
        <FileText size={22} className="mx-auto text-[var(--ak-signal-action)]" />
        <strong className="block text-sm text-[var(--ak-text-primary)]">No backtest selected</strong>
        <p className="max-w-md mx-auto opacity-80 leading-relaxed">
          Configure a strategy in the Strategy Lab, then execute a deterministic historical run on any supported venue.
        </p>
        <Button variant="outline" size="sm" onClick={onOpenStrategy} className="mt-2 text-xs">
          Open Strategy Lab
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
          : `Backtest rerun failed (${response.status}).`;
        throw new Error(message);
      }
      if (typeof payload !== "object" || payload === null || !("resultId" in payload) || typeof payload.resultId !== "string") {
        throw new Error("Backtest rerun returned an invalid result.");
      }
      if (isCurrent()) setBacktest(payload as BacktestResult);
    } catch (reason) {
      if (isCurrent()) setRerunError({ resultId: result.resultId, message: reason instanceof Error ? reason.message : "Backtest rerun failed." });
    } finally {
      setRerunning(false);
    }
  };

  return (
    <div className="backtest-view p-3 bg-[var(--ak-surface-canvas)] font-mono text-xs space-y-3">
      <div className="backtest-summary-row grid grid-cols-1 lg:grid-cols-4 gap-3">
        <div className="metric-strip lg:col-span-2 grid grid-cols-2 sm:grid-cols-3 gap-2 bg-[var(--ak-surface-sunken)] p-2.5 border border-[var(--ak-border-subtle)]">
          <Metric label="TOTAL RETURN" value={percentage(metric.totalReturn)} tone={metric.totalReturn >= 0 ? "positive" : "negative"} />
          <Metric label="MAX DRAWDOWN" value={percentage(-metric.maxDrawdown)} tone="negative" />
          <Metric
            label="SHARPE RATIO"
            value={metric.sharpeRatio?.toFixed(2) ?? "—"}
            tone={metric.sharpeRatio != null ? (metric.sharpeRatio >= 1 ? "positive" : metric.sharpeRatio < 0 ? "negative" : undefined) : undefined}
            title={result.execution?.sharpeMethod}
          />
          <Metric label="WIN RATE" value={percentage(metric.winRate)} tone={metric.winRate >= 0.5 ? "positive" : "negative"} />
          <Metric
            label="PROFIT FACTOR"
            value={metric.profitFactor?.toFixed(2) ?? "—"}
            tone={metric.profitFactor != null ? (metric.profitFactor >= 1.5 ? "positive" : metric.profitFactor < 1 ? "negative" : undefined) : undefined}
          />
          <Metric label="TOTAL TRADES" value={String(metric.tradeCount)} />
        </div>
        <div className="gauge-card hidden sm:flex flex-col items-center justify-center p-2 bg-[var(--ak-surface-sunken)] border border-[var(--ak-border-subtle)]">
          <AkGauge
            value={Math.round(metric.winRate * 100)}
            max={100}
            label="WIN RATE"
            unit="%"
            size="sm"
            variant={metric.winRate >= 0.5 ? "default" : "warning"}
          />
        </div>
        <div className="equity-chart-wrap bg-[var(--ak-surface-sunken-2)] p-2 border border-[var(--ak-border-subtle)] flex flex-col h-40">
          <div className="equity-chart-label text-[10px] text-[var(--ak-text-secondary)] uppercase tracking-wider mb-1 font-bold">
            EQUITY CURVE · {result.symbol.split("/")[1]}
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
          <span>Fee {(result.assumptions.feeRate * 10_000).toFixed(1)} bps · Slippage {(result.assumptions.slippageRate * 10_000).toFixed(1)} bps</span>
          <span title={result.execution?.fillTiming}>{result.execution?.fillTiming ?? "Next-bar open"} · {result.engineVersion}</span>
          {result.candleSource === "local-cache" && (
            <span className="text-[var(--ak-signal-action)] font-bold">LOCAL CANDLE CACHE</span>
          )}
        </div>

        <div className="result-actions flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            disabled={rerunning}
            onClick={() => void rerunBacktest()}
            icon={rerunning ? <RotateCcw size={12} className="spin" /> : <RotateCcw size={12} />}
            className="text-xs h-7"
          >
            Rerun backtest
          </Button>
          <Button
            variant="primary"
            size="sm"
            disabled={replayBusy || result.equityCurve.length === 0}
            onClick={() => onStartReplay(result)}
            className="text-xs h-7 font-bold"
            title="Continue to Replay from the final equity point of this backtest."
          >
            {replayBusy ? "Starting replay…" : "Continue to Replay"}
          </Button>
          {rerunError?.resultId === result.resultId && <span role="alert" className="error-inline text-xs text-[var(--ak-signal-danger)]">{rerunError.message}</span>}
          {replayError && <span role="alert" className="error-inline text-xs text-[var(--ak-signal-danger)]">{replayError}</span>}
        </div>
      </div>

      <div className="trades-section space-y-2">
        <div className="flex items-center justify-between pb-1 border-b border-[var(--ak-border-subtle)]">
          <div className="flex items-center gap-2">
            <strong className="text-xs tracking-wider uppercase">SIMULATED EXECUTION TRADES ({filteredTrades.length})</strong>
          </div>
          <div className="flex items-center gap-1 text-[10px]">
            <Filter size={11} className="text-[var(--ak-text-secondary)]" />
            {(["all", "long", "short", "win", "loss"] as const).map((mode) => (
              <button
                key={mode}
                type="button"
                onClick={() => setFilter(mode)}
                className={`px-1.5 py-0.5 uppercase border ${filter === mode ? "bg-[var(--ak-signal-info)] text-black border-transparent font-bold" : "bg-transparent text-[var(--ak-text-secondary)] border-[var(--ak-border-subtle)] hover:text-white"}`}
              >
                {mode}
              </button>
            ))}
          </div>
        </div>

        <div className="table-scroll trade-table-scroll overflow-auto max-h-56 border border-[var(--ak-border-subtle)]">
          {filteredTrades.length === 0 ? (
            <div className="empty-inline p-4 text-center text-xs text-[var(--ak-text-secondary)] flex items-center justify-center gap-1.5">
              <AlertCircle size={14} /> No trades match filter.
            </div>
          ) : (
            <table className="data-table w-full text-left">
              <thead>
                <tr className="bg-[var(--ak-surface-sunken)] border-b border-[var(--ak-border-subtle)] text-[10px] text-[var(--ak-text-secondary)] uppercase">
                  <th className="p-1.5">#</th>
                  <th className="p-1.5">SIDE</th>
                  <th className="p-1.5">ENTRY UTC</th>
                  <th className="p-1.5">ENTRY</th>
                  <th className="p-1.5">EXIT UTC</th>
                  <th className="p-1.5">EXIT</th>
                  <th className="p-1.5">NET PNL</th>
                  <th className="p-1.5">FEES</th>
                  <th className="p-1.5">REASON</th>
                </tr>
              </thead>
              <tbody>
                {filteredTrades.map((trade, index) => (
                  <tr key={trade.id} className="border-b border-[var(--ak-border-subtle)] hover:bg-[var(--ak-surface-sunken)] transition-colors">
                    <td className="p-1.5 text-[var(--ak-text-secondary)]">{index + 1}</td>
                    <td className="p-1.5">
                      <AkTag variant={trade.side === "long" ? "default" : "danger"} className="text-[9px] px-1 py-0">
                        {trade.side.toUpperCase()}
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
                    <td className="p-1.5 text-[10px] text-[var(--ak-text-secondary)] uppercase">{trade.exitReason}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      <div className="result-provenance text-[10px] text-[var(--ak-text-secondary)] opacity-60 text-right">
        Result ID: {result.resultId} · Dataset: {result.datasetId} · Created: {new Date(result.createdAt).toLocaleString()}
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
      if (!response.ok) throw new Error("Experiment history is unavailable.");
      if (typeof payload === "object" && payload !== null && "items" in payload && Array.isArray(payload.items) && !disposed) {
        const nextItems = payload.items as ExperimentSummary[];
        setItems(nextItems);
        setSelectedIds((current) => current.filter((id) => nextItems.some((item) => item.resultId === id)));
        setError(null);
      }
    }).catch((reason: unknown) => { if (!disposed) setError(reason instanceof Error ? reason.message : "History load failed."); })
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
        if (!response.ok) throw new Error("A selected result could not be loaded.");
        return await response.json() as BacktestResult;
      }));
      setComparison(results);
    } catch (reason) {
      setComparisonError(reason instanceof Error ? reason.message : "Comparison could not be loaded.");
    } finally {
      setLoadingComparison(false);
    }
  };

  if (error) {
    return (
      <div className="empty-state p-6 text-center text-xs text-[var(--ak-signal-danger)]">
        <AlertCircle size={18} className="mx-auto mb-2" />
        <strong>History unavailable</strong>
        <span>{error}</span>
        <Button
          variant="outline"
          size="sm"
          className="mt-2 text-xs"
          disabled={refreshing}
          onClick={() => setRefreshToken((token) => token + 1)}
        >
          {refreshing ? "Retrying…" : "Retry"}
        </Button>
      </div>
    );
  }
  if (items.length === 0) {
    return (
      <div className="empty-state p-6 text-center text-xs text-[var(--ak-text-secondary)]">
        <Clock3 size={18} className="mx-auto mb-2 text-[var(--ak-signal-info)]" />
        <strong>{refreshing ? "Loading saved runs…" : "No saved experiments"}</strong>
        <span>{refreshing ? "Checking local history." : "Each completed backtest is stored in local SQLite."}</span>
        <Button
          variant="outline"
          size="sm"
          className="mt-2 text-xs"
          disabled={refreshing}
          onClick={() => setRefreshToken((token) => token + 1)}
        >
          {refreshing ? "Refreshing…" : "Refresh"}
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
        <span className="text-[10px] text-[var(--ak-text-secondary)]">{items.length} saved run{items.length === 1 ? "" : "s"} · newest first</span>
        <Button
          variant="outline"
          size="sm"
          className="h-6 text-[10px] px-2"
          disabled={refreshing || loadingComparison}
          onClick={() => setRefreshToken((token) => token + 1)}
          icon={<RotateCcw size={11} className={refreshing ? "spin" : undefined} />}
        >
          {refreshing ? "Refreshing…" : "Refresh"}
        </Button>
      </div>
      <div className="table-scroll overflow-auto max-h-56 border border-[var(--ak-border-subtle)]">
        <table className="data-table w-full text-left">
          <thead>
            <tr className="bg-[var(--ak-surface-sunken)] border-b border-[var(--ak-border-subtle)] text-[10px] text-[var(--ak-text-secondary)] uppercase">
              <th className="p-1.5">SELECT</th>
              <th className="p-1.5">CREATED</th>
              <th className="p-1.5">SYMBOL</th>
              <th className="p-1.5">STRATEGY</th>
              <th className="p-1.5">RETURN</th>
              <th className="p-1.5">MAX DD</th>
              <th className="p-1.5">TRADES</th>
              <th className="p-1.5">RESULT ID</th>
              <th className="p-1.5 text-right">ACTION</th>
            </tr>
          </thead>
          <tbody>
            {items.map((item) => (
              <tr key={item.resultId} className="border-b border-[var(--ak-border-subtle)] hover:bg-[var(--ak-surface-sunken)] transition-colors clickable-row cursor-pointer" onClick={() => onSelect(item.resultId)}>
                <td className="p-1.5" onClick={(event) => event.stopPropagation()}>
                  <input
                    aria-label={`Select ${item.resultId} for comparison`}
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
                    aria-label={`Open result ${item.resultId.slice(0, 12)}`}
                    className="text-[10px] font-mono px-1.5 py-0.5 border border-[var(--ak-border-subtle)] hover:border-[var(--ak-signal-info)] hover:text-[var(--ak-signal-info)] cursor-pointer focus-visible:outline focus-visible:outline-1 focus-visible:outline-[var(--ak-signal-info)]"
                  >
                    Open
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="result-actions flex items-center justify-between p-2 bg-[var(--ak-surface-sunken)] border border-[var(--ak-border-subtle)]">
        <span className="text-[11px] text-[var(--ak-text-secondary)]">{selectedIds.length} runs selected</span>
        <Button
          variant="outline"
          size="sm"
          disabled={selectedIds.length < 2 || loadingComparison}
          onClick={() => void compareSelected()}
          className="text-xs"
        >
          {loadingComparison ? "Loading results…" : "Compare selected"}
        </Button>
      </div>

      {comparisonError && <div className="error-inline text-xs text-[var(--ak-signal-danger)] p-2" role="alert">{comparisonError}</div>}

      {comparison && (
        <section aria-label="Backtest comparison" className="comparison-panel p-2.5 bg-[var(--ak-surface-sunken-2)] border border-[var(--ak-border-subtle)] space-y-2">
          <h3 className="text-xs font-bold text-[var(--ak-signal-info)] uppercase tracking-wider">
            {incompatible ? "Selected results are not comparable" : comparable.length > 0 ? `Comparable group · ${EXCHANGE_LABELS[comparable[0]!.exchange]} · ${comparable[0]!.symbol} · ${comparable[0]!.timeframe}` : "Comparable group"}
          </h3>
          {incompatible ? (
            <p role="alert" className="text-[11px] text-[var(--ak-signal-danger)]">Cannot compare the selected results: they must share a known dataset, venue, symbol, timeframe, engine version, and fixed assumptions. Selected result IDs: {comparable.map((item) => item.resultId).join(", ")}.</p>
          ) : comparable.length < 2 ? (
            <p className="text-[11px] text-[var(--ak-text-secondary)] leading-relaxed">
              Results are grouped by venue, symbol, timeframe, engine version, and fixed assumptions.
            </p>
          ) : (
            <div className="table-scroll overflow-auto border border-[var(--ak-border-subtle)]">
              <table className="data-table w-full text-left">
                <thead>
                  <tr className="bg-[var(--ak-surface-sunken)] border-b border-[var(--ak-border-subtle)] text-[10px] text-[var(--ak-text-secondary)] uppercase">
                    <th className="p-1.5">STRATEGY / ID</th>
                    <th className="p-1.5">TOTAL RETURN</th>
                    <th className="p-1.5">MAX DRAWDOWN</th>
                    <th className="p-1.5">SHARPE</th>
                    <th className="p-1.5">WIN RATE</th>
                    <th className="p-1.5">TRADES</th>
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
      if (!response.ok) throw new Error("Backtest result could not be loaded.");
      const payload: unknown = await response.json();
      if (requestId !== selectionRequestRef.current || !canApply() || useWorkspaceStore.getState().backtest !== initialBacktest || useWorkspaceStore.getState().activeBacktestId !== initialActiveId) return;
      setBacktest(payload as BacktestResult);
      setTab("backtest");
    }).catch((error: unknown) => { if (requestId === selectionRequestRef.current && canApply() && useWorkspaceStore.getState().backtest === initialBacktest && useWorkspaceStore.getState().activeBacktestId === initialActiveId) setPaperError(error instanceof Error ? error.message : "Could not load result."); });
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
                <span>Positions</span>
              </TabsTrigger>
            )}
            {(workspace === "terminal" || workspace === "replay") && (
              <TabsTrigger value="orders" className="flex items-center gap-1.5 py-1.5 px-3 text-xs font-bold uppercase tracking-wider">
                <ListChecks size={12} className="text-[var(--ak-signal-action)]" />
                <span>Orders</span>
              </TabsTrigger>
            )}
            {workspace === "research" && (
              <TabsTrigger value="backtest" className="flex items-center gap-1.5 py-1.5 px-3 text-xs font-bold uppercase tracking-wider">
                <FileText size={12} className="text-[var(--ak-signal-info)]" />
                <span>Results</span>
              </TabsTrigger>
            )}
            {workspace === "research" && (
              <TabsTrigger value="sweep" className="flex items-center gap-1.5 py-1.5 px-3 text-xs font-bold uppercase tracking-wider">
                <ScanSearch size={12} className="text-[var(--ak-signal-action)]" />
                <span>Sweep</span>
              </TabsTrigger>
            )}
            {workspace === "research" && (
              <TabsTrigger value="evaluate" className="flex items-center gap-1.5 py-1.5 px-3 text-xs font-bold uppercase tracking-wider">
                <FlaskConical size={12} className="text-[var(--ak-signal-success)]" />
                <span>Evaluate</span>
              </TabsTrigger>
            )}
            {workspace === "research" && (
              <TabsTrigger value="history" className="flex items-center gap-1.5 py-1.5 px-3 text-xs font-bold uppercase tracking-wider">
                <Clock3 size={12} className="text-[var(--ak-signal-info)]" />
                <span>Experiments</span>
              </TabsTrigger>
            )}
            {workspace === "research" && (
              <TabsTrigger value="logs" className="flex items-center gap-1.5 py-1.5 px-3 text-xs font-bold uppercase tracking-wider">
                <Boxes size={12} className="text-[var(--ak-text-secondary)]" />
                <span>Execution</span>
              </TabsTrigger>
            )}
          </TabsList>
        </Tabs>
        <div className="dock-toolbar-right flex items-center gap-2 text-[10px] font-mono text-[var(--ak-text-secondary)]">
          <span className="w-1.5 h-1.5 rounded-full bg-[var(--ak-signal-info)] animate-pulse" />
          <span className="uppercase tracking-wider font-bold">
            {replayMode ? "REPLAY · ISOLATED SIMULATION" : "LOCAL SQLITE · PAPER TRADING"}
          </span>
        </div>
      </div>

      <div className="dock-content flex-1 overflow-auto min-h-0">
        {activeTab === "positions" && (workspace === "terminal" || workspace === "replay") && (
          replayMode ? <ReplayPositions session={replaySession} portfolio={replayPortfolio} /> : <PaperPositions key={`${exchange}|${symbol}`} symbol={symbol} exchange={exchange} markPrice={markPrice} quoteStale={quoteStale} />
        )}
        {activeTab === "orders" && (
          replayMode ? <OrdersTable orders={replayOrders} /> : paperError && !paper ? (
            <div className="empty-state p-6 text-center text-xs text-[var(--ak-signal-danger)]"><AlertCircle size={18} className="mx-auto mb-2" /><strong>Orders unavailable</strong><span>{paperError}</span></div>
          ) : paper === null ? (
            <div className="empty-state p-6 text-center text-xs text-[var(--ak-text-secondary)]"><strong>Loading Paper orders…</strong><span>The local account snapshot is being read.</span></div>
          ) : (
            <OrdersTable orders={paper.orders} />
          )
        )}
        {activeTab === "history" && workspace === "research" && replayMode && (
          <div className="empty-state p-6 text-center text-xs text-[var(--ak-text-secondary)]"><AlertCircle size={18} className="mx-auto mb-2 text-[var(--ak-signal-action)]" /><strong>Experiment history hidden during replay</strong><span>Future-derived results are strictly hidden.</span></div>
        )}
        {!replayMode && (historyPanelVisited || showHistoryPanel) && (
          <div hidden={!showHistoryPanel}>
            <ExperimentHistory onSelect={selectResult} refreshKey={activeBacktestId} />
          </div>
        )}
        {activeTab === "backtest" && workspace === "research" && replayMode && (
          <div className="empty-state p-6 text-center text-xs text-[var(--ak-text-secondary)]"><AlertCircle size={18} className="mx-auto mb-2 text-[var(--ak-signal-action)]" /><strong>Backtest metrics suppressed</strong><span>Only bars through the replay cursor are revealed.</span></div>
        )}
        {!replayMode && (backtestPanelVisited || showBacktestPanel) && (
          <div hidden={!showBacktestPanel}>
            <BacktestView result={result} selectionRequestRef={selectionRequestRef} onOpenStrategy={openStrategy} onStartReplay={onStartReplay} replayBusy={replayBusy} replayError={replayError} />
          </div>
        )}
        {activeTab === "sweep" && workspace === "research" && replayMode && (
          <div className="empty-state p-6 text-center text-xs text-[var(--ak-text-secondary)]"><AlertCircle size={18} className="mx-auto mb-2 text-[var(--ak-signal-action)]" /><strong>Saved sweeps hidden during Replay</strong><span>Saved sweep history and new sweeps are hidden to avoid future-derived results.</span></div>
        )}
        {workspace === "research" && !replayMode && (sweepPanelVisited || showSweepPanel) && (
          <div hidden={!showSweepPanel}>
            <SweepPanel symbol={symbol} timeframe={timeframe} exchange={exchange} strategyId={STRATEGIES.find((s) => s.id === selectedStrategyId)?.id ?? selectedStrategyId} parameters={strategyParameters} config={config} />
          </div>
        )}
        {activeTab === "evaluate" && workspace === "research" && replayMode && (
          <div className="empty-state p-6 text-center text-xs text-[var(--ak-text-secondary)]"><AlertCircle size={18} className="mx-auto mb-2 text-[var(--ak-signal-action)]" /><strong>Evaluations suppressed during replay</strong><span>The holdout window is future data.</span></div>
        )}
        {workspace === "research" && !replayMode && (evaluationPanelVisited || showEvaluationPanel) && (
          <div hidden={!showEvaluationPanel}>
            <EvaluationPanel symbol={symbol} timeframe={timeframe} exchange={exchange} />
          </div>
        )}
        {activeTab === "logs" && workspace === "research" && (
          <div className="execution-log p-3 font-mono text-xs space-y-1.5">
            <div className="log-line flex items-center gap-2 text-[var(--ak-text-secondary)]">
              <AkTag variant="neutral" className="text-[9px]">LOCAL</AkTag>
              <span className="text-[var(--ak-signal-info)]">Safety Boundary</span>
              <span>Real exchange execution endpoints are disabled; system operates strictly in local deterministic simulation.</span>
            </div>
            <div className="log-line flex items-center gap-2 text-[var(--ak-text-secondary)]">
              <AkTag variant="advanced" className="text-[9px]">DATA</AkTag>
              <span className="text-[var(--ak-signal-action)]">Market Data</span>
              <span>{EXCHANGE_LABELS[exchange]} live REST feeds + local SQLite persistent candle cache.</span>
            </div>
            {paper?.orders.slice(0, 10).map((order) => (
              <div className="log-line flex items-center gap-2 text-xs" key={order.clientOrderId}>
                <span className="text-[10px] text-[var(--ak-text-secondary)]">{new Date(order.createdAt).toLocaleTimeString()}</span>
                <AkTag variant={order.status === "filled" ? "default" : "danger"} className="text-[9px]">
                  {order.status.toUpperCase()}
                </AkTag>
                <span className="font-bold">{order.side.toUpperCase()} {order.quantity} {order.symbol}</span>
                <span className="text-[10px] text-[var(--ak-text-secondary)] opacity-70">({order.clientOrderId})</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </section>
  );
});
