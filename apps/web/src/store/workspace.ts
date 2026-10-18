"use client";

import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { DEFAULT_WORKSPACE_STATE, EXCHANGE_TIMEFRAMES, STRATEGIES, type BacktestConfig, type BacktestResult, type ExchangeId, type StrategyParameters, type Timeframe, type WorkspaceState } from "@newbeing/core";
import { symbolForExchange } from "@/lib/exchanges";

export type ThemeMode = "dark" | "light";
export type InspectorTab = "watchlist" | "book" | "trades" | "strategy" | "context";
export type DockTab = "positions" | "orders" | "history" | "backtest" | "logs";

export interface WorkspaceStore extends WorkspaceState {
  theme: ThemeMode;
  watchlist: string[];
  inspectorTab: InspectorTab;
  dockTab: DockTab;
  strategyParameters: StrategyParameters;
  backtestConfig: BacktestConfig;
  sourceDrafts: Record<string, string>;
  backtest: BacktestResult | null;
  syncUpdatedAt: number;
  setExchange: (exchange: ExchangeId) => void;
  setSymbol: (symbol: string) => void;
  setTimeframe: (timeframe: Timeframe) => void;
  setWorkspace: (activeWorkspace: WorkspaceState["activeWorkspace"]) => void;
  setInspectorTab: (inspectorTab: InspectorTab) => void;
  setDockTab: (dockTab: DockTab) => void;
  setTheme: (theme: ThemeMode) => void;
  setLayout: (layout: WorkspaceState["layout"]) => void;
  setVisibleRange: (visibleRange: WorkspaceState["visibleRange"]) => void;
  setStrategy: (strategyId: string, parameters: StrategyParameters) => void;
  setStrategyParameters: (parameters: StrategyParameters) => void;
  setBacktestConfig: (config: BacktestConfig) => void;
  setSourceDraft: (strategyId: string, source: string) => void;
  setBacktest: (backtest: BacktestResult | null) => void;
  setActiveReplayId: (id: string | null) => void;
  setFromRemote: (state: WorkspaceState, updatedAt: number) => void;
  markSynced: (updatedAt: number) => void;
  addWatchlistSymbol: (symbol: string) => void;
  /** Move a watchlist entry to a new index (drag-to-reorder). */
  moveWatchlistSymbol: (symbol: string, toIndex: number) => void;
  removeWatchlistSymbol: (symbol: string) => void;
}

const firstStrategy = STRATEGIES[0];

export const useWorkspaceStore = create<WorkspaceStore>()(persist((set) => ({
  ...DEFAULT_WORKSPACE_STATE,
  theme: "dark",
  watchlist: ["BTC/USDT", "ETH/USDT", "BNB/USDT", "SOL/USDT", "XRP/USDT"],
  inspectorTab: "watchlist",
  dockTab: "backtest",
  strategyParameters: firstStrategy ? { ...firstStrategy.defaults } : {},
  backtestConfig: { initialCapital: 10_000, positionFraction: 0.95, feeRate: 0.001, slippageRate: 0.0005, allowShorts: false },
  sourceDrafts: {},
  backtest: null,
  syncUpdatedAt: 0,
  setSymbol: (symbol) => set({ symbol, visibleRange: { from: null, to: null } }),
  /* Switching venues keeps the session intact. Every venue can now serve
     backtests and replays, so dropping the user's results on a venue change
     would be destroying work for no reason — it used to be the only way to
     avoid showing data that the server would refuse to extend.
     The symbols do have to follow the venue, though: BTC/USDT is not listed on
     Coinbase or Kraken, so the pair is re-denominated or the app would sit on a
     market the venue has never heard of. */
  setExchange: (exchange) => set((state) => ({
    exchange,
    symbol: symbolForExchange(state.symbol, exchange),
    watchlist: state.watchlist.map((item) => symbolForExchange(item, exchange)),
    timeframe: EXCHANGE_TIMEFRAMES[exchange].includes(state.timeframe) ? state.timeframe : "15m",
    visibleRange: { from: null, to: null },
  })),

  setTimeframe: (timeframe) => set({ timeframe, visibleRange: { from: null, to: null } }),
  setWorkspace: (activeWorkspace) => set({ activeWorkspace }),
  setInspectorTab: (inspectorTab) => set({ inspectorTab }),
  setDockTab: (dockTab) => set({ dockTab }),
  setTheme: (theme) => set({ theme }),
  setLayout: (layout) => set({ layout }),
  setVisibleRange: (visibleRange) => set({ visibleRange }),
  setStrategy: (selectedStrategyId, strategyParameters) => set({ selectedStrategyId, strategyParameters }),
  setStrategyParameters: (strategyParameters) => set({ strategyParameters }),
  setBacktestConfig: (backtestConfig) => set({ backtestConfig }),
  setSourceDraft: (strategyId, source) => set((state) => ({ sourceDrafts: { ...state.sourceDrafts, [strategyId]: source } })),
  setBacktest: (backtest) => set({ backtest, activeBacktestId: backtest?.resultId ?? null }),
  setActiveReplayId: (activeReplayId) => set({ activeReplayId }),
  setFromRemote: (state, updatedAt) => set((current) => ({
    ...state,
    theme: current.theme,
    /* The watchlist is client-only, but its pairs are not venue-neutral, so it
       is re-denominated whenever the incoming venue differs. Otherwise the list
       keeps quoting BTC/USDT after the app has switched to Kraken, and every
       row in it is a market that venue does not have. */
    watchlist: state.exchange === current.exchange
      ? current.watchlist
      : current.watchlist.map((item) => symbolForExchange(item, state.exchange)),
    inspectorTab: current.inspectorTab,
    dockTab: current.dockTab,
    strategyParameters: current.selectedStrategyId === state.selectedStrategyId
      ? current.strategyParameters
      : { ...(STRATEGIES.find((strategy) => strategy.id === state.selectedStrategyId)?.defaults ?? {}) },
    sourceDrafts: current.sourceDrafts,
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
  storage: createJSONStorage(() => localStorage),
  skipHydration: true,
  version: 2,
  migrate: (persisted) => {
    const state = persisted as Partial<WorkspaceStore> & { layout?: { watchlistWidth: number; inspectorWidth: number; bottomHeight: number } };
    // v2: recomposed workstation defaults — old persisted layout values predate
    // the ak-ui system rewrite and overflow the canvas; reset them to v2 defaults.
    return {
      ...state,
      layout: { watchlistWidth: 210, inspectorWidth: 320, bottomHeight: 190 },
    } as unknown as WorkspaceStore;
  },
  partialize: (state) => ({
    symbol: state.symbol,
    timeframe: state.timeframe,
    exchange: state.exchange,
    mode: state.mode,
    activeWorkspace: state.activeWorkspace,
    selectedStrategyId: state.selectedStrategyId,
    activeBacktestId: state.activeBacktestId,
    activeReplayId: state.activeReplayId,
    visibleRange: state.visibleRange,
    layout: state.layout,
    theme: state.theme,
    watchlist: state.watchlist,
    inspectorTab: state.inspectorTab,
    dockTab: state.dockTab,
    strategyParameters: state.strategyParameters,
    backtestConfig: state.backtestConfig,
    sourceDrafts: state.sourceDrafts,
    syncUpdatedAt: state.syncUpdatedAt,
  }),
}));

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
