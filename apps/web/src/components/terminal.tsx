"use client";

import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import {
  Activity,
  ChevronDown,
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
import { Decoded } from "@/components/decoded";
import { WATCHLIST_DRAG_TYPE } from "@/components/watchlist";
import { WorkspaceSync } from "@/components/workspace-sync";
import { Button } from "@/components/ui/button";
import { EXCHANGE_LABELS } from "@/lib/exchanges";
import { useWorkspaceStore } from "@/store/workspace";
import { useShallow } from "zustand/react/shallow";
import { EXCHANGE_TIMEFRAMES, type ReplayConfig, type ReplayExecution, type ReplayOrderInput, type BacktestResult, type Candle, type PaperOrder, type PaperPortfolio, type ReplaySession, type Timeframe, type WorkspaceState } from "@newbeing/core";
import type { MarketSummary, MarketSymbol } from "@newbeing/market-data/types";

const TIMEFRAMES: readonly Timeframe[] = ["1m", "5m", "15m", "30m", "1h", "4h", "1d"];
const EMPTY_REPLAY_BARS: readonly Candle[] = [];

// What each system in the rail is for. Keeps the rail informative now that
// the top bar owns workspace switching.
const RAIL_NOTES: Record<WorkspaceState["activeWorkspace"], string> = {
  terminal: "Live public quotes, chart, and paper order previews.",
  research: "Tune a strategy and read its deterministic run results.",
  replay: "Walk historical bars forward with future data hidden.",
};

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
  execution?: ReplayExecution | null;
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


function useSummary(symbol: string, exchange: WorkspaceState["exchange"], enabled: boolean): { summary: MarketSummary | null; error: string | null; retry: () => void } {
  const key = `${exchange}|${symbol}`;
  const [snapshot, setSnapshot] = useState<{ key: string; summary: MarketSummary | null; error: string | null } | null>(null);
  const [retryToken, setRetryToken] = useState(0);
  useEffect(() => {
    if (!enabled) return;
    let disposed = false;
    const refresh = async (): Promise<void> => {
      try {
        const response = await fetch(`/api/market?kind=summary&exchange=${exchange}&symbol=${encodeURIComponent(symbol)}`, { cache: "no-store" });
        const payload: unknown = await response.json();
        if (!response.ok) throw new Error(`${exchange} ticker unavailable.`);
        const parsed = parseSummary(payload);
        if (!parsed) throw new Error("Invalid market summary.");
        if (!disposed) setSnapshot({ key, summary: parsed, error: null });
      } catch (reason) {
        if (!disposed) setSnapshot((current) => ({ key, summary: current?.key === key ? current.summary : null, error: reason instanceof Error ? reason.message : "Market summary unavailable." }));
      }
    };
    void refresh();
    const timer = window.setInterval(() => void refresh(), exchange === "binance" ? 5_000 : 15_000);
    return () => { disposed = true; window.clearInterval(timer); };
  }, [symbol, exchange, enabled, key, retryToken]);
  return {
    ...(enabled && snapshot?.key === key ? { summary: snapshot.summary, error: snapshot.error } : { summary: null, error: null }),
    retry: () => setRetryToken((current) => current + 1),
  };
}

function SymbolPicker({ disabled = false }: { disabled?: boolean }): React.JSX.Element {
  const [symbol, exchange, setSymbol, addWatchlist] = useWorkspaceStore(useShallow((state) => [state.symbol, state.exchange, state.setSymbol, state.addWatchlistSymbol]));
  const [query, setQuery] = useState(symbol);
  const [open, setOpen] = useState(false);
  const [searchResult, setSearchResult] = useState<{ query: string; exchange: WorkspaceState["exchange"]; items: MarketSymbol[]; error: string | null } | null>(null);
  const [loading, setLoading] = useState(false);
  useEffect(() => {
    if (!open || query.trim().length < 1) return;
    let disposed = false;
    const timer = window.setTimeout(() => {
      setLoading(true);
      void fetch(`/api/markets?exchange=${exchange}&q=${encodeURIComponent(query)}`, { cache: "no-store" }).then(async (response) => {
        const payload: unknown = await response.json();
        if (!response.ok) throw new Error(`${EXCHANGE_LABELS[exchange]} symbol search is unavailable.`);
        if (!disposed) setSearchResult({ query, exchange, items: readItems<MarketSymbol>(payload), error: null });
      }).catch((reason: unknown) => {
        if (!disposed) setSearchResult({ query, exchange, items: [], error: reason instanceof Error ? reason.message : "Search failed." });
      }).finally(() => { if (!disposed) setLoading(false); });
    }, 180);
    return () => { disposed = true; window.clearTimeout(timer); };
  }, [query, open, exchange]);

  const result = searchResult?.query === query && searchResult.exchange === exchange ? searchResult : null;
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
      <input aria-label={`Search ${exchange} Spot symbols`} disabled={disabled} value={open ? query : symbol} onFocus={() => { if (!disabled) { setOpen(true); setQuery(""); } }} onChange={(event) => setQuery(event.target.value)} onKeyDown={(event) => {
        if (event.key === "Escape") { setOpen(false); setQuery(symbol); }
        if (event.key === "Enter" && items[0]) choose(items[0].symbol);
      }} placeholder="Search market" />
      <ChevronDown size={12} className="search-chevron" />
    </div>
    {open && <>
      <button className="popover-backdrop" aria-label="Close symbol search" onClick={() => { setOpen(false); setQuery(symbol); }} />
      <div className="symbol-results">
        <div className="popover-title">{EXCHANGE_LABELS[exchange].toUpperCase()} · SPOT MARKETS</div>
        {showLoading && <div className="popover-state"><LoaderCircle className="spin" size={14} />Searching markets…</div>}
        {error && <div className="popover-error">{error}</div>}
        {!showLoading && !error && items.map((item) => <button
          className="symbol-result"
          key={item.symbol}
          draggable
          onDragStart={(event) => {
            event.dataTransfer.effectAllowed = "copy";
            event.dataTransfer.setData(WATCHLIST_DRAG_TYPE, item.symbol);
            event.dataTransfer.setData("text/plain", item.symbol);
          }}
          title="Click to open · drag into the watchlist to add"
          onClick={() => choose(item.symbol)}
        >
          <span className="symbol-result-pair"><strong>{item.base}</strong><small>/ {item.quote}</small></span><span className="result-quote">{item.quote}<ChevronDown size={12} /></span>
        </button>)}
        {!showLoading && !error && query.trim().length > 0 && items.length === 0 && <div className="popover-state">No active spot pair for “{query.trim().toUpperCase()}” on {EXCHANGE_LABELS[exchange]}.</div>}
      </div>
    </>}
  </div>;
}

function MarketSummaryBar({ summary, error, replayMode, replayPrice, subject, onRetry }: { summary: MarketSummary | null; error: string | null; replayMode: boolean; replayPrice: number | null; subject: string; onRetry: () => void }): React.JSX.Element {
  const change = summary?.changePct24h;
  /* Switching the subject must not leave the plate on an em-dash: the readout
     rolls as noise and decodes into the real value when it arrives. */
  const last = formatPrice(replayMode ? replayPrice : summary?.last);
  const changeText = typeof change === "number" ? `${change >= 0 ? "+" : ""}${change.toFixed(2)}%` : "—";
  return <div className={`summary-strip ${error && summary ? "stale" : ""}`}>
    <div className="summary-price"><span>{replayMode ? "CURSOR CLOSE" : "LAST"}</span><Decoded className="decoded-price" value={last} trigger={subject} />{!replayMode && <small className={typeof change === "number" && change >= 0 ? "positive" : "negative"}><Decoded value={changeText} trigger={`${subject}|chg`} /></small>}</div>
    {!replayMode && <><div><span>24H HIGH</span><Decoded className="decoded-stat" value={formatPrice(summary?.high24h)} trigger={`${subject}|hi`} /></div>
      <div><span>24H LOW</span><Decoded className="decoded-stat" value={formatPrice(summary?.low24h)} trigger={`${subject}|lo`} /></div>
      <div><span>24H QUOTE VOL</span><Decoded className="decoded-stat" value={typeof summary?.quoteVolume24h === "number" ? `${(summary.quoteVolume24h / 1_000_000).toFixed(2)}M` : "—"} trigger={`${subject}|vol`} /></div></>}
    <div className="summary-source">{replayMode ? "HISTORICAL ONLY · NO LIVE QUOTES" : error ? <><span className="negative">{summary ? "STALE · RETRYING" : "Ticker unavailable"}</span><button className="summary-retry link-button" type="button" aria-label="Retry ticker request" onClick={onRetry}>Retry</button></> : null}</div>
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


/* ══ Rail readouts ══════════════════════════════════════════════════════════
   The rail is 269×694. Four key/value pairs left 86% of it empty. Each
   workspace now fills that column with the data it actually acts on — all of it
   derived from existing state, nothing fabricated. */

function RailRunHistory(): React.JSX.Element {
  const [activeBacktestId, selectedStrategyId, setDockTab] = useWorkspaceStore(useShallow((state) => [
    state.activeBacktestId, state.selectedStrategyId, state.setDockTab,
  ]));
  /* Field names must match BacktestMetrics exactly: it exposes `totalReturn`
     as a FRACTION (e.g. -0.0293), not `totalReturnPct`. Reading a name that
     does not exist made every row render "—" while the data was right there. */
  const [items, setItems] = useState<Array<{ id: string; strategyId?: string; createdAt?: string; metrics?: { totalReturn?: number; tradeCount?: number } }>>([]);
  const [state, setState] = useState<"loading" | "ready" | "blocked" | "error">("loading");

  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const res = await fetch("/api/backtests");
        /* 409 = the server is holding history back because the workspace is in
           Replay. That is a deliberate boundary, not an empty history. */
        if (res.status === 409) { if (alive) setState("blocked"); return; }
        if (!res.ok) throw new Error(String(res.status));
        const body = await res.json();
        const list = Array.isArray(body) ? body : body.items ?? body.results ?? [];
        if (alive) { setItems(list.slice(0, 20)); setState("ready"); }
      } catch { if (alive) setState("error"); }
    })();
    return () => { alive = false; };
  }, []);

  return <div className="rail-block">
    <span className="rail-block-head">RUN HISTORY <b>{items.length || "—"}</b></span>
    {state === "loading" && <span className="rail-hint">Loading local runs…</span>}
    {state === "blocked" && <span className="rail-hint">History is withheld while a Replay session is active, so future-derived results cannot leak. Leave Replay to see saved runs.</span>}
    {state === "error" && <span className="rail-hint">Local history unavailable.</span>}
    {state === "ready" && items.length === 0 && <span className="rail-hint">No saved runs yet. Run a backtest to fill this list.</span>}
    <div className="rail-list">
      {items.map((run) => <button
        key={run.id}
        type="button"
        className={`rail-item ${activeBacktestId === run.id ? "is-active" : ""}`}
        onClick={() => setDockTab("backtest")}
      >
        <span className="rail-item-main">{(run.strategyId ?? selectedStrategyId).replace(/-/g, " ")}</span>
        <span className="rail-item-meta">
          {typeof run.metrics?.totalReturn === "number"
            ? <em className={run.metrics.totalReturn >= 0 ? "positive" : "negative"}>
                {run.metrics.totalReturn >= 0 ? "+" : "−"}{(Math.abs(run.metrics.totalReturn) * 100).toFixed(2)}%
              </em>
            : <em className="muted">—</em>}
          <small>{run.metrics?.tradeCount ?? 0} trades</small>
        </span>
      </button>)}
    </div>
  </div>;
}

