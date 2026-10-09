"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Activity,
  ChevronDown,
  Command,
  LayoutDashboard,
  LoaderCircle,
  Moon,
  Search,
  Sun,
  X,
} from "lucide-react";
import { MarketChart } from "@/components/market-chart";
import { BottomDock } from "@/components/bottom-dock";
import { Inspector } from "@/components/inspector";
import { ReplayControls } from "@/components/replay-controls";
import { Watchlist } from "@/components/watchlist";
import { WorkspaceSync } from "@/components/workspace-sync";
import { Button } from "@/components/ui/button";
import { useWorkspaceStore } from "@/store/workspace";
import { useShallow } from "zustand/react/shallow";
import type { BacktestResult, Candle, PaperOrder, PaperPortfolio, ReplaySession, Timeframe, WorkspaceState } from "@newbeing/core";
import type { MarketSummary, MarketSymbol } from "@newbeing/market-data/types";

const TIMEFRAMES: readonly Timeframe[] = ["1m", "5m", "15m", "30m", "1h", "4h", "1d"];
const EMPTY_REPLAY_BARS: readonly Candle[] = [];

function readItems<T>(payload: unknown): T[] {
  if (typeof payload !== "object" || payload === null || !("items" in payload) || !Array.isArray(payload.items)) return [];
  return payload.items as T[];
}

function parseSummary(payload: unknown): MarketSummary | null {
  if (typeof payload !== "object" || payload === null || !("symbol" in payload) || typeof payload.symbol !== "string" || !("last" in payload)) return null;
  return payload as MarketSummary;
}

function formatPrice(value: number | null | undefined): string {
  return typeof value === "number" && Number.isFinite(value)
    ? value.toLocaleString("en-US", { minimumFractionDigits: value < 1 ? 4 : 2, maximumFractionDigits: 6 })
    : "—";
}

