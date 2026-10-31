"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { Fragment, memo, useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import {
  Activity,
  ChevronDown,
  HelpCircle,
  LayoutDashboard,
  LoaderCircle,
  Moon,
  PanelLeft,
  PanelLeftClose,
  Search,
  Sun,
  X,
  Radio,
  Sliders,
  Play,
  RotateCcw,
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
import { backtestReplayRequest } from "@/lib/backtest-replay";
import { applyReplaySelection, captureReplaySelection, captureWorkspaceSelection } from "@/lib/workspace-selection";
import { EXCHANGE_LABELS } from "@/lib/exchanges";
import { replayIdentity, useWorkspaceStore, type DockTab, type InspectorTab } from "@/store/workspace";
import { useShallow } from "zustand/react/shallow";
import {
  EXCHANGE_TIMEFRAMES,
  type ReplayConfig,
  type ReplayExecution,
  type ReplayOrderInput,
  type BacktestResult,
  type Candle,
  type PaperOrder,
  type PaperPortfolio,
  type ReplaySession,
  type Timeframe,
  type WorkspaceState,
} from "@newbeing/core";
import type { MarketSummary, MarketSymbol } from "@newbeing/market-data/types";
import { AkBrackets, AkCorner, AkTag, AkStatus, AkDisplay, AkBilingual, AkNum, AkDialog, AkNotice, AkSpinner, AkGlow } from "@swufefox/ak-ui-react";

const TIMEFRAMES: readonly Timeframe[] = ["1m", "5m", "15m", "30m", "1h", "4h", "1d"];
const EMPTY_REPLAY_BARS: readonly Candle[] = [];

// This cache also survives component remounts when sessionStorage is unavailable.
const replayOrderRequests = new Map<string, string | null>();
const REPLAY_ORDER_STORAGE_PREFIX = "newbeing:replay-order:v1:";

function replayOrderRequestId(key: string): string {
  const cached = replayOrderRequests.get(key);
  if (cached) return cached;

  if (cached !== null && typeof window !== "undefined") {
    try {
      const raw = window.sessionStorage.getItem(REPLAY_ORDER_STORAGE_PREFIX + key);
      const stored: unknown = raw ? JSON.parse(raw) : null;
      if (typeof stored === "object" && stored !== null && "key" in stored && stored.key === key
        && "requestId" in stored && typeof stored.requestId === "string"
        && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(stored.requestId)) {
        replayOrderRequests.set(key, stored.requestId);
        return stored.requestId;
      }
    } catch {
      // Storage may be blocked, unavailable, or contain invalid JSON.
    }
  }

  const requestId = globalThis.crypto.randomUUID();
  replayOrderRequests.set(key, requestId);
  if (typeof window !== "undefined") {
    try {
      window.sessionStorage.setItem(REPLAY_ORDER_STORAGE_PREFIX + key, JSON.stringify({ key, requestId }));
    } catch {
      // Keep the request ID in memory when persistence is unavailable.
    }
  }
  return requestId;
}

function clearReplayOrderRequest(key: string, requestId: string): void {
  if (replayOrderRequests.get(key) !== requestId) return;
  replayOrderRequests.set(key, null);
  if (typeof window !== "undefined") {
    try {
      window.sessionStorage.removeItem(REPLAY_ORDER_STORAGE_PREFIX + key);
    } catch {
      // The in-memory tombstone prevents reuse during this page's lifetime.
    }
  }
}

const RAIL_NOTES: Record<WorkspaceState["activeWorkspace"], string> = {
  terminal: "Live quotes, depth stream, and paper execution ticket.",
  research: "Parameter optimization, Monaco draft editor & deterministic backtesting.",
  replay: "Time-travel simulation with future bars strictly hidden.",
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
    const timer = window.setInterval(() => { if (typeof document !== "undefined" && !document.hidden) void refresh(); }, exchange === "binance" ? 5_000 : 15_000);
    return () => { disposed = true; window.clearInterval(timer); };
  }, [symbol, exchange, enabled, key, retryToken]);

  return {
    ...(enabled && snapshot?.key === key ? { summary: snapshot.summary, error: snapshot.error } : { summary: null, error: null }),
    retry: () => setRetryToken((current) => current + 1),
  };
}

function isTypingActive(event: KeyboardEvent): boolean {
  const target = event.target as HTMLElement | null;
  if (!target) return false;
  return (
    target.tagName === "INPUT" ||
    target.tagName === "TEXTAREA" ||
    target.tagName === "SELECT" ||
    Boolean(target.closest?.("input, textarea, select")) ||
    target.isContentEditable ||
    Boolean(target.closest?.(".monaco-editor")) ||
    Boolean(target.closest?.("[contenteditable='true']"))
  );
}

function SymbolPicker({ disabled = false }: { disabled?: boolean }): React.JSX.Element {
  const [symbol, exchange, setSymbol, addWatchlist] = useWorkspaceStore(useShallow((state) => [state.symbol, state.exchange, state.setSymbol, state.addWatchlistSymbol]));
  const [query, setQuery] = useState(symbol);
  const [open, setOpen] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [searchResult, setSearchResult] = useState<{ query: string; exchange: WorkspaceState["exchange"]; items: MarketSymbol[]; error: string | null } | null>(null);
  const [loading, setLoading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const resultsListRef = useRef<HTMLDivElement>(null);

  // Global hotkey to open search: `/` or `Ctrl+K`
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent): void => {
      if (disabled || isTypingActive(event)) return;

      if (event.key === "/" || (event.key.toLowerCase() === "k" && (event.ctrlKey || event.metaKey))) {
        event.preventDefault();
        setOpen(true);
        setQuery("");
        setSelectedIndex(0);
        window.setTimeout(() => inputRef.current?.focus(), 50);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [disabled]);

  useEffect(() => {
    if (!open || query.trim().length < 1) return;
    let disposed = false;
    const timer = window.setTimeout(() => {
      setLoading(true);
      void fetch(`/api/markets?exchange=${exchange}&q=${encodeURIComponent(query)}`, { cache: "no-store" }).then(async (response) => {
        const payload: unknown = await response.json();
        if (!response.ok) throw new Error(`${EXCHANGE_LABELS[exchange]} symbol search is unavailable.`);
        if (!disposed) {
          setSearchResult({ query, exchange, items: readItems<MarketSymbol>(payload), error: null });
          setSelectedIndex(0);
        }
      }).catch((reason: unknown) => {
        if (!disposed) {
          setSearchResult({ query, exchange, items: [], error: reason instanceof Error ? reason.message : "Search failed." });
          setSelectedIndex(0);
        }
      }).finally(() => { if (!disposed) setLoading(false); });
    }, 180);
    return () => { disposed = true; window.clearTimeout(timer); };
  }, [query, open, exchange]);

  const result = searchResult?.query === query && searchResult.exchange === exchange ? searchResult : null;
  const items = result?.items ?? [];
  const error = result?.error ?? null;
  const showLoading = open && query.trim().length >= 1 && loading;

  // Auto-scroll selected item into view for supreme keyboard navigation
  useEffect(() => {
    if (!open || items.length === 0) return;
    const container = resultsListRef.current;
    if (!container) return;
    const buttons = container.querySelectorAll<HTMLButtonElement>(".symbol-result");
    const activeBtn = buttons[selectedIndex];
    if (activeBtn) {
      activeBtn.scrollIntoView({ block: "nearest" });
    }
  }, [selectedIndex, open, items.length]);

  const choose = (next: string): void => {
    setSymbol(next);
    addWatchlist(next);
    setQuery(next);
    setOpen(false);
  };

  return (
    <div className="symbol-picker relative">
      <div className={`symbol-search flex items-center gap-1.5 px-2 py-1 bg-[var(--ak-surface-sunken)] border border-[var(--ak-border-subtle)] ${open ? "border-[var(--ak-signal-info)]" : ""}`}>
        <Search size={13} className="text-[var(--ak-signal-info)]" />
        <input
          ref={inputRef}
          aria-label={`Search ${exchange} Spot symbols`}
          disabled={disabled}
          value={open ? query : symbol}
          onFocus={() => { if (!disabled) { setOpen(true); setQuery(""); setSelectedIndex(0); } }}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              setOpen(false);
              setQuery(symbol);
            } else if (event.key === "ArrowDown") {
              event.preventDefault();
              if (items.length > 0) {
                setSelectedIndex((prev) => (prev + 1) % items.length);
              }
            } else if (event.key === "ArrowUp") {
              event.preventDefault();
              if (items.length > 0) {
                setSelectedIndex((prev) => (prev - 1 + items.length) % items.length);
              }
            } else if (event.key === "Enter") {
              event.preventDefault();
              if (items[selectedIndex]) {
                choose(items[selectedIndex].symbol);
              } else if (items[0]) {
                choose(items[0].symbol);
              }
            }
          }}
          placeholder="Search market [/]"
          className="bg-transparent border-0 outline-none text-xs font-mono w-28 uppercase text-[var(--ak-text-primary)]"
        />
        <ChevronDown size={11} className="text-[var(--ak-text-secondary)] opacity-70" />
      </div>

      {open && (
        <>
          <button className="popover-backdrop fixed inset-0 z-40 bg-black/40" aria-label="Close symbol search" onClick={() => { setOpen(false); setQuery(symbol); }} />
          <div ref={resultsListRef} className="symbol-results absolute left-0 top-full mt-1 w-64 max-h-72 overflow-auto bg-[var(--ak-surface-canvas)] border border-[var(--ak-border-strong)] z-50 shadow-2xl p-1 font-mono text-xs">
            <div className="popover-title text-[10px] font-bold text-[var(--ak-text-secondary)] uppercase p-1.5 border-b border-[var(--ak-border-subtle)] flex items-center justify-between">
              <span>{EXCHANGE_LABELS[exchange].toUpperCase()} · SPOT MARKETS</span>
              <span className="text-[9px] opacity-60">↑/↓ NAV · ↵ CHOOSE</span>
            </div>
            {showLoading && <div className="popover-state p-3 text-center text-xs flex items-center justify-center gap-2"><AkSpinner color="#18d1ff" label="Searching" /><span>Searching…</span></div>}
            {error && <div className="popover-error p-2 text-xs text-[var(--ak-signal-danger)]">{error}</div>}
            {!showLoading && !error && items.map((item, idx) => {
              const isSelected = idx === selectedIndex;
              return (
                <button
                  className={`symbol-result w-full flex items-center justify-between p-1.5 text-left transition-colors cursor-pointer group ${
                    isSelected
                      ? "bg-[var(--ak-surface-raised)] border-l-2 border-[var(--ak-signal-info)]"
                      : "hover:bg-[var(--ak-surface-sunken)] border-l-2 border-transparent"
                  }`}
                  key={item.symbol}
                  draggable
                  onMouseEnter={() => setSelectedIndex(idx)}
                  onDragStart={(event) => {
                    event.dataTransfer.effectAllowed = "copy";
                    event.dataTransfer.setData(WATCHLIST_DRAG_TYPE, item.symbol);
                    event.dataTransfer.setData("text/plain", item.symbol);
                  }}
                  title="Click or Enter to select · drag into the watchlist to add"
                  onClick={() => choose(item.symbol)}
                >
                  <span className="symbol-result-pair flex items-center gap-1">
                    <strong className={isSelected ? "text-[var(--ak-signal-info)]" : "group-hover:text-[var(--ak-signal-info)]"}>{item.base}</strong>
                    <small className="opacity-70">/{item.quote}</small>
                  </span>
                  <span className="result-quote text-[10px] text-[var(--ak-text-secondary)]">{item.quote}</span>
                </button>
              );
            })}
            {!showLoading && !error && query.trim().length > 0 && items.length === 0 && (
              <div className="popover-state p-3 text-center text-xs text-[var(--ak-text-secondary)]">No pair for “{query.trim().toUpperCase()}”</div>
            )}
          </div>
        </>
      )}
    </div>
  );
}