function RailStrategyRoster(): React.JSX.Element {
  const [selectedStrategyId, parameters, setStrategy, setInspectorTab] = useWorkspaceStore(useShallow((state) => [
    state.selectedStrategyId, state.strategyParameters, state.setStrategy, state.setInspectorTab,
  ]));
  const [items, setItems] = useState<Array<{ id: string; name?: string; description?: string }>>([]);

  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const res = await fetch("/api/strategies");
        if (!res.ok) return;
        const body = await res.json();
        const list = Array.isArray(body) ? body : body.items ?? [];
        if (alive) setItems(list);
      } catch { /* the select in the inspector still works without this list */ }
    })();
    return () => { alive = false; };
  }, []);

  const params = Object.entries(parameters ?? {});

  return <>
    <div className="rail-block">
      <span className="rail-block-head">STRATEGIES <b>{items.length || "—"}</b></span>
      {items.length === 0 && <span className="rail-hint">Loading built-in strategies…</span>}
      <div className="rail-list">
        {items.map((s) => <button
          key={s.id}
          type="button"
          className={`rail-item ${selectedStrategyId === s.id ? "is-active" : ""}`}
          onClick={() => { setStrategy(s.id, {}); setInspectorTab("strategy"); }}
        >
          <span className="rail-item-main">{s.name ?? s.id}</span>
          <span className="rail-item-sub">{s.id}</span>
        </button>)}
      </div>
    </div>

    {/* what the selected strategy actually does — same values the inspector edits */}
    {params.length > 0 && <div className="rail-block">
      <span className="rail-block-head">PARAMETERS</span>
      <div className="rail-facts compact">
        {params.map(([key, value]) => <span key={key}>
          <em>{key.replace(/([A-Z])/g, " $1").trim()}</em>
          <strong>{typeof value === "boolean" ? (value ? "ON" : "OFF") : String(value)}</strong>
        </span>)}
      </div>
    </div>}
  </>;
}