function localDateTime(timestamp: number): string {
  const local = new Date(timestamp - new Date(timestamp).getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}

interface ReplayEnvelope {
  session: ReplaySession;
  portfolio?: PaperPortfolio;
  orders?: PaperOrder[];
}

function parseReplayEnvelope(payload: unknown): ReplayEnvelope | null {
  if (typeof payload !== "object" || payload === null || !("session" in payload)) return null;
  const rawSession = payload.session;
  if (typeof rawSession !== "object" || rawSession === null || !("id" in rawSession) || !("bars" in rawSession)
    || typeof rawSession.id !== "string" || !Array.isArray(rawSession.bars)) return null;
  return payload as ReplayEnvelope;
}

function useSummary(symbol: string, enabled: boolean): { summary: MarketSummary | null; error: string | null } {
  const [snapshot, setSnapshot] = useState<{ symbol: string; summary: MarketSummary | null; error: string | null } | null>(null);
  useEffect(() => {
    if (!enabled) return;
    let disposed = false;
    const refresh = async (): Promise<void> => {
      try {
        const response = await fetch(`/api/market?kind=summary&symbol=${encodeURIComponent(symbol)}`, { cache: "no-store" });
        const payload: unknown = await response.json();
        if (!response.ok) throw new Error("Binance ticker unavailable.");
        const parsed = parseSummary(payload);
        if (!parsed) throw new Error("Invalid market summary.");
        if (!disposed) setSnapshot({ symbol, summary: parsed, error: null });
      } catch (reason) {
        if (!disposed) setSnapshot({ symbol, summary: null, error: reason instanceof Error ? reason.message : "Market summary unavailable." });
      }
    };
    void refresh();
    const timer = window.setInterval(() => void refresh(), 5_000);
    return () => { disposed = true; window.clearInterval(timer); };
  }, [symbol, enabled]);
  return enabled && snapshot?.symbol === symbol
    ? { summary: snapshot.summary, error: snapshot.error }
    : { summary: null, error: null };
}

function SymbolPicker({ disabled = false }: { disabled?: boolean }): React.JSX.Element {
  const [symbol, setSymbol, addWatchlist] = useWorkspaceStore(useShallow((state) => [state.symbol, state.setSymbol, state.addWatchlistSymbol]));
  const [query, setQuery] = useState(symbol);
  const [open, setOpen] = useState(false);
  const [searchResult, setSearchResult] = useState<{ query: string; items: MarketSymbol[]; error: string | null } | null>(null);
  const [loading, setLoading] = useState(false);
  useEffect(() => {
    if (!open || query.trim().length < 1) return;
    let disposed = false;
    const timer = window.setTimeout(() => {
      setLoading(true);
      void fetch(`/api/markets?q=${encodeURIComponent(query)}`, { cache: "no-store" }).then(async (response) => {
        const payload: unknown = await response.json();
        if (!response.ok) throw new Error("Binance symbol search is unavailable.");
        if (!disposed) setSearchResult({ query, items: readItems<MarketSymbol>(payload), error: null });
      }).catch((reason: unknown) => {
        if (!disposed) setSearchResult({ query, items: [], error: reason instanceof Error ? reason.message : "Search failed." });
      }).finally(() => { if (!disposed) setLoading(false); });
    }, 180);
    return () => { disposed = true; window.clearTimeout(timer); };
  }, [query, open]);

  const result = searchResult?.query === query ? searchResult : null;
  const items = result?.items ?? [];
  const error = result?.error ?? null;
  const showLoading = open && query.trim().length >= 1 && loading;

  const choose = (next: string): void => {
    setSymbol(next);
    addWatchlist(next);
    setQuery(next);
    setOpen(false);
  };

  return <div className="symbol-picker">
    <div className={`symbol-search ${open ? "focused" : ""}`}>
      <Search size={14} />
      <input aria-label="Search Binance Spot symbols" disabled={disabled} value={open ? query : symbol} onFocus={() => { if (!disabled) { setOpen(true); setQuery(""); } }} onChange={(event) => setQuery(event.target.value)} onKeyDown={(event) => {
        if (event.key === "Escape") { setOpen(false); setQuery(symbol); }
        if (event.key === "Enter" && items[0]) choose(items[0].symbol);
      }} placeholder="Search market" />
      <ChevronDown size={12} className="search-chevron" />
    </div>
    {open && <>
      <button className="popover-backdrop" aria-label="Close symbol search" onClick={() => { setOpen(false); setQuery(symbol); }} />
      <div className="symbol-results">
        <div className="popover-title">BINANCE SPOT · USDT MARKETS</div>
        {showLoading && <div className="popover-state"><LoaderCircle className="spin" size={14} />Searching markets…</div>}
        {error && <div className="popover-error">{error}</div>}
        {!showLoading && !error && items.map((item) => <button className="symbol-result" key={item.symbol} onClick={() => choose(item.symbol)}>
          <span><strong>{item.base}</strong><small>{item.symbol}</small></span><span className="result-quote">{item.quote}<ChevronDown size={12} /></span>
        </button>)}
        {!showLoading && !error && query.trim().length > 0 && items.length === 0 && <div className="popover-state">No active USDT spot pair found.</div>}
      </div>
    </>}
  </div>;
}

function MarketSummaryBar({ summary, error, replayMode, replayPrice }: { summary: MarketSummary | null; error: string | null; replayMode: boolean; replayPrice: number | null }): React.JSX.Element {
  const change = summary?.changePct24h;
  return <div className="summary-strip">
    <div className="summary-price"><span>{replayMode ? "CURSOR CLOSE" : "LAST"}</span><strong>{formatPrice(replayMode ? replayPrice : summary?.last)}</strong>{!replayMode && typeof change === "number" && <small className={change >= 0 ? "positive" : "negative"}>{change >= 0 ? "+" : ""}{change.toFixed(2)}%</small>}</div>
    {!replayMode && <><div><span>24H HIGH</span><strong>{formatPrice(summary?.high24h)}</strong></div>
      <div><span>24H LOW</span><strong>{formatPrice(summary?.low24h)}</strong></div>
      <div><span>24H QUOTE VOL</span><strong>{typeof summary?.quoteVolume24h === "number" ? `${(summary.quoteVolume24h / 1_000_000).toFixed(2)}M` : "—"}</strong></div></>}
    <div className="summary-source">{replayMode ? "HISTORICAL ONLY · NO LIVE QUOTES" : error ? <span className="negative">Ticker unavailable</span> : <><i className="live-dot" />PUBLIC MARKET DATA</>}</div>
  </div>;
}

function DragHandle({ direction, onDelta, style }: { direction: "horizontal" | "vertical"; onDelta: (delta: number) => void; style?: React.CSSProperties }): React.JSX.Element {
  const start = useRef<{ x: number; y: number } | null>(null);
  const handlePointerDown = (event: React.PointerEvent<HTMLDivElement>): void => {
    event.preventDefault();
    start.current = { x: event.clientX, y: event.clientY };
    event.currentTarget.setPointerCapture(event.pointerId);
  };
  const handlePointerMove = (event: React.PointerEvent<HTMLDivElement>): void => {
    if (!start.current || (event.buttons & 1) === 0) return;
    const delta = direction === "horizontal" ? event.clientX - start.current.x : start.current.y - event.clientY;
    onDelta(delta);
    start.current = { x: event.clientX, y: event.clientY };
  };
  const handlePointerUp = (event: React.PointerEvent<HTMLDivElement>): void => {
    start.current = null;
    event.currentTarget.releasePointerCapture(event.pointerId);
  };
  return <div className={`drag-handle drag-${direction}`} style={style} role="separator" aria-orientation={direction === "horizontal" ? "vertical" : "horizontal"} onPointerDown={handlePointerDown} onPointerMove={handlePointerMove} onPointerUp={handlePointerUp} />;
}

export function Terminal(): React.JSX.Element {
  const [workspace, setWorkspace, symbol, timeframe, theme, setTheme, layout, setLayout, visibleRange, setVisibleRange, setBacktest, setDockTab, strategyId, parameters, config, activeReplayId, setActiveReplayId] = useWorkspaceStore(useShallow((state) => [
    state.activeWorkspace, state.setWorkspace, state.symbol, state.timeframe, state.theme, state.setTheme, state.layout, state.setLayout,
    state.visibleRange, state.setVisibleRange, state.setBacktest, state.setDockTab, state.selectedStrategyId, state.strategyParameters, state.backtestConfig,
    state.activeReplayId, state.setActiveReplayId,
  ]));
  const { summary, error: summaryError } = useSummary(symbol, workspace !== "replay");
  const [running, setRunning] = useState(false);
  const [backtestError, setBacktestError] = useState<string | null>(null);
  const [lastAction, setLastAction] = useState<string | null>(null);
  const result = useWorkspaceStore((state) => state.backtest);
  const [replaySession, setReplaySession] = useState<ReplaySession | null>(null);
  const [replayPortfolio, setReplayPortfolio] = useState<PaperPortfolio | null>(null);
  const [replayOrders, setReplayOrders] = useState<PaperOrder[]>([]);
  const [replayStartAt, setReplayStartAt] = useState(() => localDateTime(Date.now() - 2 * 24 * 60 * 60 * 1000));
  const [replayLimit, setReplayLimit] = useState(200);
  const [replaySpeed, setReplaySpeed] = useState(1);
  const [replayPlaying, setReplayPlaying] = useState(false);
  const [replayBusy, setReplayBusy] = useState(false);
  const [replayError, setReplayError] = useState<string | null>(null);
  const replayBusyRef = useRef(false);
  const replayStepRef = useRef<() => Promise<void>>(async () => undefined);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);

  const setPage = (next: WorkspaceState["activeWorkspace"]): void => {
    if (next !== "replay") setReplayPlaying(false);
    setWorkspace(next);
    if (next === "backtest") setDockTab("backtest");
    if (next === "research") useWorkspaceStore.getState().setInspectorTab("strategy");
  };

  const runBacktest = useCallback(async (): Promise<void> => {
    setRunning(true);
    setBacktestError(null);
    setLastAction("Fetching completed Binance bars and running the event loop…");
    try {
      const response = await fetch("/api/backtests", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          symbol,
          timeframe,
          strategyId,
          parameters,
          config: { ...config, allowShorts: Boolean(parameters.allowShorts) },
          limit: 600,
        }),
      });
      const payload: unknown = await response.json();
      if (!response.ok) {
        const message = typeof payload === "object" && payload !== null && "error" in payload && typeof payload.error === "string" ? payload.error : "Backtest failed.";
        throw new Error(message);
      }
      if (typeof payload !== "object" || payload === null || !("resultId" in payload) || !("metrics" in payload)) throw new Error("Backtest response was malformed.");
      setBacktest(payload as BacktestResult);
      setWorkspace("backtest");
      setDockTab("backtest");
      setLastAction(null);
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : "Backtest failed.";
      setBacktestError(message);
      setLastAction(null);
    } finally {
      setRunning(false);
    }
  }, [symbol, timeframe, strategyId, parameters, config, setBacktest, setWorkspace, setDockTab]);

  const handleVisibleRange = useCallback((range: { from: number | null; to: number | null }): void => {
    setVisibleRange(range);
  }, [setVisibleRange]);

  const refreshReplay = useCallback(async (id: string): Promise<void> => {
    const response = await fetch(`/api/replay/${encodeURIComponent(id)}`, { cache: "no-store" });
    const payload: unknown = await response.json();
    if (!response.ok) {
      const message = typeof payload === "object" && payload !== null && "error" in payload && typeof payload.error === "string" ? payload.error : "Replay session could not be loaded.";
      throw new Error(message);
    }
    const parsed = parseReplayEnvelope(payload);
    if (!parsed) throw new Error("Replay session response was malformed.");
    setReplaySession(parsed.session);
    setReplayPortfolio(parsed.portfolio ?? null);
    setReplayOrders(parsed.orders ?? []);
    const currentWorkspace = useWorkspaceStore.getState();
    if (currentWorkspace.symbol !== parsed.session.symbol) currentWorkspace.setSymbol(parsed.session.symbol);
    if (currentWorkspace.timeframe !== parsed.session.timeframe) currentWorkspace.setTimeframe(parsed.session.timeframe);
  }, []);

  useEffect(() => {
    if (!activeReplayId) return;
    void Promise.resolve().then(() => refreshReplay(activeReplayId)).catch((error: unknown) => {
      setReplayError(error instanceof Error ? error.message : "Replay session could not be restored.");
    });
  }, [activeReplayId, refreshReplay]);

  const startReplay = async (): Promise<void> => {
    setReplayBusy(true);
    setReplayError(null);
    setReplayPlaying(false);
    try {
      const response = await fetch("/api/replay", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ symbol, timeframe, endAt: new Date(replayStartAt).getTime(), limit: replayLimit }),
      });
      const payload: unknown = await response.json();
      if (!response.ok) {
        const message = typeof payload === "object" && payload !== null && "error" in payload && typeof payload.error === "string" ? payload.error : "Replay could not be started.";
        throw new Error(message);
      }
      const parsed = parseReplayEnvelope(payload);
      if (!parsed) throw new Error("Replay start response was malformed.");
      setReplaySession(parsed.session);
      setReplayPortfolio(parsed.portfolio ?? null);
      setReplayOrders([]);
      setActiveReplayId(parsed.session.id);
      setWorkspace("replay");
    } catch (error) {
      setReplayError(error instanceof Error ? error.message : "Replay could not be started.");
    } finally {
      setReplayBusy(false);
    }
  };

  const stepReplay = useCallback(async (): Promise<void> => {
    if (!replaySession || replaySession.status !== "active" || replayBusyRef.current) return;
    replayBusyRef.current = true;
    setReplayBusy(true);
    setReplayError(null);
    try {
      const response = await fetch(`/api/replay/${encodeURIComponent(replaySession.id)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "step" }),
      });
      const payload: unknown = await response.json();
      if (!response.ok) {
        const message = typeof payload === "object" && payload !== null && "error" in payload && typeof payload.error === "string" ? payload.error : "Replay step failed.";
        throw new Error(message);
      }
      const parsed = parseReplayEnvelope(payload);
      if (!parsed) throw new Error("Replay step response was malformed.");
      setReplaySession(parsed.session);
      if (typeof payload === "object" && payload !== null && "hasNext" in payload && payload.hasNext === false) {
        setReplayPlaying(false);
        setReplayError("No next completed bar is available yet. The replay cursor did not move.");
      }
    } catch (error) {
      setReplayPlaying(false);
      setReplayError(error instanceof Error ? error.message : "Replay step failed.");
    } finally {
      replayBusyRef.current = false;
      setReplayBusy(false);
    }
  }, [replaySession]);

  useEffect(() => {
    replayStepRef.current = stepReplay;
  }, [stepReplay]);

  useEffect(() => {
    if (!replayPlaying) return;
    const timer = window.setInterval(() => { void replayStepRef.current(); }, Math.max(100, Math.round(1_000 / replaySpeed)));
    return () => window.clearInterval(timer);
  }, [replayPlaying, replaySpeed]);

  const finishReplay = async (): Promise<void> => {
    if (!replaySession) return;
    setReplayBusy(true);
    setReplayPlaying(false);
    try {
      const response = await fetch(`/api/replay/${encodeURIComponent(replaySession.id)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "finish" }),
      });
      const payload: unknown = await response.json();
      if (!response.ok) throw new Error("Could not finish replay session.");
      const parsed = parseReplayEnvelope(payload);
      if (parsed) setReplaySession(parsed.session);
    } catch (error) {
      setReplayError(error instanceof Error ? error.message : "Could not finish replay session.");
    } finally {
      setReplayBusy(false);
    }
  };

  const placeReplayOrder = async (side: "buy" | "sell", quantity: number): Promise<void> => {
    if (!replaySession) return;
    setReplayBusy(true);
    setReplayError(null);
    try {
      const response = await fetch(`/api/replay/${encodeURIComponent(replaySession.id)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "order", requestId: globalThis.crypto.randomUUID(), side, quantity }),
      });
      const payload: unknown = await response.json();
      if (!response.ok) {
        const message = typeof payload === "object" && payload !== null && "error" in payload && typeof payload.error === "string" ? payload.error : "Replay order failed.";
        throw new Error(message);
      }
      if (typeof payload === "object" && payload !== null && "order" in payload && "portfolio" in payload) {
        const order = (payload as { order?: unknown }).order;
        const portfolio = (payload as { portfolio?: unknown }).portfolio;
        if (typeof order === "object" && order !== null && "clientOrderId" in order) {
          setReplayOrders((current) => [...current.filter((item) => item.clientOrderId !== (order as PaperOrder).clientOrderId), order as PaperOrder]);
        }
        if (typeof portfolio === "object" && portfolio !== null && "quoteBalance" in portfolio) setReplayPortfolio(portfolio as PaperPortfolio);
      }
    } catch (error) {
      setReplayError(error instanceof Error ? error.message : "Replay order failed. Refresh the session before retrying.");
    } finally {
      setReplayBusy(false);
    }
  };

  const resetReplay = (): void => {
    setReplayPlaying(false);
    setReplaySession(null);
    setReplayPortfolio(null);
    setReplayOrders([]);
    setReplayError(null);
    setActiveReplayId(null);
  };

  const resizeWatchlist = (delta: number): void => setLayout({ ...layout, watchlistWidth: Math.max(160, Math.min(360, layout.watchlistWidth + delta)) });
  const resizeInspector = (delta: number): void => setLayout({ ...layout, inspectorWidth: Math.max(240, Math.min(480, layout.inspectorWidth - delta)) });
  const resizeDock = (delta: number): void => setLayout({ ...layout, bottomHeight: Math.max(150, Math.min(480, layout.bottomHeight + delta)) });

  const workspaceName = useMemo(() => ({ terminal: "Terminal", research: "Research", backtest: "Backtest", replay: "Replay" }[workspace]), [workspace]);
  const replayLocked = workspace === "replay" && replaySession !== null;
  const replayBars = workspace === "replay" ? replaySession?.bars ?? EMPTY_REPLAY_BARS : null;
  const replayPrice = replaySession?.bars.at(-1)?.close ?? null;

  return <div className="application-shell">
    <WorkspaceSync />
    <header className="topbar">
      <div className="brand-lockup"><div className="brand-mark"><Activity size={16} strokeWidth={2.4} /></div><span>newBeing</span><span className="workspace-label">WORKSPACE</span></div>
      <div className="topbar-divider" />
      <nav className="workspace-nav" aria-label="Workspaces">
        {(["terminal", "research", "backtest", "replay"] as const).map((item) => <button key={item} className={`workspace-tab ${workspace === item ? "active" : ""}`} onClick={() => setPage(item)}>{item}</button>)}
      </nav>
      <div className="topbar-spacer" />
      <SymbolPicker disabled={replayLocked} />
      <div className="topbar-divider narrow-divider" />
      <div className="timeframe-selector" aria-label="Timeframe">
        {TIMEFRAMES.map((item) => <button key={item} disabled={replayLocked} className={timeframe === item ? "active" : ""} onClick={() => useWorkspaceStore.getState().setTimeframe(item)}>{item}</button>)}
      </div>
      <div className="topbar-divider narrow-divider" />
      <div className="exchange-select"><span className="exchange-logo">B</span><span>Binance Spot</span><ChevronDown size={12} /></div>
      <span className="mode-pill"><i />PAPER</span>
      <Button variant="ghost" size="icon" title="Live trading disabled" disabled aria-label="Live trading disabled"><span className="live-off">LIVE OFF</span></Button>
      <Button variant="ghost" size="icon" title="Toggle theme" aria-label="Toggle theme" onClick={() => setTheme(theme === "dark" ? "light" : "dark")}>{theme === "dark" ? <Sun size={15} /> : <Moon size={15} />}</Button>
      <Button variant="ghost" size="icon" title="Reset layout" aria-label="Reset layout" onClick={() => setLayout({ watchlistWidth: 220, inspectorWidth: 300, bottomHeight: 224 })}><LayoutDashboard size={15} /></Button>
    </header>

    <div className="market-heading">
      <div className="market-title"><span className="base-symbol">{symbol.split("/")[0]}</span><span className="quote-symbol">/ {symbol.split("/")[1]}</span><span className="spot-tag">SPOT</span><span className="ticker-chevron"><ChevronDown size={13} /></span></div>
      <MarketSummaryBar summary={workspace === "replay" ? null : summary} error={workspace === "replay" ? null : summaryError} replayMode={workspace === "replay"} replayPrice={replayPrice} />
      <div className="market-heading-right"><span className="exchange-time">{workspace === "replay" && replaySession?.bars.at(-1) ? `Cursor ${new Date(replaySession.cursor).toLocaleTimeString()}` : summary?.timestamp ? `Updated ${new Date(summary.timestamp).toLocaleTimeString()}` : "Awaiting ticker"}</span></div>
    </div>

    <main className="workspace-grid" style={{ gridTemplateColumns: `${layout.watchlistWidth}px 5px minmax(380px, 1fr) 5px ${layout.inspectorWidth}px`, gridTemplateRows: `minmax(0, 1fr) 5px ${layout.bottomHeight}px` }}>
      <div className="left-rail" style={{ gridColumn: 1, gridRow: "1 / 4" }}><Watchlist disabled={replayLocked} /></div>
      <DragHandle direction="horizontal" onDelta={resizeWatchlist} style={{ gridColumn: 2, gridRow: "1 / 4" }} />
      <section className="chart-column" style={{ gridColumn: 3, gridRow: 1 }}>
        <div className="chart-toolbar">
          <div className="chart-toolbar-left"><span className="section-kicker">{workspaceName.toUpperCase()}</span><span className="toolbar-separator">/</span><span>{symbol} · {timeframe}</span>{result && <span className="signal-chip">{result.trades.length} signals</span>}</div>
          <div className="chart-toolbar-right">
            {running ? <span className="run-status"><LoaderCircle size={13} className="spin" />{lastAction ?? "Running…"}</span> : lastAction && <span className="run-status">{lastAction}</span>}
            {workspace !== "replay" && <Button variant="primary" size="sm" onClick={() => void runBacktest()} disabled={running}><Command size={13} />Run backtest</Button>}
          </div>
        </div>
        {backtestError && <div className="global-alert"><span>{backtestError}</span><button onClick={() => setBacktestError(null)} aria-label="Dismiss"><X size={14} /></button></div>}
        {workspace === "replay" && <ReplayControls
          symbol={symbol}
          timeframe={timeframe}
          session={replaySession}
          startAt={replayStartAt}
          limit={replayLimit}
          speed={replaySpeed}
          playing={replayPlaying}
          busy={replayBusy}
          error={replayError}
          onStartAtChange={setReplayStartAt}
          onLimitChange={setReplayLimit}
          onSpeedChange={setReplaySpeed}
          onStart={() => void startReplay()}
          onTogglePlay={() => { setReplayError(null); setReplayPlaying((playing) => !playing); }}
          onStep={() => void stepReplay()}
          onFinish={() => void finishReplay()}
          onNewSession={resetReplay}
        />}
        <MarketChart backtest={workspace === "replay" ? null : result} replayBars={replayBars} onRangeChange={handleVisibleRange} />
      </section>
      <DragHandle direction="horizontal" onDelta={resizeInspector} style={{ gridColumn: 4, gridRow: "1 / 4" }} />
      <div style={{ gridColumn: 5, gridRow: "1 / 4", minHeight: 0 }}><Inspector
        summary={workspace === "replay" ? null : summary}
        result={workspace === "replay" ? null : result}
        running={running}
        replayMode={workspace === "replay"}
        replaySession={replaySession}
        replayPortfolio={replayPortfolio}
        replayOrders={replayOrders}
        replayBusy={replayBusy}
        onRun={() => void runBacktest()}
        onReplayOrder={placeReplayOrder}
      /></div>
      <DragHandle direction="vertical" onDelta={resizeDock} style={{ gridColumn: 3, gridRow: 2 }} />
      <div className="dock-slot" style={{ gridColumn: 3, gridRow: 3 }}><BottomDock replayMode={workspace === "replay"} replaySession={replaySession} replayPortfolio={replayPortfolio} replayOrders={replayOrders} /></div>
    </main>
    <footer className="statusbar"><div><i className="status-dot" /><span>LOCAL WORKSPACE</span><span className="footer-separator">·</span><span>{symbol} · {timeframe}</span></div><div><span>{workspace === "replay" ? "REPLAY CURSOR DATA" : "PUBLIC MARKET DATA"}</span><span className="footer-separator">·</span><span>LIVE EXECUTION DISABLED</span><span className="footer-separator">·</span><span>LOCAL SQLITE</span></div></footer>
  </div>;
}