const MarketSummaryBar = memo(function MarketSummaryBar({ summary, error, replayMode, replayPrice, subject, onRetry }: { summary: MarketSummary | null; error: string | null; replayMode: boolean; replayPrice: number | null; subject: string; onRetry: () => void }): React.JSX.Element {
  const change = summary?.changePct24h;
  const currentPrice = replayMode ? replayPrice : summary?.last;
  const last = formatPrice(currentPrice);
  const changeValid = typeof change === "number" && Number.isFinite(change);
  const changeText = changeValid ? `${change >= 0 ? "+" : ""}${change.toFixed(2)}%` : "—";
  const isPositive = changeValid && change >= 0;

  const prevPriceRef = useRef<number | null>(null);
  const [flash, setFlash] = useState<"up" | "down" | null>(null);

  useEffect(() => {
    if (typeof currentPrice === "number" && prevPriceRef.current !== null && prevPriceRef.current !== currentPrice) {
      setFlash(currentPrice > prevPriceRef.current ? "up" : "down");
      const timer = window.setTimeout(() => setFlash(null), 850);
      prevPriceRef.current = currentPrice;
      return () => window.clearTimeout(timer);
    }
    if (typeof currentPrice === "number") {
      prevPriceRef.current = currentPrice;
    }
  }, [currentPrice]);

  return (
    <div className={`summary-strip flex items-center gap-4 text-xs font-mono ${error && summary ? "stale opacity-75" : ""}`}>
      <div className="summary-price flex items-baseline gap-2">
        <span className="text-[9px] font-bold text-[var(--ak-text-secondary)] uppercase tracking-wider">{replayMode ? "CURSOR" : "LAST"}</span>
        {typeof currentPrice === "number" && Number.isFinite(currentPrice) ? (
          <strong className={`text-2xl font-extrabold text-[var(--ak-text-primary)] tabular-nums tracking-tight transition-all duration-150 ${flash === "up" ? "price-flash-up" : flash === "down" ? "price-flash-down" : ""}`}>
            <Decoded className="decoded-price" value={last} trigger={subject} />
          </strong>
        ) : (
          <span className="text-2xl font-extrabold font-mono text-[var(--ak-text-secondary)] opacity-30 tabular-nums tracking-tight animate-pulse select-none">
            --.---
          </span>
        )}
        {!replayMode && (
          changeValid ? (
            <span className={`inline-flex items-center px-1.5 py-0.5 text-[10px] font-bold tabular-nums rounded-[2px] transition-all ${isPositive ? "bg-emerald-500/15 text-emerald-400 border border-emerald-500/30 shadow-[0_0_8px_rgba(70,196,124,0.15)]" : "bg-rose-500/15 text-rose-400 border border-rose-500/30 shadow-[0_0_8px_rgba(227,59,59,0.15)]"}`}>
              <Decoded value={changeText} trigger={`${subject}|chg`} />
            </span>
          ) : (
            <span className="text-[10px] font-mono font-bold text-[var(--ak-text-secondary)] opacity-30 select-none">
              --.--%
            </span>
          )
        )}
      </div>

      {!replayMode && (
        <div className="summary-stats hidden lg:flex items-center gap-2 pl-3">
          <div className="summary-pod">
            <span className="uppercase tracking-wider block opacity-70">24H HIGH</span>
            {summary?.high24h != null && Number.isFinite(summary.high24h) ? (
              <strong className="text-[var(--ak-text-primary)] font-bold tabular-nums text-xs"><Decoded value={formatPrice(summary.high24h)} trigger={`${subject}|hi`} /></strong>
            ) : (
              <span className="text-xs font-mono text-[var(--ak-text-secondary)] opacity-30 select-none">--</span>
            )}
          </div>
          <div className="summary-pod">
            <span className="uppercase tracking-wider block opacity-70">24H LOW</span>
            {summary?.low24h != null && Number.isFinite(summary.low24h) ? (
              <strong className="text-[var(--ak-text-primary)] font-bold tabular-nums text-xs"><Decoded value={formatPrice(summary.low24h)} trigger={`${subject}|lo`} /></strong>
            ) : (
              <span className="text-xs font-mono text-[var(--ak-text-secondary)] opacity-30 select-none">--</span>
            )}
          </div>
          <div className="summary-pod">
            <span className="uppercase tracking-wider block opacity-70">24H VOL</span>
            {summary?.quoteVolume24h != null && Number.isFinite(summary.quoteVolume24h) ? (
              <strong className="text-[var(--ak-text-primary)] font-bold tabular-nums text-xs">
                <Decoded value={`${(summary.quoteVolume24h / 1_000_000).toFixed(2)}M`} trigger={`${subject}|vol`} />
              </strong>
            ) : (
              <span className="text-xs font-mono text-[var(--ak-text-secondary)] opacity-30 select-none">--</span>
            )}
          </div>
        </div>
      )}

      <div className="summary-source ml-auto text-[10px]">
        {replayMode ? (
          <AkTag variant="advanced" className="text-[9px]">HISTORICAL ONLY</AkTag>
        ) : error ? (
          <div className="flex items-center gap-1.5 text-[var(--ak-signal-danger)]">
            <span>{summary ? "STALE" : "TICKER OFFLINE"}</span>
            <button className="summary-retry underline cursor-pointer" type="button" onClick={onRetry}>Retry</button>
          </div>
        ) : null}
      </div>
    </div>
  );
});

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

