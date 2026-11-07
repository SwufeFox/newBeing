"use client";

import { create } from "zustand";
import { persist, type PersistStorage, type StorageValue } from "zustand/middleware";
import { DEFAULT_WORKSPACE_STATE, EXCHANGE_TIMEFRAMES, STRATEGIES, type BacktestConfig, type BacktestResult, type ExchangeId, type StrategyParameters, type Timeframe, type WorkspaceState } from "@newbeing/core";
import { symbolForExchange } from "@/lib/exchanges";

export type InspectorTab = "watchlist" | "book" | "trades" | "strategy" | "context";
export type DockTab = "positions" | "orders" | "history" | "backtest" | "sweep" | "evaluate" | "logs";

export interface WorkspaceStore extends WorkspaceState {
  watchlist: string[];
  inspectorTab: InspectorTab;
  dockTab: DockTab;
  strategyParameters: StrategyParameters;
  backtestConfig: BacktestConfig;
  backtest: BacktestResult | null;
  syncUpdatedAt: number;
  workspaceReady: boolean;
  replayConfirmedJson: string | null;
  replaySyncError: string | null;
  replayRetry: number;
  retryReplaySync: () => void;
  setWorkspaceReady: (workspaceReady: boolean) => void;
  setExchange: (exchange: ExchangeId) => void;
  setSymbol: (symbol: string) => void;
  setTimeframe: (timeframe: Timeframe) => void;
  setWorkspace: (activeWorkspace: WorkspaceState["activeWorkspace"]) => void;
  setInspectorTab: (inspectorTab: InspectorTab) => void;
  setDockTab: (dockTab: DockTab) => void;
  setLayout: (layout: WorkspaceState["layout"]) => void;
  setVisibleRange: (visibleRange: WorkspaceState["visibleRange"]) => void;
  setStrategy: (strategyId: string, parameters: StrategyParameters) => void;
  setStrategyParameters: (parameters: StrategyParameters) => void;
  setBacktestConfig: (config: BacktestConfig) => void;
  setBacktest: (backtest: BacktestResult | null) => void;
  /** Drop a stored run selection whose record is no longer readable. */
  clearBacktestSelection: () => void;
  setActiveReplayId: (id: string | null) => void;
  setFromRemote: (state: WorkspaceState, updatedAt: number) => void;
  markSynced: (updatedAt: number) => void;
  addWatchlistSymbol: (symbol: string) => void;
  /** Move a watchlist entry to a new index (drag-to-reorder). */
  moveWatchlistSymbol: (symbol: string, toIndex: number) => void;
  removeWatchlistSymbol: (symbol: string) => void;
}

const firstStrategy = STRATEGIES[0];

/** Exactly the client-local slice written to localStorage. */
/* `activeWorkspace` is absent on purpose: the route owns which view is on
   screen, and a stored copy would fight it on every rehydrate. */
type PersistedWorkspaceState = Pick<WorkspaceStore,
  "symbol" | "timeframe" | "exchange" | "mode" | "selectedStrategyId" |
  "activeBacktestId" | "activeReplayId" | "visibleRange" | "layout" | "watchlist" |
  "inspectorTab" | "dockTab" | "strategyParameters" | "backtestConfig" | "syncUpdatedAt">;

/** Coalesce rapid store writes (chart pan, splitter drag, typing) so a pointer
 *  gesture does not serialize and flush localStorage on every event. Pending
 *  state is flushed when the page hides or unloads. */