function RailReplayState({ session, playing, speed }: { session: ReplaySession | null; playing: boolean; speed: number }): React.JSX.Element {
  const bars = session?.bars ?? [];
  const first = bars[0];
  const last = bars.at(-1);
  const range = first && last
    ? `${new Date(first.timestamp).toISOString().slice(5, 16).replace("T", " ")} → ${new Date(last.timestamp).toISOString().slice(5, 16).replace("T", " ")}`
    : null;

  return <div className="rail-block">
    <span className="rail-block-head">SESSION</span>
    <div className="rail-facts compact">
      <span><em>STATE</em><strong className={playing ? "positive" : ""}>{session ? (playing ? "PLAYING" : "PAUSED") : "IDLE"}</strong></span>
      <span><em>BARS</em><strong>{bars.length || "—"}</strong></span>
      <span><em>SPEED</em><strong>{speed}×</strong></span>
      {range && <span><em>WINDOW</em><strong className="rail-range">{range}</strong></span>}
      <span><em>ISOLATION</em><strong>NO LIVE QUOTES</strong></span>
    </div>
    {!session && <span className="rail-hint">Start a session from the transport bar to load bars.</span>}
  </div>;
}

export function Terminal(): React.JSX.Element {
  const exchange = useWorkspaceStore((state) => state.exchange);
  const [workspace, setWorkspace, symbol, timeframe, theme, setTheme, layout, setLayout, visibleRange, setVisibleRange, setBacktest, setDockTab, strategyId, parameters, config, activeReplayId, setActiveReplayId] = useWorkspaceStore(useShallow((state) => [
    state.activeWorkspace, state.setWorkspace, state.symbol, state.timeframe, state.theme, state.setTheme, state.layout, state.setLayout,
    state.visibleRange, state.setVisibleRange, state.setBacktest, state.setDockTab, state.selectedStrategyId, state.strategyParameters, state.backtestConfig,
    state.activeReplayId, state.setActiveReplayId,
  ]));
  // The nav paints from the urgent workspace value. The chart and the dock
  // remount from a deferred copy, so React commits the tab colour first
  // instead of paying for a chart teardown in the same frame as the click.
  const deferredWorkspace = useDeferredValue(workspace);
  const { summary, error: summaryError, retry: retrySummary } = useSummary(symbol, exchange, workspace !== "replay");
  const [running, setRunning] = useState(false);
  const [backtestError, setBacktestError] = useState<string | null>(null);
  const [lastAction, setLastAction] = useState<string | null>(null);
  const result = useWorkspaceStore((state) => state.backtest);
  const [replayExecution, setReplayExecution] = useState<ReplayExecution | null>(null);
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
    /* No venue gate: every supported exchange can serve backtests and replays. */
    if (next !== "replay") setReplayPlaying(false);
    setWorkspace(next);
    /* Research is where strategies are studied, so entering it should land on
       the parameter form. The results board is one tab away in the dock. */
    if (next === "research") {
      useWorkspaceStore.getState().setInspectorTab("strategy");
      setDockTab("backtest");
    }
  };

  const runBacktest = useCallback(async (): Promise<void> => {
    setRunning(true);
    setBacktestError(null);
    setLastAction(`Fetching ${EXCHANGE_LABELS[exchange]} bars and running the event loop…`);
    try {
      const response = await fetch("/api/backtests", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          /* Send the venue explicitly: the workspace carries one, but naming it
             on the request makes the run traceable to its own source. */
          exchange,
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
    /* Stay in Research and surface the result: one system for parameters and
       outcomes, rather than being thrown into a separate mode to read them. */
    setWorkspace("research");
    setDockTab("backtest");
      setLastAction(null);
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : "Backtest failed.";
      setBacktestError(message);
      setLastAction(null);
    } finally {
      setRunning(false);
    }
  }, [exchange, symbol, timeframe, strategyId, parameters, config, setBacktest, setWorkspace, setDockTab]);

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
      setReplayExecution(parsed.execution ?? null);
    setReplayPortfolio(parsed.portfolio ?? null);
    setReplayOrders(parsed.orders ?? []);
    const currentWorkspace = useWorkspaceStore.getState();
    if (currentWorkspace.exchange !== parsed.session.exchange) currentWorkspace.setExchange(parsed.session.exchange);
    if (useWorkspaceStore.getState().symbol !== parsed.session.symbol) useWorkspaceStore.getState().setSymbol(parsed.session.symbol);
    if (useWorkspaceStore.getState().timeframe !== parsed.session.timeframe) useWorkspaceStore.getState().setTimeframe(parsed.session.timeframe);
  }, []);

  useEffect(() => {
    if (!activeReplayId) return;
    void Promise.resolve().then(() => refreshReplay(activeReplayId)).catch((error: unknown) => {
      setReplayError(error instanceof Error ? error.message : "Replay session could not be restored.");
    });
  }, [activeReplayId, refreshReplay]);

  const startReplayFromBacktest = async (backtest: BacktestResult): Promise<void> => {
    const finalPoint = backtest.equityCurve.at(-1);
    if (!finalPoint) return;
    setReplayBusy(true);
    setReplayError(null);
    setReplayPlaying(false);
    try {
      const response = await fetch("/api/replay", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ exchange: backtest.exchange, symbol: backtest.symbol, timeframe: backtest.timeframe, endAt: finalPoint.timestamp, limit: 200 }),
      });
      const payload: unknown = await response.json();
      if (!response.ok) {
        const message = typeof payload === "object" && payload !== null && "error" in payload && typeof payload.error === "string" ? payload.error : "Replay could not be started.";
        throw new Error(message);
      }
      const parsed = parseReplayEnvelope(payload);
      if (!parsed) throw new Error("Replay start response was malformed.");
      setReplaySession(parsed.session);
      setReplayExecution(parsed.execution ?? null);
      setReplayPortfolio(parsed.portfolio ?? null);
      setReplayOrders([]);
      const store = useWorkspaceStore.getState();
      store.setExchange(parsed.session.exchange);
      store.setSymbol(parsed.session.symbol);
      store.setTimeframe(parsed.session.timeframe);
      setActiveReplayId(parsed.session.id);
      setWorkspace("replay");
    } catch (error) {
      setReplayError(error instanceof Error ? error.message : "Replay could not be started.");
    } finally {
      setReplayBusy(false);
    }
  };
  const startReplay = async (replayConfig?: ReplayConfig): Promise<void> => {
    setReplayBusy(true);
    setReplayError(null);
    setReplayPlaying(false);
    try {
      const response = await fetch("/api/replay", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ exchange, symbol, timeframe, endAt: new Date(replayStartAt).getTime(), limit: replayLimit, ...replayConfig }),
      });
      const payload: unknown = await response.json();
      if (!response.ok) {
        const message = typeof payload === "object" && payload !== null && "error" in payload && typeof payload.error === "string" ? payload.error : "Replay could not be started.";
        throw new Error(message);
      }
      const parsed = parseReplayEnvelope(payload);
      if (!parsed) throw new Error("Replay start response was malformed.");
      setReplaySession(parsed.session);
      setReplayExecution(parsed.execution ?? null);
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
        body: JSON.stringify({ action: "step", expectedCursor: replaySession.cursor, expectedRevision: replayExecution?.revision }),
      });
      const payload: unknown = await response.json();
      if (!response.ok) {
        if (response.status === 409) await refreshReplay(replaySession.id);
        const message = typeof payload === "object" && payload !== null && "error" in payload && typeof payload.error === "string" ? payload.error : "Replay step failed.";
        throw new Error(message);
      }
      const parsed = parseReplayEnvelope(payload);
      if (!parsed) throw new Error("Replay step response was malformed.");
      setReplaySession(parsed.session);
      setReplayExecution(parsed.execution ?? null);
      setReplayPortfolio(parsed.portfolio ?? null);
      setReplayOrders(parsed.orders ?? []);
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
  }, [replaySession, replayExecution, refreshReplay]);

  useEffect(() => {
    replayStepRef.current = stepReplay;
  }, [stepReplay]);

  useEffect(() => {
    if (!replayPlaying) return;
    const timer = window.setInterval(() => { void replayStepRef.current(); }, Math.max(100, Math.round(1_000 / replaySpeed)));
    return () => window.clearInterval(timer);
  }, [replayPlaying, replaySpeed]);

  const finishReplay = async (): Promise<void> => {
    if (!replaySession || replayBusyRef.current) return;
    replayBusyRef.current = true;
    setReplayBusy(true);
    setReplayPlaying(false);
    try {
      const response = await fetch(`/api/replay/${encodeURIComponent(replaySession.id)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "finish", expectedRevision: replayExecution?.revision }),
      });
      const payload: unknown = await response.json();
      if (!response.ok) {
        if (response.status === 409) await refreshReplay(replaySession.id);
        throw new Error(typeof payload === "object" && payload !== null && "error" in payload ? String(payload.error) : "Could not finish replay session.");
      }
      const parsed = parseReplayEnvelope(payload);
      if (parsed) {
        setReplaySession(parsed.session);
        setReplayExecution(parsed.execution ?? null);
        setReplayPortfolio(parsed.portfolio ?? null);
        setReplayOrders(parsed.orders ?? []);
      }
    } catch (error) {
      setReplayError(error instanceof Error ? error.message : "Could not finish replay session.");
    } finally {
      replayBusyRef.current = false;
      setReplayBusy(false);
    }
  };

  const replayCommand = async (command: Record<string, unknown>): Promise<void> => {
    if (!replaySession || replayBusyRef.current) return;
    replayBusyRef.current = true;
    setReplayBusy(true);
    setReplayPlaying(false);
    setReplayError(null);
    try {
      const response = await fetch(`/api/replay/${encodeURIComponent(replaySession.id)}`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...command, expectedRevision: replayExecution?.revision }),
      });
      const payload: unknown = await response.json();
      if (!response.ok) {
        if (response.status === 409) await refreshReplay(replaySession.id);
        throw new Error(typeof payload === "object" && payload !== null && "error" in payload ? String(payload.error) : "Replay action failed.");
      }
      await refreshReplay(replaySession.id);
    } catch (error) {
      setReplayError(error instanceof Error ? error.message : "Replay action failed. Reload before retrying.");
      throw error;
    } finally {
      replayBusyRef.current = false;
      setReplayBusy(false);
    }
  };
  const placeReplayOrder = async (side: "buy" | "sell", quantity: number, options?: Partial<ReplayOrderInput>): Promise<void> => {
    await replayCommand({ action: "order", requestId: globalThis.crypto.randomUUID(), ...options, side, quantity });
  };

  const resetReplay = (): void => {
    setReplayPlaying(false);
    setReplaySession(null);
    setReplayExecution(null);
    setReplayPortfolio(null);
    setReplayOrders([]);
    setReplayError(null);
    setActiveReplayId(null);
  };

  const resizeWatchlist = (delta: number): void => setLayout({ ...layout, watchlistWidth: Math.max(160, Math.min(360, layout.watchlistWidth + delta)) });
  const resizeInspector = (delta: number): void => setLayout({ ...layout, inspectorWidth: Math.max(240, Math.min(480, layout.inspectorWidth - delta)) });
  const resizeDock = (delta: number): void => setLayout({ ...layout, bottomHeight: Math.max(150, Math.min(480, layout.bottomHeight + delta)) });

  const workspaceName = useMemo(() => ({ terminal: "Terminal", research: "Research", replay: "Replay" }[workspace]), [workspace]);
  const replayLocked = workspace === "replay";
  const replayBars = workspace === "replay" ? replaySession?.bars ?? EMPTY_REPLAY_BARS : null;
  const replayPrice = replaySession?.bars.at(-1)?.close ?? null;
  /* Each workspace is a different room, not the same room in another colour.
     Reference: Arknights recomposes the canvas per system instead of relabelling
     one grid. The watchlist is a Markets instrument; research/backtest/replay
     give that width back to the chart. */
  const showsWatchlist = workspace === "terminal";
  const gridColumns = showsWatchlist
    ? `${layout.watchlistWidth}px 5px minmax(0, 1fr) 5px ${layout.inspectorWidth}px`
    : `minmax(0, 1fr) 5px ${workspace === "research"
        ? Math.max(layout.inspectorWidth, 380)
        : Math.max(layout.inspectorWidth, 320)}px`;

  /* Column indices shift when the watchlist is absent, so children ask for a
     slot by role instead of a hardcoded number. */
  const col = showsWatchlist
    ? { rail: 1, railDrag: 2, chart: 3, inspectorDrag: 4, inspector: 5 }
    : { rail: 0, railDrag: 0, chart: 1, inspectorDrag: 2, inspector: 3 };

  /* Analysis modes need a taller dock: the result table is the product there.
     Research inherited Backtest's taller dock along with its results board. */
  const dockHeight = workspace === "research" ? Math.max(layout.bottomHeight, 320)
    : workspace === "replay" ? Math.max(layout.bottomHeight, 210)
    : layout.bottomHeight;

  return <div className={`application-shell mode-${workspace}`} data-ak-ui="system" data-theme={theme === "light" ? "light" : undefined}>
    <WorkspaceSync />
    <header className="topbar">
      <div className="brand-lockup"><div className="brand-mark"><Activity size={16} strokeWidth={2.4} /></div><span>newBeing</span><span className="workspace-label">MARKET INTELLIGENCE</span></div>
      <div className="topbar-divider" />
      <nav className="workspace-nav" aria-label="Workspaces">
        {([ ["terminal", "Markets"], ["research", "Research"], ["replay", "Replay"] ] as const).map(([item, label]) => <button key={item} data-testid={`workspace-${item}`} className={`workspace-tab ${workspace === item ? "active" : ""}`} onClick={() => setPage(item)}>{label}</button>)}
      </nav>
      <div className="topbar-spacer" />
      <SymbolPicker disabled={replayLocked} />
      <div className="topbar-divider narrow-divider" />
      <div className="timeframe-selector" aria-label="Timeframe">
        {TIMEFRAMES.map((item) => <button key={item} disabled={replayLocked || !EXCHANGE_TIMEFRAMES[exchange].includes(item)} className={timeframe === item ? "active" : ""} onClick={() => useWorkspaceStore.getState().setTimeframe(item)}>{item}</button>)}
      </div>
      <div className="topbar-divider narrow-divider" />
      <label className="exchange-select"><span className="exchange-logo">{exchange.slice(0, 1).toUpperCase()}</span><select aria-label="Exchange" value={exchange} disabled={replayLocked} onChange={(event) => useWorkspaceStore.getState().setExchange(event.target.value as WorkspaceState["exchange"])}><option value="binance">Binance Spot</option><option value="coinbaseexchange">Coinbase Exchange</option><option value="okx">OKX Spot</option><option value="kraken">Kraken Spot</option></select><ChevronDown size={12} /></label>
      {/* One status panel instead of a pill plus a button: the header reads
          like upstream's SYSTEM block, and the two facts it carries —
          paper execution, live trading off — stay visible and labelled. */}
      <div className="topbar-status" aria-label={`Execution mode: paper. Live trading disabled. Active workspace: ${workspaceName}.`}>
        <span className="topbar-status-mark" aria-hidden="true" />
        <span className="topbar-status-text">
          <em>{workspaceName.toUpperCase()}</em>
          <strong>PAPER · LIVE OFF</strong>
        </span>
      </div>
      <Button variant="ghost" size="icon" title="Toggle theme" aria-label="Toggle theme" onClick={() => setTheme(theme === "dark" ? "light" : "dark")}>{theme === "dark" ? <Sun size={15} /> : <Moon size={15} />}</Button>
      <Button variant="ghost" size="icon" title="Reset layout" aria-label="Reset layout" onClick={() => setLayout({ watchlistWidth: 210, inspectorWidth: 320, bottomHeight: 190 })}><LayoutDashboard size={15} /></Button>
    </header>

    <div className="market-heading" id="workspace-home">
      <div className="market-identity"><span className="market-eyebrow">{EXCHANGE_LABELS[exchange]} · SPOT MARKET</span><div className="market-title"><Decoded className="base-symbol" value={symbol.split("/")[0] ?? symbol} trigger={`sym|${symbol}`} /><span className="quote-symbol">/ <Decoded value={symbol.split("/")[1] ?? ""} trigger={`quote|${symbol}`} /></span><span className="spot-tag">{timeframe}</span><span className="ticker-chevron"><ChevronDown size={13} /></span></div></div>
      <MarketSummaryBar summary={workspace === "replay" ? null : summary} error={workspace === "replay" ? null : summaryError} replayMode={workspace === "replay"} replayPrice={replayPrice} subject={`${exchange}|${symbol}|${timeframe}|${workspace}`} onRetry={retrySummary} />
      <div className="market-heading-right"><span className="exchange-time">{workspace === "replay" && replaySession?.bars.at(-1) ? `Cursor ${new Date(replaySession.cursor).toLocaleTimeString()}` : summary?.timestamp ? `Updated ${new Date(summary.timestamp).toLocaleTimeString()}` : "Awaiting ticker"}</span><span className="market-source-tag"><i className={summaryError ? "warning-dot" : "live-dot"} />{workspace === "replay" ? "REPLAY DATA" : summaryError ? "DELAYED" : "PUBLIC MARKET DATA"}</span></div>
    </div>

    <main className={`workspace-layout mode-layout-${workspace}`}>
      {/* The top-bar nav already switches workspaces, so this rail is not a
          second nav. It states which system you are inside (with the mode
          signal) and what that system lets you do — the diegetic readout. */}
      <div className="primary-rail" aria-label="Active workspace">
        <span className="rail-caption">WORKSPACE</span>
        <div className={`rail-status ${workspace}`}>
          <span className="rail-status-head"><i />{workspaceName.toUpperCase()}</span>
          <span className="rail-status-note">{RAIL_NOTES[workspace]}</span>
        </div>

        {/* Every rail carries the data its workspace acts on, so no mode leaves
            a 694px column holding four lines.
            Research shows BOTH lists: choosing a strategy and reopening a past
            run are the two things you actually do while studying one, and they
            used to be split across two workspaces that each showed only one. */}
        {workspace === "research" && <>
          <RailStrategyRoster />
          <RailRunHistory />
        </>}
        {workspace === "replay" && <RailReplayState session={replaySession} playing={replayPlaying} speed={replaySpeed} />}

        <div className="rail-facts">
          <span><em>SYMBOL</em><strong>{symbol}</strong></span>
          <span><em>TIMEFRAME</em><strong>{timeframe}</strong></span>
          <span><em>VENUE</em><strong>{EXCHANGE_LABELS[exchange]}</strong></span>
          <span><em>MODE</em><strong>PAPER</strong></span>
        </div>
      </div>
      <section className="market-canvas" aria-label={`${workspaceName} market workspace`}>
        <div className="workspace-grid" style={{ gridTemplateColumns: gridColumns, gridTemplateRows: `minmax(0, 1fr) 5px ${dockHeight}px` }}>
      {showsWatchlist && <>
        <div className="left-rail" style={{ gridColumn: col.rail, gridRow: "1 / 4" }}><Watchlist disabled={replayLocked} /></div>
        <DragHandle direction="horizontal" onDelta={resizeWatchlist} style={{ gridColumn: col.railDrag, gridRow: "1 / 4" }} />
      </>}
      <section className="chart-column" style={{ gridColumn: col.chart, gridRow: 1 }}>
        <div className="chart-toolbar">
          <div className="chart-toolbar-left"><span className="section-kicker">01</span><span className="toolbar-separator">/</span><span>{workspaceName.toUpperCase()} · {symbol} · {timeframe}</span>{result && <span className="signal-chip">{result.trades.length} signals</span>}</div>
          {/* No run button here: the Strategy panel owns the parameters and
              carries the single Run action, so a second one up here would be
              a duplicate call to action. */}
          <div className="chart-toolbar-right">
            {running ? <span className="run-status"><LoaderCircle size={13} className="spin" />{lastAction ?? "Running…"}</span> : lastAction && <span className="run-status">{lastAction}</span>}
            {workspace === "terminal" && <Button variant="outline" size="sm" onClick={() => setPage("research")}>Research</Button>}
          </div>
        </div>
        {/* Every venue is fully usable now, so this states which source is in
            use rather than warning that something is missing. */}
        {exchange !== "binance" && <div className="global-alert" role="status">Charts, quotes, backtests, Replay and Paper orders all use {EXCHANGE_LABELS[exchange]} public market data.</div>}

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
          onStart={(replayConfig) => void startReplay(replayConfig)}
          onTogglePlay={() => { setReplayError(null); setReplayPlaying((playing) => !playing); }}
          onStep={() => void stepReplay()}
          onFinish={() => void finishReplay()}
          onNewSession={resetReplay}
        />}
        <MarketChart key={`${exchange}|${symbol}|${timeframe}|${deferredWorkspace}`} backtest={workspace === "replay" ? null : result} replayBars={replayBars} onRangeChange={handleVisibleRange} />
      </section>
      <DragHandle direction="horizontal" onDelta={resizeInspector} style={{ gridColumn: col.inspectorDrag, gridRow: "1 / 4" }} />
      <div style={{ gridColumn: col.inspector, gridRow: "1 / 4", minHeight: 0, display: "flex", flexDirection: "column" }} className="inspector-slot"><Inspector
        workspace={workspace}
        summary={workspace === "replay" ? null : summary}
        result={workspace === "replay" ? null : result}
        running={running}
        replayMode={workspace === "replay"}
        replaySession={replaySession}
        replayExecution={replayExecution}
        onReplayCommand={replayCommand}
        replayPortfolio={replayPortfolio}
        replayOrders={replayOrders}
        replayBusy={replayBusy}
        onRun={() => void runBacktest()}
        onReplayOrder={placeReplayOrder}
      /></div>
      <DragHandle direction="vertical" onDelta={resizeDock} style={{ gridColumn: col.chart, gridRow: 2 }} />
      <div className="dock-slot" style={{ gridColumn: col.chart, gridRow: 3 }}><BottomDock key={`${exchange}|${symbol}|${deferredWorkspace}`} workspace={workspace} replayMode={workspace === "replay"} replaySession={replaySession} replayPortfolio={replayPortfolio} replayOrders={replayOrders} onStartReplay={(backtest) => void startReplayFromBacktest(backtest)} replayBusy={replayBusy} replayError={replayError} /></div>
      </div>
      </section>
    </main>
    <nav className="mobile-mode-nav" aria-label="Workspace modes">
        {([["terminal", "Markets"], ["research", "Research"], ["replay", "Replay"]] as const).map(([item, label]) => <button key={item} type="button" aria-current={workspace === item ? "page" : undefined} className={workspace === item ? "active" : ""} onClick={() => setPage(item)}>{label}</button>)}
    </nav>
    <footer className="statusbar"><div><i className="status-dot" /><span>LOCAL WORKSPACE</span><span className="footer-separator">·</span><span>{symbol} · {timeframe}</span></div><div><span>{workspace === "replay" ? "REPLAY CURSOR DATA" : "PUBLIC MARKET DATA"}</span><span className="footer-separator">·</span><span>LIVE EXECUTION DISABLED</span><span className="footer-separator">·</span><span>LOCAL SQLITE</span></div></footer>
  </div>;
}