function RailRunHistory(): React.JSX.Element {
  const [activeBacktestId, selectedStrategyId, setDockTab] = useWorkspaceStore(useShallow((state) => [
    state.activeBacktestId, state.selectedStrategyId, state.setDockTab,
  ]));
  const [items, setItems] = useState<Array<{ id: string; strategyId?: string; createdAt?: string; metrics?: { totalReturn?: number; tradeCount?: number } }>>([]);
  const [state, setState] = useState<"loading" | "ready" | "blocked" | "error">("loading");

  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const res = await fetch("/api/backtests");
        if (res.status === 409) { if (alive) setState("blocked"); return; }
        if (!res.ok) throw new Error(String(res.status));
        const body = await res.json();
        const list = Array.isArray(body) ? body : body.items ?? body.results ?? [];
        if (alive) { setItems(list.slice(0, 16)); setState("ready"); }
      } catch { if (alive) setState("error"); }
    })();
    return () => { alive = false; };
  }, []);

  return (
    <div className="rail-block font-mono text-xs">
      <span className="rail-block-head flex items-center justify-between text-[10px] text-[var(--ak-text-secondary)] font-bold uppercase pb-1 border-b border-[var(--ak-border-subtle)]">
        <span>RUN HISTORY</span> <b>{items.length || "—"}</b>
      </span>
      {state === "loading" && <span className="rail-hint text-[10px] text-[var(--ak-text-secondary)] p-1">Loading runs…</span>}
      {state === "blocked" && <span className="rail-hint text-[10px] text-[var(--ak-signal-action)] p-1">History suppressed during Replay.</span>}
      {state === "ready" && items.length === 0 && <span className="rail-hint text-[10px] text-[var(--ak-text-secondary)] p-1">No saved runs yet.</span>}
      <div className="rail-list space-y-1 mt-1 max-h-48 overflow-auto">
        {items.map((run, idx) => (
          <button
            key={run.id || `run-${idx}`}
            type="button"
            className={`rail-item w-full flex items-center justify-between p-1 text-left text-[11px] hover:bg-[var(--ak-surface-sunken)] transition-colors ${activeBacktestId === run.id ? "bg-[var(--ak-surface-raised)] border-l-2 border-[var(--ak-signal-info)]" : ""}`}
            onClick={() => setDockTab("backtest")}
          >
            <span className="rail-item-main truncate font-bold">{(run.strategyId ?? selectedStrategyId).replace(/-/g, " ")}</span>
            <span className="rail-item-meta flex items-center gap-1 text-[10px]">
              {typeof run.metrics?.totalReturn === "number" ? (
                <em className={`not-italic font-bold ${run.metrics.totalReturn >= 0 ? "text-[var(--ak-signal-success)]" : "text-[var(--ak-signal-danger)]"}`}>
                  {run.metrics.totalReturn >= 0 ? "+" : "−"}{(Math.abs(run.metrics.totalReturn) * 100).toFixed(1)}%
                </em>
              ) : <em className="muted">—</em>}
              <small className="text-[var(--ak-text-secondary)]">({run.metrics?.tradeCount ?? 0})</small>
            </span>
          </button>
        ))}
      </div>
    </div>
  );
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
      } catch { /* ignore */ }
    })();
    return () => { alive = false; };
  }, []);

  const params = Object.entries(parameters ?? {});

  return (
    <>
      <div className="rail-block font-mono text-xs">
        <span className="rail-block-head flex items-center justify-between text-[10px] text-[var(--ak-text-secondary)] font-bold uppercase pb-1 border-b border-[var(--ak-border-subtle)]">
          <span>STRATEGIES</span> <b>{items.length || "—"}</b>
        </span>
        <div className="rail-list space-y-1 mt-1 max-h-40 overflow-auto">
          {items.map((s) => (
            <button
              key={s.id}
              type="button"
              className={`rail-item w-full p-1 text-left text-[11px] hover:bg-[var(--ak-surface-sunken)] transition-colors ${selectedStrategyId === s.id ? "bg-[var(--ak-surface-raised)] border-l-2 border-[var(--ak-signal-action)] font-bold" : ""}`}
              onClick={() => { setStrategy(s.id, {}); setInspectorTab("strategy"); }}
            >
              <div className="rail-item-main truncate">{s.name ?? s.id}</div>
              <div className="rail-item-sub text-[9px] text-[var(--ak-text-secondary)] opacity-70 truncate">{s.id}</div>
            </button>
          ))}
        </div>
      </div>

      {params.length > 0 && (
        <div className="rail-block font-mono text-xs">
          <span className="rail-block-head text-[10px] text-[var(--ak-text-secondary)] font-bold uppercase pb-1 border-b border-[var(--ak-border-subtle)] block">
            LIVE PARAMETERS
          </span>
          <div className="rail-facts compact grid grid-cols-2 gap-1 mt-1 p-1 bg-[var(--ak-surface-sunken)] text-[10px]">
            {params.map(([key, value]) => (
              <span key={key} className="flex flex-col">
                <em className="not-italic text-[var(--ak-text-secondary)] opacity-70 truncate">{key}</em>
                <strong className="text-[var(--ak-text-primary)] font-bold">{typeof value === "boolean" ? (value ? "ON" : "OFF") : String(value)}</strong>
              </span>
            ))}
          </div>
        </div>
      )}
    </>
  );
}

function RailReplayState({ session, playing, speed }: { session: ReplaySession | null; playing: boolean; speed: number }): React.JSX.Element {
  const bars = session?.bars ?? [];
  const first = bars[0];
  const last = bars.at(-1);
  const range = first && last
    ? `${new Date(first.timestamp).toISOString().slice(5, 10)} → ${new Date(last.timestamp).toISOString().slice(5, 10)}`
    : null;

  return (
    <div className="rail-block font-mono text-xs">
      <span className="rail-block-head text-[10px] text-[var(--ak-text-secondary)] font-bold uppercase pb-1 border-b border-[var(--ak-border-subtle)] block">
        SIMULATION SESSION
      </span>
      <div className="rail-facts compact space-y-1 mt-1 p-2 bg-[var(--ak-surface-sunken)] text-[11px]">
        <div className="flex justify-between">
          <span className="text-[var(--ak-text-secondary)]">STATE</span>
          <strong className={playing ? "text-[var(--ak-signal-success)] font-bold" : ""}>{session ? (playing ? "PLAYING" : "PAUSED") : "IDLE"}</strong>
        </div>
        <div className="flex justify-between">
          <span className="text-[var(--ak-text-secondary)]">BARS REVEALED</span>
          <strong>{bars.length || "—"}</strong>
        </div>
        <div className="flex justify-between">
          <span className="text-[var(--ak-text-secondary)]">SPEED</span>
          <strong>{speed}×</strong>
        </div>
        {range && (
          <div className="flex justify-between">
            <span className="text-[var(--ak-text-secondary)]">WINDOW</span>
            <strong className="rail-range text-[10px]">{range}</strong>
          </div>
        )}
      </div>
    </div>
  );
}

