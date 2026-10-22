"use client";

import { useEffect, useRef, useState } from "react";
import { AreaSeries, ColorType, createChart, type UTCTimestamp } from "lightweight-charts";
import { AlertCircle, ArrowDownRight, ArrowUpRight, Boxes, Clock3, FileText, FlaskConical, ListChecks, RotateCcw, ScanSearch, Wallet, Filter } from "lucide-react";
import { STRATEGIES, type BacktestResult, type ExchangeId, type PaperOrder, type PaperPortfolio, type ReplaySession } from "@newbeing/core";
import { SweepPanel } from "@/components/sweep-panel";
import { EvaluationPanel } from "@/components/evaluation-panel";
import { Button } from "@/components/ui/button";
import { EXCHANGE_LABELS } from "@/lib/exchanges";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useShallow } from "zustand/react/shallow";
import { useWorkspaceStore } from "@/store/workspace";
import { AkTag, AkNotice, AkNum, AkButton } from "@swufefox/ak-ui-react";

/** Format an amount in the symbol's own quote currency */
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
  }, [result, theme]);

  return <div className="equity-chart w-full h-full" ref={root} />;
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
        if (tickerValid) setPrice((ticker as { last: number }).last);
        setStale(!tickerValid);
      } catch {
        if (!disposed) setStale(true);
      }
    };
    void refresh();
    const timer = window.setInterval(() => void refresh(), 8_000);
    return () => { disposed = true; window.clearInterval(timer); };
  }, [symbol, exchange]);

  if (!payload) return <div className="empty-state p-6 text-center text-xs text-[var(--ak-text-secondary)]"><Wallet size={18} className="mx-auto mb-2 text-[var(--ak-signal-info)]" /><strong>Paper account unavailable</strong><span>Waiting for local account state.</span></div>;
  const { portfolio } = payload;
  const unrealized = portfolio.averageEntryPrice !== null && price !== null
    ? (price - portfolio.averageEntryPrice) * portfolio.baseBalance
    : 0;
  const quoteCurrency = symbol.split("/")[1] ?? "USDT";

  return (
    <div className="position-table-wrap p-2.5 font-mono text-xs">
      <div className="paper-isolation-note flex items-center justify-between pb-2 mb-2 border-b border-[var(--ak-border-subtle)] text-[10px] text-[var(--ak-text-secondary)]">
        <div className="flex items-center gap-1.5">
          <AkTag variant="advanced" className="text-[9px]">PAPER ONLY</AkTag>
          <span>Isolated simulated wallet · zero live capital risk</span>
        </div>
        <span>VENUE: {EXCHANGE_LABELS[exchange].toUpperCase()}</span>
      </div>
      {stale && <div className="table-footnote text-xs text-[var(--ak-signal-action)] mb-2">STALE · Showing last account snapshot; mark price may be delayed.</div>}
      <div className="overflow-auto border border-[var(--ak-border-subtle)]">
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
            <tr className="border-b border-[var(--ak-border-subtle)] hover:bg-[var(--ak-surface-sunken)] transition-colors">
              <td className="p-2 font-bold flex items-center gap-1">
                <span className="text-[var(--ak-text-primary)]">{symbol.split("/")[0]}</span>
                <span className="text-[10px] text-[var(--ak-text-secondary)]">/{symbol.split("/")[1]}</span>
              </td>
              <td className="p-2 font-mono">{portfolio.baseBalance.toFixed(5)}</td>
              <td className="p-2 font-mono">{portfolio.averageEntryPrice?.toLocaleString(undefined, { maximumFractionDigits: 6 }) ?? "—"}</td>
              <td className="p-2 font-mono">{price?.toLocaleString(undefined, { maximumFractionDigits: 6 }) ?? "—"}</td>
              <td className={`p-2 font-mono font-bold ${unrealized >= 0 ? "positive text-[var(--ak-signal-success)]" : "negative text-[var(--ak-signal-danger)]"}`}>
                {money(unrealized, quoteCurrency)}
              </td>
              <td className={`p-2 font-mono font-bold ${portfolio.realizedPnl >= 0 ? "positive text-[var(--ak-signal-success)]" : "negative text-[var(--ak-signal-danger)]"}`}>
                {money(portfolio.realizedPnl, quoteCurrency)}
              </td>
              <td className="p-2 font-mono">{money(portfolio.quoteBalance, quoteCurrency)}</td>
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
  const unrealized = current && portfolio.averageEntryPrice !== null
    ? (current.close - portfolio.averageEntryPrice) * portfolio.baseBalance
    : 0;
  const quoteCurrency = session.symbol.split("/")[1] ?? "USDT";

  return (
    <div className="position-table-wrap p-2.5 font-mono text-xs">
      <div className="paper-isolation-note flex items-center justify-between pb-2 mb-2 border-b border-[var(--ak-border-subtle)] text-[10px] text-[var(--ak-text-secondary)]">
        <div className="flex items-center gap-1.5">
          <AkTag variant="default" className="text-[9px]">REPLAY WALLET</AkTag>
          <span>Marked strictly to the current revealed bar close</span>
        </div>
        <span>SESSION: {session.id.slice(0, 10)}…</span>
      </div>
      <div className="overflow-auto border border-[var(--ak-border-subtle)]">
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
              <td className="p-2 font-mono">{portfolio.baseBalance.toFixed(5)}</td>
              <td className="p-2 font-mono">{portfolio.averageEntryPrice?.toLocaleString(undefined, { maximumFractionDigits: 6 }) ?? "—"}</td>
              <td className="p-2 font-mono">{current?.close.toLocaleString(undefined, { maximumFractionDigits: 6 }) ?? "—"}</td>
              <td className={`p-2 font-mono font-bold ${unrealized >= 0 ? "positive text-[var(--ak-signal-success)]" : "negative text-[var(--ak-signal-danger)]"}`}>
                {money(unrealized, quoteCurrency)}
              </td>
              <td className={`p-2 font-mono font-bold ${portfolio.realizedPnl >= 0 ? "positive text-[var(--ak-signal-success)]" : "negative text-[var(--ak-signal-danger)]"}`}>
                {money(portfolio.realizedPnl, quoteCurrency)}
              </td>
              <td className="p-2 font-mono">{money(portfolio.quoteBalance, quoteCurrency)}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}

function OrdersTable({ orders }: { orders: PaperOrder[] }): React.JSX.Element {
  if (orders.length === 0) return <div className="empty-state p-6 text-center text-xs text-[var(--ak-text-secondary)]"><ListChecks size={18} className="mx-auto mb-2 text-[var(--ak-signal-info)]" /><strong>No simulated orders yet</strong><span>Paper orders will appear here with their client IDs and state.</span></div>;

  return (
    <div className="table-scroll overflow-auto max-h-72 p-2 font-mono text-xs">
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
                <td className="p-2 font-bold">{order.symbol}</td>
                <td className="p-2">
                  <AkTag variant={isBuy ? "default" : "danger"} className="text-[10px] px-1.5 py-0">
                    {order.side.toUpperCase()}
                  </AkTag>
                </td>
                <td className="p-2 font-mono">{order.quantity}</td>
                <td className="p-2">
                  <span className={`status-pill status-${order.status} uppercase font-bold text-[10px]`}>{order.status}</span>
                </td>
                <td className="p-2 font-mono">{order.fillPrice?.toLocaleString(undefined, { maximumFractionDigits: 6 }) ?? "—"}</td>
                <td className="p-2 mono text-[10px] text-[var(--ak-text-secondary)]">{order.clientOrderId}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function BacktestView({ result, onOpenStrategy, onStartReplay, replayBusy, replayError }: { result: BacktestResult | null; onOpenStrategy: () => void; onStartReplay: (result: BacktestResult) => void; replayBusy: boolean; replayError: string | null }): React.JSX.Element {
  const [filter, setFilter] = useState<"all" | "long" | "short" | "win" | "loss">("all");
  const [rerunning, setRerunning] = useState(false);
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
    setRerunning(true);
    try {
      const response = await fetch(`/api/backtests/${encodeURIComponent(result.resultId)}/rerun`, { method: "POST" });
      const payload: unknown = await response.json();
      if (response.ok && typeof payload === "object" && payload !== null && "resultId" in payload) {
        setBacktest(payload as BacktestResult);
      }
    } catch {
      // ignore
    } finally {
      setRerunning(false);
    }
  };

  return (
    <div className="backtest-view p-3 bg-[var(--ak-surface-canvas)] font-mono text-xs space-y-3">
      <div className="backtest-summary-row grid grid-cols-1 lg:grid-cols-3 gap-3">
        <div className="metric-strip grid grid-cols-2 md:grid-cols-3 gap-2 bg-[var(--ak-surface-sunken)] p-2.5 border border-[var(--ak-border-subtle)]">
          <Metric label="TOTAL RETURN" value={percentage(metric.totalReturn)} tone={metric.totalReturn >= 0 ? "positive" : "negative"} />
          <Metric label="MAX DRAWDOWN" value={percentage(-metric.maxDrawdown)} tone="negative" />
          <Metric label="SHARPE RATIO" value={metric.sharpeRatio?.toFixed(2) ?? "—"} title={result.execution?.sharpeMethod} />
          <Metric label="WIN RATE" value={percentage(metric.winRate)} />
          <Metric label="PROFIT FACTOR" value={metric.profitFactor?.toFixed(2) ?? "—"} />
          <Metric label="TOTAL TRADES" value={String(metric.tradeCount)} />
        </div>
        <div className="equity-chart-wrap lg:col-span-2 bg-[var(--ak-surface-sunken-2)] p-2 border border-[var(--ak-border-subtle)] flex flex-col h-40">
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
          >
            {replayBusy ? "Starting replay…" : "Replay from final equity point"}
          </Button>
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
                    <td className="p-1.5 font-mono">{trade.entryPrice.toLocaleString(undefined, { maximumFractionDigits: 6 })}</td>
                    <td className="p-1.5 text-[10px] text-[var(--ak-text-secondary)]">{timestamp(trade.exitTime)}</td>
                    <td className="p-1.5 font-mono">{trade.exitPrice.toLocaleString(undefined, { maximumFractionDigits: 6 })}</td>
                    <td className={`p-1.5 font-mono font-bold ${trade.netPnl >= 0 ? "positive text-[var(--ak-signal-success)]" : "negative text-[var(--ak-signal-danger)]"}`}>
                      {money(trade.netPnl, result.symbol.split("/")[1])}
                    </td>
                    <td className="p-1.5 font-mono text-[var(--ak-text-secondary)]">{money(trade.fees, result.symbol.split("/")[1])}</td>
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

function Metric({ label, value, tone, title }: { label: string; value: string; tone?: "positive" | "negative"; title?: string }): React.JSX.Element {
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

function ExperimentHistory({ onSelect }: { onSelect: (id: string) => void }): React.JSX.Element {
  const [items, setItems] = useState<BacktestResult[]>([]);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [comparison, setComparison] = useState<BacktestResult[] | null>(null);
  const [comparisonError, setComparisonError] = useState<string | null>(null);
  const [loadingComparison, setLoadingComparison] = useState(false);
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

  if (error) return <div className="empty-state p-6 text-center text-xs text-[var(--ak-signal-danger)]"><AlertCircle size={18} className="mx-auto mb-2" /><strong>History unavailable</strong><span>{error}</span></div>;
  if (items.length === 0) return <div className="empty-state p-6 text-center text-xs text-[var(--ak-text-secondary)]"><Clock3 size={18} className="mx-auto mb-2 text-[var(--ak-signal-info)]" /><strong>No saved experiments</strong><span>Each completed backtest is stored in local SQLite.</span></div>;

  const assumptionsKey = (item: BacktestResult): string => JSON.stringify([
    item.assumptions.initialCapital,
    item.assumptions.positionFraction,
    item.assumptions.feeRate,
    item.assumptions.slippageRate,
    item.assumptions.allowShorts,
    item.assumptions.stopLossPct,
    item.assumptions.takeProfitPct,
  ]);
  const groupKey = (item: BacktestResult): string => [item.exchange, item.symbol, item.timeframe, item.engineVersion, assumptionsKey(item)].join("|");
  const comparable = comparison?.length ? comparison.filter((item) => groupKey(item) === groupKey(comparison[0]!)) : [];
  const excluded = comparison?.filter((item) => !comparable.includes(item)) ?? [];

  return (
    <div className="p-3 font-mono text-xs space-y-3">
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
            </tr>
          </thead>
          <tbody>
            {items.map((item) => (
              <tr key={item.resultId} className="border-b border-[var(--ak-border-subtle)] hover:bg-[var(--ak-surface-sunken)] transition-colors clickable-row cursor-pointer">
                <td className="p-1.5">
                  <input
                    aria-label={`Select ${item.resultId} for comparison`}
                    type="checkbox"
                    checked={selectedIds.includes(item.resultId)}
                    onChange={(event) => setSelectedIds((current) => event.target.checked ? [...current, item.resultId] : current.filter((id) => id !== item.resultId))}
                  />
                </td>
                <td className="p-1.5 text-[10px] text-[var(--ak-text-secondary)]" onClick={() => onSelect(item.resultId)}>{new Date(item.createdAt).toLocaleString()}</td>
                <td className="p-1.5 font-bold" onClick={() => onSelect(item.resultId)}>{item.symbol} · {item.timeframe}</td>
                <td className="p-1.5" onClick={() => onSelect(item.resultId)}>{item.strategyId}</td>
                <td className={`p-1.5 font-mono font-bold ${item.metrics.totalReturn >= 0 ? "positive text-[var(--ak-signal-success)]" : "negative text-[var(--ak-signal-danger)]"}`} onClick={() => onSelect(item.resultId)}>
                  {percentage(item.metrics.totalReturn)}
                </td>
                <td className="p-1.5 font-mono text-[var(--ak-signal-danger)]" onClick={() => onSelect(item.resultId)}>
                  {percentage(-item.metrics.maxDrawdown)}
                </td>
                <td className="p-1.5 font-mono" onClick={() => onSelect(item.resultId)}>{item.metrics.tradeCount}</td>
                <td className="p-1.5 mono text-[10px] text-[var(--ak-text-secondary)]" onClick={() => onSelect(item.resultId)}>{item.resultId.slice(0, 12)}…</td>
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
            {comparable.length > 0 ? `Comparable group · ${EXCHANGE_LABELS[comparable[0]!.exchange]} · ${comparable[0]!.symbol} · ${comparable[0]!.timeframe}` : "Comparable group"}
          </h3>
          {comparable.length < 2 ? (
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

export function BottomDock({
  replayMode = false,
  replaySession = null,
  replayPortfolio = null,
  replayOrders = [],
  workspace = "terminal",
  onStartReplay,
  replayBusy = false,
  replayError = null,
}: {
  workspace?: "terminal" | "research" | "replay";
  replayMode?: boolean;
  replaySession?: ReplaySession | null;
  replayPortfolio?: PaperPortfolio | null;
  replayOrders?: PaperOrder[];
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
  }, [symbol, replayMode, exchange]);

  return (
    <section className="bottom-dock flex flex-col h-full bg-[var(--ak-surface-canvas)] border-t border-[var(--ak-border-strong)]">
      <div className="dock-toolbar flex items-center justify-between px-2 bg-[var(--ak-surface-sunken)] border-b border-[var(--ak-border-strong)]">
        <Tabs value={activeTab} onValueChange={(value) => setTab(value as typeof tab)}>
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
          replayMode ? <ReplayPositions session={replaySession} portfolio={replayPortfolio} /> : <PaperPositions key={`${exchange}|${symbol}`} symbol={symbol} exchange={exchange} />
        )}
        {activeTab === "orders" && (
          replayMode ? <OrdersTable orders={replayOrders} /> : paperError && !paper ? (
            <div className="empty-state p-6 text-center text-xs text-[var(--ak-signal-danger)]"><AlertCircle size={18} className="mx-auto mb-2" /><strong>Orders unavailable</strong><span>{paperError}</span></div>
          ) : (
            <OrdersTable orders={paper?.orders ?? []} />
          )
        )}
        {activeTab === "history" && workspace === "research" && (
          replayMode ? (
            <div className="empty-state p-6 text-center text-xs text-[var(--ak-text-secondary)]"><AlertCircle size={18} className="mx-auto mb-2 text-[var(--ak-signal-action)]" /><strong>Experiment history hidden during replay</strong><span>Future-derived results are strictly hidden.</span></div>
          ) : (
            <ExperimentHistory onSelect={selectResult} />
          )
        )}
        {activeTab === "backtest" && workspace === "research" && (
          replayMode ? (
            <div className="empty-state p-6 text-center text-xs text-[var(--ak-text-secondary)]"><AlertCircle size={18} className="mx-auto mb-2 text-[var(--ak-signal-action)]" /><strong>Backtest metrics suppressed</strong><span>Only bars through the replay cursor are revealed.</span></div>
          ) : (
            <BacktestView result={result} onOpenStrategy={() => setInspectorTab("strategy")} onStartReplay={onStartReplay} replayBusy={replayBusy} replayError={replayError} />
          )
        )}
        {activeTab === "sweep" && workspace === "research" && (
          replayMode ? (
            <div className="empty-state p-6 text-center text-xs text-[var(--ak-text-secondary)]"><AlertCircle size={18} className="mx-auto mb-2 text-[var(--ak-signal-action)]" /><strong>Sweeps suppressed during replay</strong><span>A sweep reads future bars.</span></div>
          ) : (
            <SweepPanel symbol={symbol} timeframe={timeframe} exchange={exchange} strategyId={STRATEGIES.find((s) => s.id === selectedStrategyId)?.id ?? selectedStrategyId} parameters={strategyParameters} config={config} />
          )
        )}
        {activeTab === "evaluate" && workspace === "research" && (
          replayMode ? (
            <div className="empty-state p-6 text-center text-xs text-[var(--ak-text-secondary)]"><AlertCircle size={18} className="mx-auto mb-2 text-[var(--ak-signal-action)]" /><strong>Evaluations suppressed during replay</strong><span>The holdout window is future data.</span></div>
          ) : (
            <EvaluationPanel symbol={symbol} timeframe={timeframe} exchange={exchange} />
          )
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
}