function createDeferredStorage<S>(): PersistStorage<S> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let pending: { name: string; value: StorageValue<S> } | null = null;
  const flush = (): void => {
    if (!pending) return;
    const { name, value } = pending;
    pending = null;
    try { window.localStorage.setItem(name, JSON.stringify(value)); } catch { /* storage unavailable or full */ }
  };
  if (typeof window !== "undefined") {
    window.addEventListener("pagehide", flush);
    document.addEventListener("visibilitychange", () => { if (document.visibilityState === "hidden") flush(); });
  }
  return {
    getItem: (name) => {
      if (typeof window === "undefined") return null;
      try {
        const raw = window.localStorage.getItem(name);
        return raw ? JSON.parse(raw) as StorageValue<S> : null;
      } catch { return null; }
    },
    setItem: (name, value) => {
      pending = { name, value };
      if (timer === undefined) {
        timer = setTimeout(() => { timer = undefined; flush(); }, 250);
      }
    },
    removeItem: (name) => {
      pending = null;
      if (timer !== undefined) { clearTimeout(timer); timer = undefined; }
      if (typeof window !== "undefined") window.localStorage.removeItem(name);
    },
  };
}

export const useWorkspaceStore = create<WorkspaceStore>()(persist((set) => ({
  ...DEFAULT_WORKSPACE_STATE,
  watchlist: ["BTC/USDT", "ETH/USDT", "BNB/USDT", "SOL/USDT", "XRP/USDT"],
  inspectorTab: "watchlist",
  dockTab: "backtest",
  strategyParameters: firstStrategy ? { ...firstStrategy.defaults } : {},
  backtestConfig: { initialCapital: 10_000, positionFraction: 0.95, feeRate: 0.001, slippageRate: 0.0005, allowShorts: false },
  backtest: null,
  syncUpdatedAt: 0,
  workspaceReady: false,
  replayConfirmedJson: null,
  replaySyncError: null,
  replayRetry: 0,
  retryReplaySync: () => set((state) => ({ replayRetry: state.replayRetry + 1, replaySyncError: null })),
  setWorkspaceReady: (workspaceReady) => set({ workspaceReady }),
  setSymbol: (symbol) => set({ symbol, visibleRange: { from: null, to: null } }),
  /* Switching venues keeps the session intact. Every venue can now serve
     backtests and replays, so dropping the user's results on a venue change
     would be destroying work for no reason — it used to be the only way to
     avoid showing data that the server would refuse to extend.
     The symbols do have to follow the venue, though: BTC/USDT is not listed on
     Coinbase or Kraken, so the pair is re-denominated or the app would sit on a
     market the venue has never heard of. */
  setExchange: (exchange) => set((state) => state.exchange === exchange ? state : ({
    exchange,
    symbol: symbolForExchange(state.symbol, exchange),
    watchlist: [...new Set(state.watchlist.map((item) => symbolForExchange(item, exchange)))],
    timeframe: EXCHANGE_TIMEFRAMES[exchange].includes(state.timeframe) ? state.timeframe : "15m",
    visibleRange: { from: null, to: null },
  })),

  setTimeframe: (timeframe) => set({ timeframe, visibleRange: { from: null, to: null } }),
  setWorkspace: (activeWorkspace) => set({ activeWorkspace }),
  setInspectorTab: (inspectorTab) => set({ inspectorTab }),
  setDockTab: (dockTab) => set({ dockTab }),
  setLayout: (layout) => set({ layout }),
  setVisibleRange: (visibleRange) => set({ visibleRange }),
  setStrategy: (selectedStrategyId, strategyParameters) => set({ selectedStrategyId, strategyParameters }),
  setStrategyParameters: (strategyParameters) => set({ strategyParameters }),
  setBacktestConfig: (backtestConfig) => set({ backtestConfig }),
  setBacktest: (backtest) => set({ backtest, activeBacktestId: backtest?.resultId ?? null }),
  /* The id and the rendered result are separate: a saved workspace can point at
     a run that no longer exists while an unrelated result is on screen. Clearing
     only the id stops the missing run from being re-requested on every mount. */
  clearBacktestSelection: () => set((state) => (state.activeBacktestId === null ? state : { activeBacktestId: null })),
  setActiveReplayId: (activeReplayId) => set({ activeReplayId }),
  setFromRemote: (state, updatedAt) => set((current) => ({
    ...state,
    /* The URL owns which view is on screen, so a server snapshot can never pull
       the shell back to another workspace. Two tabs on different routes each keep
       their own view; the next write tells the server which one is current. */
    activeWorkspace: current.activeWorkspace,
    /* The watchlist is client-only, but its pairs are not venue-neutral, so it
       is re-denominated whenever the incoming venue differs. Otherwise the list
       keeps quoting BTC/USDT after the app has switched to Kraken, and every
       row in it is a market that venue does not have. */
    watchlist: state.exchange === current.exchange
      ? current.watchlist
      : [...new Set(current.watchlist.map((item) => symbolForExchange(item, state.exchange)))],
    inspectorTab: current.inspectorTab,
    dockTab: current.dockTab,
    strategyParameters: current.selectedStrategyId === state.selectedStrategyId
      ? current.strategyParameters
      : { ...(STRATEGIES.find((strategy) => strategy.id === state.selectedStrategyId)?.defaults ?? {}) },
    backtest: current.backtest?.resultId === state.activeBacktestId ? current.backtest : null,
    syncUpdatedAt: updatedAt,
  })),
  markSynced: (syncUpdatedAt) => set({ syncUpdatedAt }),
  addWatchlistSymbol: (symbol) => set((state) => ({
    watchlist: state.watchlist.includes(symbol) ? state.watchlist : [...state.watchlist, symbol].slice(-40),
  })),
  removeWatchlistSymbol: (symbol) => set((state) => ({
    watchlist: state.watchlist.filter((item) => item !== symbol),
  })),
  moveWatchlistSymbol: (symbol, toIndex) => set((state) => {
    const from = state.watchlist.indexOf(symbol);
    if (from < 0) return {};
    const next = state.watchlist.slice();
    next.splice(from, 1);
    const bounded = Math.max(0, Math.min(next.length, toIndex));
    next.splice(bounded, 0, symbol);
    return { watchlist: next };
  }),
}), {
  name: "newbeing-workspace-v1",
  storage: createDeferredStorage<PersistedWorkspaceState>(),
  skipHydration: true,
  version: 4,
  migrate: (persisted) => {
    const state = persisted as Partial<WorkspaceStore> & { layout?: { watchlistWidth: number; inspectorWidth: number; bottomHeight: number } };
    // v2: recomposed workstation defaults — old persisted layout values predate
    // the ak-ui system rewrite and overflow the canvas; reset them to v2 defaults.
    // v3: "backtest" is no longer a workspace (Research absorbed it). v4: the
    // view moved into the URL, so a persisted `activeWorkspace` is dropped
    // rather than migrated — restoring it would override the current route.
    const { activeWorkspace: _dropped, ...rest } = state;
    return {
      ...rest,
      layout: { watchlistWidth: 210, inspectorWidth: 320, bottomHeight: 190 },
    } as unknown as WorkspaceStore;
  },
  partialize: (state): PersistedWorkspaceState => ({
    symbol: state.symbol,
    timeframe: state.timeframe,
    exchange: state.exchange,
    mode: state.mode,
    selectedStrategyId: state.selectedStrategyId,
    activeBacktestId: state.activeBacktestId,
    activeReplayId: state.activeReplayId,
    visibleRange: state.visibleRange,
    layout: state.layout,
    watchlist: state.watchlist,
    inspectorTab: state.inspectorTab,
    dockTab: state.dockTab,
    strategyParameters: state.strategyParameters,
    backtestConfig: state.backtestConfig,
    syncUpdatedAt: state.syncUpdatedAt,
  }),
}));

export function replayIdentity(state: WorkspaceState): string {
  return JSON.stringify([state.activeWorkspace, state.activeReplayId, state.exchange, state.symbol, state.timeframe, state.mode]);
}

export function toSharedWorkspaceState(state: WorkspaceStore): WorkspaceState {
  return {
    symbol: state.symbol,
    timeframe: state.timeframe,
    exchange: state.exchange,
    mode: "paper",
    activeWorkspace: state.activeWorkspace,
    selectedStrategyId: state.selectedStrategyId,
    activeBacktestId: state.activeBacktestId,
    activeReplayId: state.activeReplayId,
    visibleRange: state.visibleRange,
    layout: state.layout,
  };
}