export function Terminal(): React.JSX.Element {
  const router = useRouter();
  const replayConfirmed = useWorkspaceStore((state) => state.replayConfirmedJson === replayIdentity(state));
  const replaySyncError = useWorkspaceStore((state) => state.replaySyncError);
  const retryReplaySync = useWorkspaceStore((state) => state.retryReplaySync);
  const workspaceReady = useWorkspaceStore((state) => state.workspaceReady);
  const exchange = useWorkspaceStore((state) => state.exchange);
  const [workspace, setWorkspace, symbol, timeframe, theme, setTheme, layout, setLayout, setVisibleRange, setBacktest, setDockTab, strategyId, parameters, config, activeReplayId, setActiveReplayId] = useWorkspaceStore(useShallow((state) => [
    state.activeWorkspace, state.setWorkspace, state.symbol, state.timeframe, state.theme, state.setTheme, state.layout, state.setLayout,
    state.setVisibleRange, state.setBacktest, state.setDockTab, state.selectedStrategyId, state.strategyParameters, state.backtestConfig,
    state.activeReplayId, state.setActiveReplayId,
  ]));

  const deferredWorkspace = useDeferredValue(workspace);
  const { summary, error: summaryError, retry: retrySummary } = useSummary(symbol, exchange, workspaceReady && workspace !== "replay");
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

  const setPage = useCallback((next: WorkspaceState["activeWorkspace"]): void => {
    if (next !== "replay") setReplayPlaying(false);
    setWorkspace(next);
    if (next === "research") {
      useWorkspaceStore.getState().setInspectorTab("strategy");
      setDockTab("backtest");
    }
  }, [setWorkspace, setDockTab]);

  const [showHotkeys, setShowHotkeys] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const watchlist = useWorkspaceStore((state) => state.watchlist);
  const runBacktestRef = useRef<() => void>(() => {});

  // Global hotkeys: 1, 2, 3 workspaces; [ ] watchlist; T timeframe; D cycle dock; I cycle inspector; B/Ctrl+Enter backtest; ? HUD; \ sidebar
  useEffect(() => {
    if (!workspaceReady) return;
    const handleKeyDown = (event: KeyboardEvent): void => {
      if (isTypingActive(event)) return;

      if (event.key === "1") {
        setPage("terminal");
      } else if (event.key === "2") {
        setPage("research");
      } else if (event.key === "3") {
        setPage("replay");
      } else if (event.key === "4") {
        if (useWorkspaceStore.getState().activeWorkspace === "replay") {
          setPage("terminal");
        }
        router.push("/derivatives");
      } else if (event.key === "?" || (event.key === "/" && event.shiftKey)) {
        event.preventDefault();
        setShowHotkeys((prev) => !prev);
      } else if (event.key === "Escape") {
        setShowHotkeys(false);
      } else if (event.key === "\\" || ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "b")) {
        event.preventDefault();
        setSidebarOpen((prev) => !prev);
      } else if (event.key === "[" || event.key === "]") {
        if (watchlist.length > 0) {
          event.preventDefault();
          const currentIdx = watchlist.indexOf(symbol);
          const nextIdx = event.key === "]"
            ? (currentIdx + 1) % watchlist.length
            : (currentIdx - 1 + watchlist.length) % watchlist.length;
          const targetSymbol = watchlist[nextIdx >= 0 ? nextIdx : 0];
          if (targetSymbol) {
            useWorkspaceStore.getState().setSymbol(targetSymbol);
          }
        }
      } else if (event.key.toLowerCase() === "t" && !event.ctrlKey && !event.metaKey && !event.altKey) {
        event.preventDefault();
        const availableTfs = TIMEFRAMES.filter((tf) => EXCHANGE_TIMEFRAMES[exchange].includes(tf));
        if (availableTfs.length > 0) {
          const currentTfIdx = availableTfs.indexOf(timeframe);
          const nextIdx = event.shiftKey
            ? (currentTfIdx - 1 + availableTfs.length) % availableTfs.length
            : (currentTfIdx + 1) % availableTfs.length;
          const nextTf = availableTfs[nextIdx >= 0 ? nextIdx : 0];
          if (nextTf) {
            useWorkspaceStore.getState().setTimeframe(nextTf);
          }
        }
      } else if (event.key.toLowerCase() === "d" && !event.ctrlKey && !event.metaKey && !event.altKey) {
        event.preventDefault();
        const currentWorkspace = useWorkspaceStore.getState().activeWorkspace;
        const currentDockTab = useWorkspaceStore.getState().dockTab;
        const tabs: readonly DockTab[] = currentWorkspace === "terminal" || currentWorkspace === "replay"
          ? ["positions", "orders"]
          : ["backtest", "sweep", "evaluate", "history", "logs"];
        const currentIdx = tabs.indexOf(currentDockTab);
        const nextIdx = event.shiftKey
          ? (currentIdx - 1 + tabs.length) % tabs.length
          : (currentIdx + 1) % tabs.length;
        const nextTab = tabs[nextIdx >= 0 ? nextIdx : 0];
        if (nextTab) {
          useWorkspaceStore.getState().setDockTab(nextTab);
        }
      } else if (event.key.toLowerCase() === "i" && !event.ctrlKey && !event.metaKey && !event.altKey) {
        event.preventDefault();
        const currentWorkspace = useWorkspaceStore.getState().activeWorkspace;
        const currentInspectorTab = useWorkspaceStore.getState().inspectorTab;
        const tabs: readonly InspectorTab[] = currentWorkspace === "replay"
          ? ["context"]
          : ["book", "trades", "strategy", "context"];
        const currentIdx = tabs.indexOf(currentInspectorTab);
        const nextIdx = event.shiftKey
          ? (currentIdx - 1 + tabs.length) % tabs.length
          : (currentIdx + 1) % tabs.length;
        const nextTab = tabs[nextIdx >= 0 ? nextIdx : 0];
        if (nextTab) {
          useWorkspaceStore.getState().setInspectorTab(nextTab);
        }
      } else if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
        event.preventDefault();
        const currentWorkspace = useWorkspaceStore.getState().activeWorkspace;
        if (currentWorkspace === "research") {
          runBacktestRef.current();
        } else if (currentWorkspace === "terminal" || currentWorkspace === "replay") {
          window.dispatchEvent(new CustomEvent("newbeing:hotkey-buy"));
        }
      } else if (event.key.toLowerCase() === "b" && !event.ctrlKey && !event.metaKey && !event.altKey) {
        event.preventDefault();
        const currentWorkspace = useWorkspaceStore.getState().activeWorkspace;
        if (currentWorkspace === "research") {
          runBacktestRef.current();
        } else if (currentWorkspace === "terminal" || currentWorkspace === "replay") {
          window.dispatchEvent(new CustomEvent("newbeing:hotkey-buy"));
        }
      } else if (event.key.toLowerCase() === "s" && !event.ctrlKey && !event.metaKey && !event.altKey) {
        const currentWorkspace = useWorkspaceStore.getState().activeWorkspace;
        if (currentWorkspace === "terminal" || currentWorkspace === "replay") {
          event.preventDefault();
          window.dispatchEvent(new CustomEvent("newbeing:hotkey-sell"));
        }
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [setPage, workspaceReady, watchlist, symbol, exchange, timeframe, router]);

  const runBacktest = useCallback(async (): Promise<void> => {
    const canApply = captureWorkspaceSelection();
    setRunning(true);
    setBacktestError(null);
    setLastAction(`Fetching ${EXCHANGE_LABELS[exchange]} bars & executing event loop…`);
    try {
      const response = await fetch("/api/backtests", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
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
      if (canApply()) {
        setBacktest(payload as BacktestResult);
        setWorkspace("research");
        setDockTab("backtest");
      }
      setLastAction(null);
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : "Backtest failed.";
      setBacktestError(message);
      setLastAction(null);
    } finally {
      setRunning(false);
    }
  }, [exchange, symbol, timeframe, strategyId, parameters, config, setBacktest, setWorkspace, setDockTab]);

  useEffect(() => {
    runBacktestRef.current = () => { void runBacktest(); };
  }, [runBacktest]);

  const handleVisibleRange = useCallback((range: { from: number | null; to: number | null }): void => {
    setVisibleRange(range);
  }, [setVisibleRange]);

  const replayRefreshRef = useRef(0);
  const refreshReplay = useCallback(async (id: string): Promise<void> => {
    const canApply = captureReplaySelection(id);
    const refresh = ++replayRefreshRef.current;
    const response = await fetch(`/api/replay/${encodeURIComponent(id)}`, { cache: "no-store" });
    const payload: unknown = await response.json();
    if (!canApply() || refresh !== replayRefreshRef.current) return;
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
    if (currentWorkspace.activeWorkspace !== "replay") return;
    if (currentWorkspace.exchange !== parsed.session.exchange) currentWorkspace.setExchange(parsed.session.exchange);
    if (useWorkspaceStore.getState().symbol !== parsed.session.symbol) useWorkspaceStore.getState().setSymbol(parsed.session.symbol);
    if (useWorkspaceStore.getState().timeframe !== parsed.session.timeframe) useWorkspaceStore.getState().setTimeframe(parsed.session.timeframe);
  }, []);

  useEffect(() => {
    if (!workspaceReady || !activeReplayId) return;
    void Promise.resolve().then(() => refreshReplay(activeReplayId)).catch((error: unknown) => {
      setReplayError(error instanceof Error ? error.message : "Replay session could not be restored.");
    });
  }, [activeReplayId, refreshReplay, workspaceReady]);

  const startReplayFromBacktest = async (backtest: BacktestResult): Promise<void> => {
    /* Practise on the result's own frozen snapshot, seeded part-way through the
       tested window so bars after the seed stay ahead of the user. A result
       without a canonical snapshot is refused instead of silently refetching
       history that may no longer match what the backtest scored. */
    let body: ReturnType<typeof backtestReplayRequest>;
    try {
      body = backtestReplayRequest(backtest);
    } catch (reason) {
      setReplayError(reason instanceof Error ? reason.message : "This result cannot be opened in frozen Replay.");
      return;
    }
    const canApply = captureWorkspaceSelection();
    setReplayBusy(true);
    setReplayError(null);
    setReplayPlaying(false);
    try {
      const response = await fetch("/api/replay", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...body, navigate: false }),
      });
      const payload: unknown = await response.json();
      if (!response.ok) {
        const message = typeof payload === "object" && payload !== null && "error" in payload && typeof payload.error === "string" ? payload.error : "Replay could not be started.";
        throw new Error(message);
      }
      const parsed = parseReplayEnvelope(payload);
      if (!parsed) throw new Error("Replay start response was malformed.");
      // The server saved the session even if the user has since navigated away.
      if (!applyReplaySelection(parsed.session, canApply)) return;
      setReplaySession(parsed.session);
      setReplayExecution(parsed.execution ?? null);
      setReplayPortfolio(parsed.portfolio ?? null);
      setReplayOrders([]);
    } catch (error) {
      setReplayError(error instanceof Error ? error.message : "Replay could not be started.");
    } finally {
      setReplayBusy(false);
    }
  };

  const startReplay = async (replayConfig?: ReplayConfig): Promise<void> => {
    const canApply = captureWorkspaceSelection();
    setReplayBusy(true);
    setReplayError(null);
    setReplayPlaying(false);
    try {
      const response = await fetch("/api/replay", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ exchange, symbol, timeframe, endAt: new Date(replayStartAt).getTime(), limit: replayLimit, ...replayConfig, navigate: false }),
      });
      const payload: unknown = await response.json();
      if (!response.ok) {
        const message = typeof payload === "object" && payload !== null && "error" in payload && typeof payload.error === "string" ? payload.error : "Replay could not be started.";
        throw new Error(message);
      }
      const parsed = parseReplayEnvelope(payload);
      if (!parsed) throw new Error("Replay start response was malformed.");
      if (!applyReplaySelection(parsed.session, canApply)) return;
      setReplaySession(parsed.session);
      setReplayExecution(parsed.execution ?? null);
      setReplayPortfolio(parsed.portfolio ?? null);
      setReplayOrders([]);
    } catch (error) {
      setReplayError(error instanceof Error ? error.message : "Replay could not be started.");
    } finally {
      setReplayBusy(false);
    }
  };

  const stepReplay = useCallback(async (): Promise<void> => {
    if (!replaySession || replaySession.status !== "active" || replayBusyRef.current) return;
    const canApply = captureReplaySelection(replaySession.id);
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
      if (!canApply()) return;
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
      if (!canApply()) return;
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
    if (!replayPlaying || workspace !== "replay" || !replayConfirmed) return;
    const timer = window.setInterval(() => { void replayStepRef.current(); }, Math.max(100, Math.round(1_000 / replaySpeed)));
    return () => window.clearInterval(timer);
  }, [replayPlaying, replaySpeed, replayConfirmed, workspace]);

  const finishReplay = async (): Promise<void> => {
    if (!replaySession || replayBusyRef.current) return;
    const canApply = captureReplaySelection(replaySession.id);
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
      if (!canApply()) return;
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
      if (!canApply()) return;
      setReplayError(error instanceof Error ? error.message : "Could not finish replay session.");
    } finally {
      replayBusyRef.current = false;
      setReplayBusy(false);
    }
  };

  const replayCommand = async (command: Record<string, unknown>): Promise<void> => {
    if (!replaySession || replayBusyRef.current || useWorkspaceStore.getState().activeReplayId !== replaySession.id) {
      throw new Error("Replay session is not ready.");
    }
    const sessionId = replaySession.id;
    const canApply = captureReplaySelection(sessionId);
    replayBusyRef.current = true;
    setReplayBusy(true);
    setReplayPlaying(false);
    setReplayError(null);
    try {
      const response = await fetch(`/api/replay/${encodeURIComponent(sessionId)}`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...command, expectedRevision: replayExecution?.revision }),
      });
      const payload: unknown = await response.json();
      if (!response.ok) {
        if (response.status === 409 && canApply()) await refreshReplay(sessionId);
        throw new Error(typeof payload === "object" && payload !== null && "error" in payload ? String(payload.error) : "Replay action failed.");
      }
      const parsed = parseReplayEnvelope(payload);
      if (!parsed || parsed.session.id !== sessionId || !parsed.execution) throw new Error("Replay action response was malformed.");
      if (command.action === "order" && !parsed.execution.orders.some((order) => order.clientOrderId === `replay-${sessionId}-${command.requestId}`)) {
        throw new Error("Replay order outcome could not be confirmed.");
      }
      if (!canApply()) return;
      // A read started before this command must not overwrite its newer snapshot.
      replayRefreshRef.current += 1;
      setReplaySession(parsed.session);
      setReplayExecution(parsed.execution);
      setReplayPortfolio(parsed.portfolio ?? null);
      setReplayOrders(parsed.orders ?? []);
    } catch (error) {
      if (canApply()) {
        const message = error instanceof Error ? error.message : "Replay action failed.";
        setReplayError(command.action === "order"
          ? `${message} Order outcome may be unknown. Do not refresh; retry in this tab with the same order parameters.`
          : message);
      }
      throw error;
    } finally {
      replayBusyRef.current = false;
      setReplayBusy(false);
    }
  };

  const placeReplayOrder = async (side: "buy" | "sell", quantity: number, options?: Partial<ReplayOrderInput>): Promise<void> => {
    if (!replaySession || replayBusyRef.current || useWorkspaceStore.getState().activeReplayId !== replaySession.id) {
      throw new Error("Replay session is not ready.");
    }
    const order = { side, quantity, type: options?.type ?? "market", price: options?.price, stopLoss: options?.stopLoss, takeProfit: options?.takeProfit };
    const key = JSON.stringify([replaySession.id, order]);
    const requestId = replayOrderRequestId(key);
    await replayCommand({ action: "order", ...order, requestId });
    clearReplayOrderRequest(key, requestId);
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

  const showsWatchlist = workspace === "terminal" && sidebarOpen;
  /* The inspector keeps a fixed pixel width because the study panels need it, but in
     a narrow pane (the sidebar browser is ~420px) that fixed width leaves the chart
     ~45px and the workspace becomes unusable. Cap the side column as a share of the
     canvas so the chart always keeps a majority of the width. */
  const [canvasWidth, setCanvasWidth] = useState(0);
  useEffect(() => {
    const canvas = document.querySelector<HTMLElement>(".market-canvas");
    if (!canvas) return;
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (entry) setCanvasWidth(entry.contentRect.width);
    });
    observer.observe(canvas);
    return () => observer.disconnect();
  }, [workspaceReady]);
  const sideLimit = canvasWidth > 0 ? Math.round(canvasWidth * 0.42) : Number.POSITIVE_INFINITY;
  const railWidth = Math.min(layout.watchlistWidth, canvasWidth > 0 ? Math.round(canvasWidth * 0.3) : Infinity);
  const sideWidth = Math.min(workspace === "research"
    ? Math.max(layout.inspectorWidth, 380)
    : Math.max(layout.inspectorWidth, 320), sideLimit);
  const gridColumns = showsWatchlist
    ? `${railWidth}px 5px minmax(0, 1fr) 5px ${sideWidth}px`
    : `minmax(0, 1fr) 5px ${sideWidth}px`;

  const col = showsWatchlist
    ? { rail: 1, railDrag: 2, chart: 3, inspectorDrag: 4, inspector: 5 }
    : { rail: 0, railDrag: 0, chart: 1, inspectorDrag: 2, inspector: 3 };

  const dockHeight = workspace === "research" ? Math.max(layout.bottomHeight, 320)
    : workspace === "replay" ? Math.max(layout.bottomHeight, 210)
    : layout.bottomHeight;

  return (
    <div className={`application-shell mode-${workspace}`} data-ak-ui="system" data-theme={theme === "light" ? "light" : undefined}>
      <WorkspaceSync />
      {!workspaceReady ? (
        <div role="status" className="h-screen w-screen flex flex-col items-center justify-center bg-[var(--ak-surface-canvas)] font-mono text-xs text-[var(--ak-text-secondary)]">Loading local workspace…</div>
      ) : (
        <>
          <header className="topbar flex items-center justify-between gap-3 px-3 z-20">
            {/* Wing 1: Brand Lockup & Navigation Cockpit */}
            <div className="flex items-center gap-3 shrink-0">
              <div className="brand-lockup flex items-center gap-2">
                <AkGlow tone="info" className="inline-flex items-center">
                  <div className="brand-mark p-1 bg-[var(--ak-signal-info)] text-black">
                    <Activity size={15} strokeWidth={2.6} />
                  </div>
                </AkGlow>
                <AkBrackets className="font-bold text-xs tracking-wider flex items-center gap-1">
                  <span className="text-[var(--ak-text-primary)]">newBeing</span>
                  <span className="text-[var(--ak-signal-info)] text-[10px]">PRTS</span>
                </AkBrackets>
              </div>

              <div className="h-5 w-[1px] bg-[var(--ak-border)] mx-0.5 opacity-50" />

              <nav className="nav-cockpit flex items-center gap-1 shrink-0" aria-label="Workspace navigation">
                <div className="workspace-flow-sequence" role="group" aria-label="Research workflow">
                  {([ ["terminal", "Markets", "1"], ["research", "Research", "2"], ["replay", "Replay", "3"] ] as const).map(([item, label, num], index) => (
                    <Fragment key={item}>
                      <button
                        data-testid={`workspace-${item}`}
                        aria-current={workspace === item ? "page" : undefined}
                        aria-label={`${label} workspace, shortcut ${num}`}
                        className={`workspace-tab relative px-2.5 py-1 text-xs font-mono font-bold tracking-wider uppercase transition-all ${workspace === item ? "active text-[var(--ak-signal-action)] bg-[var(--ak-surface-raised)] border-b-2 border-[var(--ak-signal-action)]" : "text-[var(--ak-text-secondary)] hover:text-white"}`}
                        onClick={() => setPage(item)}
                        title={`Switch to ${label} with ${num}`}
                      >
                        {workspace === item && <AkCorner position="tl" tone="yellow" />}
                        {label}
                      </button>
                      {index < 2 && <span className="workflow-step-separator" aria-hidden="true">›</span>}
                    </Fragment>
                  ))}
                </div>
                <span className="workspace-nav-separator" aria-hidden="true" />
                <Link href="/derivatives" className="workspace-tab px-2.5 py-1 text-xs font-mono font-bold uppercase text-[var(--ak-text-secondary)] hover:text-white transition-all shrink-0" aria-label="Derivatives market mode, shortcut 4" title="Switch to Derivatives with 4">
                  Derivatives
                </Link>
              </nav>
            </div>

            {/* Wing 2: Central Cockpit Pod (Symbol Search, Timeframe, Exchange) */}
            <div className="instrument-pod hidden md:flex items-center shrink-0">
              <SymbolPicker disabled={replayLocked} />

              <div className="h-4 w-[1px] bg-[var(--ak-border)] mx-1 opacity-50" />

              <div className="timeframe-selector flex items-center gap-0.5 shrink-0" aria-label="Timeframe">
                {TIMEFRAMES.map((item) => (
                  <button
                    key={item}
                    disabled={replayLocked || !EXCHANGE_TIMEFRAMES[exchange].includes(item)}
                    className={`px-1.5 py-0.5 text-[11px] font-mono font-bold transition-all ${timeframe === item ? "active bg-[var(--ak-signal-info)] text-black" : "text-[var(--ak-text-secondary)] hover:text-white"}`}
                    onClick={() => useWorkspaceStore.getState().setTimeframe(item)}
                  >
                    {item}
                  </button>
                ))}
              </div>

              <div className="h-4 w-[1px] bg-[var(--ak-border)] mx-1 opacity-50" />

              <label className="exchange-select flex items-center gap-1 text-xs font-mono bg-transparent px-2 py-0.5 shrink-0 cursor-pointer border-0">
                <span className="exchange-logo font-bold text-[var(--ak-signal-action)]">{exchange.slice(0, 1).toUpperCase()}</span>
                <select
                  aria-label="Exchange"
                  value={exchange}
                  disabled={replayLocked}
                  onChange={(event) => useWorkspaceStore.getState().setExchange(event.target.value as WorkspaceState["exchange"])}
                  className="nb-select-bare bg-transparent border-0 outline-none text-xs font-mono cursor-pointer"
                >
                  <option value="binance">Binance Spot</option>
                  <option value="coinbaseexchange">Coinbase</option>
                  <option value="okx">OKX Spot</option>
                  <option value="kraken">Kraken</option>
                </select>
                <ChevronDown size={11} className="text-[var(--ak-text-secondary)] opacity-70" />
              </label>
            </div>

            {/* Wing 3: Session Status & Tactical Actions */}
            <div className="flex items-center gap-2 shrink-0">
              <div className="topbar-status flex items-center gap-1.5 px-2.5 h-7 bg-[var(--ak-surface-sunken-2)] border border-[var(--ak-border-subtle)] whitespace-nowrap shrink-0 shadow-sm" aria-label={`Execution mode: paper. Live trading disabled. Active workspace: ${workspaceName}.`}>
                <span className="w-1.5 h-1.5 rounded-full bg-[var(--ak-signal-info)] animate-pulse shrink-0" />
                <span className="text-[10px] font-mono text-[var(--ak-signal-action)] font-bold">{workspaceName.toUpperCase()}</span>
                <span className="text-[10px] font-mono text-[var(--ak-text-secondary)] opacity-60">·</span>
                <span className="text-[9px] font-mono text-[var(--ak-text-secondary)]">PAPER</span>
              </div>

              <div className="h-5 w-[1px] bg-[var(--ak-border)] mx-0.5 opacity-50" />

              <div className="topbar-actions flex items-center gap-1 shrink-0">
                <Button variant="ghost" size="icon" title={sidebarOpen ? "Collapse sidebar [Ctrl+B or \\]" : "Expand sidebar [Ctrl+B or \\]"} aria-label={sidebarOpen ? "Collapse sidebar" : "Expand sidebar"} onClick={() => setSidebarOpen((prev) => !prev)}>
                  {sidebarOpen ? <PanelLeftClose size={13} /> : <PanelLeft size={13} />}
                </Button>
                <Button variant="ghost" size="icon" title="Terminal shortcuts [?]" aria-label="Terminal shortcuts" onClick={() => setShowHotkeys((prev) => !prev)}>
                  <HelpCircle size={13} />
                </Button>
                <Button variant="ghost" size="icon" title="Toggle theme" aria-label="Toggle theme" onClick={() => setTheme(theme === "dark" ? "light" : "dark")}>
                  {theme === "dark" ? <Sun size={13} /> : <Moon size={13} />}
                </Button>
                <Button variant="ghost" size="icon" title="Reset layout" aria-label="Reset layout" onClick={() => setLayout({ watchlistWidth: 210, inspectorWidth: 320, bottomHeight: 190 })}>
                  <LayoutDashboard size={13} />
                </Button>
              </div>
            </div>
          </header>

      {workspace === "replay" && !replayConfirmed && (
        <div className="replay-sync-banner px-3 py-1.5 bg-amber-950/40 border-b border-amber-500/40 text-xs font-mono text-amber-300 flex items-center justify-between z-20 backdrop-blur-md">
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-amber-400 animate-pulse shrink-0" />
            <span className="text-[10px] font-bold px-1.5 py-0.2 bg-amber-500/20 border border-amber-500/40 text-amber-300 uppercase tracking-wider">REPLAY SYNC</span>
            <span role={replaySyncError ? "alert" : "status"} className="text-[11px]">{replaySyncError ?? "Synchronizing replay session with server…"}</span>
          </div>
          <div className="flex items-center gap-2">
            {replaySyncError && (
              <button className="px-2 py-0.5 text-[10px] font-bold bg-amber-500/20 hover:bg-amber-500/30 text-amber-300 border border-amber-500/40 uppercase tracking-wider transition-all cursor-pointer" onClick={retryReplaySync}>
                Retry
              </button>
            )}
            <button className="px-2 py-0.5 text-[10px] font-bold bg-[var(--ak-surface-sunken-2)] hover:bg-[var(--ak-surface-raised)] text-[var(--ak-text-primary)] border border-[var(--ak-border-subtle)] uppercase tracking-wider transition-all cursor-pointer" onClick={() => setPage("terminal")}>
              Return to Markets
            </button>
          </div>
        </div>
      )}

      <div className="market-heading relative px-4 py-2.5 flex flex-wrap items-center justify-between gap-4 shadow-xl" id="workspace-home">
        <AkCorner position="tl" tone="info" />
        <div className="market-identity flex items-center gap-3 font-mono">
          <div className="flex flex-col">
            <span className="market-eyebrow text-[9px] text-[var(--ak-signal-info)] uppercase tracking-widest font-bold flex items-center gap-1.5">
              <span className="opacity-70 font-mono">{"//"}</span>
              {EXCHANGE_LABELS[exchange]} · SPOT TRADING
            </span>
            <div className="market-title flex items-baseline gap-1 text-xl font-bold">
              <Decoded className="base-symbol text-[var(--ak-text-primary)] font-extrabold tracking-tight" value={symbol.split("/")[0] ?? symbol} trigger={`sym|${symbol}`} />
              <span className="quote-symbol text-[var(--ak-text-secondary)] opacity-70 text-sm">
                / <Decoded value={symbol.split("/")[1] ?? ""} trigger={`quote|${symbol}`} />
              </span>
              <AkTag variant="advanced" className="spot-tag ml-1 text-[10px] px-1.5 py-0 h-4">
                {timeframe}
              </AkTag>
            </div>
          </div>
        </div>

        <MarketSummaryBar
          summary={workspace === "replay" ? null : summary}
          error={workspace === "replay" ? null : summaryError}
          replayMode={workspace === "replay"}
          replayPrice={replayPrice}
          subject={`${exchange}|${symbol}|${timeframe}|${workspace}`}
          onRetry={retrySummary}
        />

        <div className="market-heading-right flex items-center gap-3 text-xs font-mono text-[var(--ak-text-secondary)]">
          <span className="exchange-time text-[10px]">
            {workspace === "replay" && replaySession?.bars.at(-1)
              ? `Cursor: ${new Date(replaySession.cursor).toLocaleTimeString()}`
              : summary?.timestamp
                ? `Updated: ${new Date(summary.timestamp).toLocaleTimeString()}`
                : "Awaiting feed"}
          </span>
          <div className="flex items-center gap-1.5 px-2 py-0.5 bg-[var(--ak-surface-sunken-2)] border border-[var(--ak-border-subtle)] text-[10px] font-bold">
            <span className="relative flex h-2 w-2">
              {!summaryError && workspace !== "replay" && (
                <span className={`animate-ping absolute inline-flex h-full w-full rounded-full opacity-75 ${summary ? "bg-emerald-400" : "bg-amber-400"}`} />
              )}
              <span className={`relative inline-flex rounded-full h-2 w-2 ${summaryError ? "bg-rose-500" : workspace === "replay" ? "bg-cyan-400" : summary ? "bg-emerald-500" : "bg-amber-400"}`} />
            </span>
            <span className={summaryError ? "text-rose-400" : workspace === "replay" ? "text-cyan-400" : summary ? "text-emerald-400" : "text-amber-400"}>
              {workspace === "replay" ? "REPLAY DATA" : summaryError ? "DELAYED" : summary ? "PUBLIC REALTIME" : "CONNECTING"}
            </span>
          </div>
        </div>
      </div>

      <main className={`workspace-layout mode-layout-${workspace}`}>
        {(workspace === "research" || workspace === "replay") && sidebarOpen && (
          <div className="primary-rail p-2.5 bg-[var(--ak-surface-canvas)] border-r border-[var(--ak-border-strong)] space-y-3 font-mono text-xs" aria-label="Active workspace">
            <div className="rail-caption text-[10px] text-[var(--ak-text-secondary)] uppercase tracking-widest font-bold pb-1 border-b border-[var(--ak-border-subtle)]">
              {workspaceName.toUpperCase()} · WORKSPACE
            </div>
            <div className={`rail-status ${workspace} p-2 bg-[var(--ak-surface-sunken)] border-l-2 border-[var(--ak-signal-action)] space-y-1`}>
              <span className="rail-status-head font-bold text-xs text-[var(--ak-signal-action)] uppercase flex items-center gap-1">
                {workspaceName.toUpperCase()}
              </span>
              <span className="rail-status-note text-[10px] text-[var(--ak-text-secondary)] block leading-tight">
                {RAIL_NOTES[workspace]}
              </span>
            </div>

            {workspace === "research" && (
              <>
                <RailStrategyRoster />
                <RailRunHistory />
              </>
            )}
            {workspace === "replay" && <RailReplayState session={replaySession} playing={replayPlaying} speed={replaySpeed} />}
          </div>
        )}

        <section className="market-canvas" aria-label={`${workspaceName} market workspace`}>
          <div className="workspace-grid" style={{ gridTemplateColumns: gridColumns, gridTemplateRows: `minmax(0, 1fr) 5px min(${dockHeight}px, max(150px, calc(100% - 265px)))` }}>
            {showsWatchlist && (
              <>
                <div className="left-rail" style={{ gridColumn: col.rail, gridRow: "1 / 4" }}>
                  <Watchlist disabled={replayLocked} />
                </div>
                <DragHandle direction="horizontal" onDelta={resizeWatchlist} style={{ gridColumn: col.railDrag, gridRow: "1 / 4" }} />
              </>
            )}

            <section className="chart-column flex flex-col min-h-0 bg-[var(--ak-surface-canvas)]" style={{ gridColumn: col.chart, gridRow: 1 }}>
              <div className="chart-toolbar flex items-center justify-between p-2 bg-[var(--ak-surface-sunken)] border-b border-[var(--ak-border-subtle)] font-mono text-xs">
                <div className="chart-toolbar-left flex items-center gap-2">
                  <span className="section-kicker font-bold text-[var(--ak-signal-info)]">01</span>
                  <span className="toolbar-separator text-[var(--ak-text-secondary)] opacity-50">/</span>
                  <span className="font-bold">{workspaceName.toUpperCase()} · {symbol} · {timeframe}</span>
                  {result && (
                    <AkTag variant="advanced" className="text-[10px] px-1.5 py-0">
                      {result.trades.length} SIGNALS
                    </AkTag>
                  )}
                </div>

                <div className="chart-toolbar-right flex items-center gap-2">
                  {running ? (
                    <span className="run-status text-xs text-[var(--ak-signal-action)] flex items-center gap-1.5">
                      <AkSpinner color="#ffd800" label="Executing" /> {lastAction ?? "Executing…"}
                    </span>
                  ) : lastAction ? (
                    <span className="run-status text-xs text-[var(--ak-text-secondary)]">{lastAction}</span>
                  ) : null}
                  {workspace === "terminal" && (
                    <Button variant="outline" size="sm" onClick={() => setPage("research")} className="h-6 text-[10px]" title={`Continue to Research with ${symbol} on ${timeframe}`}>
                      Build strategy
                    </Button>
                  )}
                </div>
              </div>

              {backtestError && (
                <div className="p-2 bg-[var(--ak-surface-canvas)] border-b border-[var(--ak-border-subtle)]">
                  <AkNotice variant="danger" code="PRTS.EXEC" title="Backtest Simulation Error">
                    {backtestError}
                  </AkNotice>
                </div>
              )}

              {exchange !== "binance" && (
                <div className="global-alert p-1.5 bg-[var(--ak-surface-sunken)] text-[10px] font-mono text-[var(--ak-text-secondary)] border-b border-[var(--ak-border-subtle)]" role="status">
                  Live quotes and candle feeds are loaded from {EXCHANGE_LABELS[exchange]} public market endpoints.
                </div>
              )}

              {workspace === "replay" && (
                <ReplayControls
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
                />
              )}

              {/* The chart's own shell fills via `flex: 1 1 auto`, so this wrapper
                  has to be a flex column — a plain block parent leaves it sized to
                  its content and the candles collapse into a sliver. */}
              <div className="flex-1 min-h-0 relative flex flex-col">
                <MarketChart
                  key={`${exchange}|${symbol}|${timeframe}|${workspace === "replay" ? "replay" : "live"}`}
                  backtest={workspace === "replay" ? null : result}
                  replayBars={replayBars}
                  onRangeChange={handleVisibleRange}
                />
              </div>
            </section>

            <DragHandle direction="horizontal" onDelta={resizeInspector} style={{ gridColumn: col.inspectorDrag, gridRow: "1 / 4" }} />

            <div style={{ gridColumn: col.inspector, gridRow: "1 / 4", minHeight: 0, display: "flex", flexDirection: "column" }} className="inspector-slot">
              <Inspector
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
              />
            </div>

            <DragHandle direction="vertical" onDelta={resizeDock} style={{ gridColumn: col.chart, gridRow: 2 }} />

            <div className="dock-slot" style={{ gridColumn: col.chart, gridRow: 3 }}>
              <BottomDock
                key={`${exchange}|${symbol}|${workspace === "replay" ? "replay" : "live"}`}
                workspace={workspace}
                replayMode={workspace === "replay"}
                replaySession={replaySession}
                replayPortfolio={replayPortfolio}
                replayOrders={replayOrders}
                onStartReplay={(backtest) => void startReplayFromBacktest(backtest)}
                replayBusy={replayBusy}
                replayError={replayError}
              />
            </div>
          </div>
        </section>
      </main>

      <nav className="mobile-mode-nav flex justify-around p-2 bg-[var(--ak-surface-canvas)] border-t border-[var(--ak-border-strong)]" aria-label="Workspace navigation">
        {([["terminal", "Markets"], ["research", "Research"], ["replay", "Replay"]] as const).map(([item, label]) => (
          <button
            key={item}
            type="button"
            aria-current={workspace === item ? "page" : undefined}
            className={workspace === item ? "active" : undefined}
            onClick={() => setPage(item)}
          >
            {label}
          </button>
        ))}
        <Link href="/derivatives" aria-label="Derivatives market mode" title="Open Derivatives" className="mobile-mode-link">
          Derivatives
        </Link>
      </nav>

      <footer className="statusbar flex items-center justify-between px-3 py-1 bg-[var(--ak-surface-canvas)] border-t border-[var(--ak-border-strong)] text-[10px] font-mono text-[var(--ak-text-secondary)]">
        <div className="flex items-center gap-2">
          <span className="w-1.5 h-1.5 rounded-full bg-[var(--ak-signal-success)]" />
          <span>LOCAL WORKSPACE</span>
          <span>·</span>
          <span>{symbol} · {timeframe}</span>
        </div>
        <div className="flex items-center gap-2">
          <span>{workspace === "replay" ? "REPLAY LOCAL ENGINE" : "CCXT MARKET ADAPTER"}</span>
          <span>·</span>
          <span>LIVE TRADING DISABLED</span>
          <span>·</span>
          <span>SQLITE LOCAL PERSISTENCE</span>
          <span>·</span>
          <button type="button" onClick={() => setShowHotkeys(true)} className="text-[var(--ak-signal-info)] hover:underline cursor-pointer" title="Open Hotkeys Guide">HOTKEYS [?]</button>
        </div>
      </footer>

      <AkDialog
        open={showHotkeys}
        onOpenChange={setShowHotkeys}
        eyebrow="SYSTEM // PRTS NAVIGATION"
        title="TERMINAL COMMAND HOTKEYS"
        size="lg"
        tokens={{ "--ak-dialog-w": "42rem" }}
        className="font-mono text-xs"
        footer={
          <div className="flex items-center justify-between w-full text-[10px] text-[var(--ak-text-secondary)] font-mono">
            <span>Tactile quick-flow activated · Press Esc or click outside to return</span>
            <button
              type="button"
              onClick={() => setShowHotkeys(false)}
              className="px-2.5 py-1 text-xs font-bold font-mono bg-[var(--ak-surface-sunken-2)] hover:bg-[var(--ak-surface-raised)] border border-[var(--ak-border)] text-[var(--ak-text-primary)] cursor-pointer"
            >
              CLOSE [ESC]
            </button>
          </div>
        }
      >
        <div className="grid grid-cols-2 gap-3 text-xs pt-1">
          <div className="space-y-1.5">
            <span className="text-[10px] text-[var(--ak-signal-info)] uppercase tracking-wider block font-bold">NAVIGATION</span>
            <div className="flex justify-between items-center bg-[var(--ak-surface-sunken)] p-1.5 border border-[var(--ak-border-subtle)]">
              <span className="text-[var(--ak-text-secondary)]">Markets / Research / Replay / Deriv</span>
              <kbd className="px-1.5 py-0.5 bg-[var(--ak-surface-sunken-2)] border border-[var(--ak-border)] text-[10px] text-[var(--ak-text-primary)] font-bold">1 / 2 / 3 / 4</kbd>
            </div>
            <div className="flex justify-between items-center bg-[var(--ak-surface-sunken)] p-1.5 border border-[var(--ak-border-subtle)]">
              <span className="text-[var(--ak-text-secondary)]">Cycle Bottom Dock</span>
              <kbd className="px-1.5 py-0.5 bg-[var(--ak-surface-sunken-2)] border border-[var(--ak-border)] text-[10px] text-[var(--ak-text-primary)] font-bold">D / Shift+D</kbd>
            </div>
            <div className="flex justify-between items-center bg-[var(--ak-surface-sunken)] p-1.5 border border-[var(--ak-border-subtle)]">
              <span className="text-[var(--ak-text-secondary)]">Cycle Inspector</span>
              <kbd className="px-1.5 py-0.5 bg-[var(--ak-surface-sunken-2)] border border-[var(--ak-border)] text-[10px] text-[var(--ak-text-primary)] font-bold">I / Shift+I</kbd>
            </div>
            <div className="flex justify-between items-center bg-[var(--ak-surface-sunken)] p-1.5 border border-[var(--ak-border-subtle)]">
              <span className="text-[var(--ak-text-secondary)]">Run Backtest (Research)</span>
              <kbd className="px-1.5 py-0.5 bg-[var(--ak-surface-sunken-2)] border border-[var(--ak-border)] text-[10px] text-[var(--ak-text-primary)] font-bold">B or ⌘↵</kbd>
            </div>
          </div>

          <div className="space-y-1.5">
            <span className="text-[10px] text-[var(--ak-signal-info)] uppercase tracking-wider block font-bold">MARKET &amp; FEEDS</span>
            <div className="flex justify-between items-center bg-[var(--ak-surface-sunken)] p-1.5 border border-[var(--ak-border-subtle)]">
              <span className="text-[var(--ak-text-secondary)]">Search Pair</span>
              <kbd className="px-1.5 py-0.5 bg-[var(--ak-surface-sunken-2)] border border-[var(--ak-border)] text-[10px] text-[var(--ak-text-primary)] font-bold">/ or ⌘K</kbd>
            </div>
            <div className="flex justify-between items-center bg-[var(--ak-surface-sunken)] p-1.5 border border-[var(--ak-border-subtle)]">
              <span className="text-[var(--ak-text-secondary)]">Cycle Watchlist</span>
              <kbd className="px-1.5 py-0.5 bg-[var(--ak-surface-sunken-2)] border border-[var(--ak-border)] text-[10px] text-[var(--ak-text-primary)] font-bold">[ / ]</kbd>
            </div>
            <div className="flex justify-between items-center bg-[var(--ak-surface-sunken)] p-1.5 border border-[var(--ak-border-subtle)]">
              <span className="text-[var(--ak-text-secondary)]">Cycle Timeframe</span>
              <kbd className="px-1.5 py-0.5 bg-[var(--ak-surface-sunken-2)] border border-[var(--ak-border)] text-[10px] text-[var(--ak-text-primary)] font-bold">T / Shift+T</kbd>
            </div>
          </div>

          <div className="space-y-1.5">
            <span className="text-[10px] text-[var(--ak-signal-info)] uppercase tracking-wider block font-bold">REPLAY CONTROLS</span>
            <div className="flex justify-between items-center bg-[var(--ak-surface-sunken)] p-1.5 border border-[var(--ak-border-subtle)]">
              <span className="text-[var(--ak-text-secondary)]">Play / Pause</span>
              <kbd className="px-1.5 py-0.5 bg-[var(--ak-surface-sunken-2)] border border-[var(--ak-border)] text-[10px] text-[var(--ak-text-primary)] font-bold">Space</kbd>
            </div>
            <div className="flex justify-between items-center bg-[var(--ak-surface-sunken)] p-1.5 border border-[var(--ak-border-subtle)]">
              <span className="text-[var(--ak-text-secondary)]">Step Next Bar</span>
              <kbd className="px-1.5 py-0.5 bg-[var(--ak-surface-sunken-2)] border border-[var(--ak-border)] text-[10px] text-[var(--ak-text-primary)] font-bold">→ or N</kbd>
            </div>
            <div className="flex justify-between items-center bg-[var(--ak-surface-sunken)] p-1.5 border border-[var(--ak-border-subtle)]">
              <span className="text-[var(--ak-text-secondary)]">Adjust Speed</span>
              <kbd className="px-1.5 py-0.5 bg-[var(--ak-surface-sunken-2)] border border-[var(--ak-border)] text-[10px] text-[var(--ak-text-primary)] font-bold">&lt; / &gt;</kbd>
            </div>
          </div>

          <div className="space-y-1.5">
            <span className="text-[10px] text-[var(--ak-signal-info)] uppercase tracking-wider block font-bold">MANUAL TRADING &amp; TICKETS</span>
            <div className="flex justify-between items-center bg-[var(--ak-surface-sunken)] p-1.5 border border-[var(--ak-border-subtle)]">
              <span className="text-[var(--ak-text-secondary)]">Quick Buy / Sell</span>
              <kbd className="px-1.5 py-0.5 bg-[var(--ak-surface-sunken-2)] border border-[var(--ak-border)] text-[10px] text-[var(--ak-text-primary)] font-bold">B / S</kbd>
            </div>
            <div className="flex justify-between items-center bg-[var(--ak-surface-sunken)] p-1.5 border border-[var(--ak-border-subtle)]">
              <span className="text-[var(--ak-text-secondary)]">Sizing Chips / Stepper</span>
              <kbd className="px-1.5 py-0.5 bg-[var(--ak-surface-sunken-2)] border border-[var(--ak-border)] text-[10px] text-[var(--ak-text-primary)] font-bold">Chips · - / +</kbd>
            </div>
            <div className="flex justify-between items-center bg-[var(--ak-surface-sunken)] p-1.5 border border-[var(--ak-border-subtle)]">
              <span className="text-[var(--ak-text-secondary)]">One-Click Flatten</span>
              <span className="text-[10px] text-[var(--ak-signal-danger)] font-bold">Close 100% button</span>
            </div>
          </div>

          <div className="space-y-1.5">
            <span className="text-[10px] text-[var(--ak-signal-info)] uppercase tracking-wider block font-bold">WORKSPACE &amp; VIEW</span>
            <div className="flex justify-between items-center bg-[var(--ak-surface-sunken)] p-1.5 border border-[var(--ak-border-subtle)]">
              <span className="text-[var(--ak-text-secondary)]">Toggle Sidebar</span>
              <kbd className="px-1.5 py-0.5 bg-[var(--ak-surface-sunken-2)] border border-[var(--ak-border)] text-[10px] text-[var(--ak-text-primary)] font-bold">\ or ⌘B</kbd>
            </div>
            <div className="flex justify-between items-center bg-[var(--ak-surface-sunken)] p-1.5 border border-[var(--ak-border-subtle)]">
              <span className="text-[var(--ak-text-secondary)]">Order Book Price Fill</span>
              <span className="text-[10px] text-[var(--ak-signal-info)] font-bold">Click depth row</span>
            </div>
            <div className="flex justify-between items-center bg-[var(--ak-surface-sunken)] p-1.5 border border-[var(--ak-border-subtle)]">
              <span className="text-[var(--ak-text-secondary)]">Command Help</span>
              <kbd className="px-1.5 py-0.5 bg-[var(--ak-surface-sunken-2)] border border-[var(--ak-border)] text-[10px] text-[var(--ak-text-primary)] font-bold">?</kbd>
            </div>
          </div>
        </div>
      </AkDialog>
        </>
      )}
    </div>
  );
}
