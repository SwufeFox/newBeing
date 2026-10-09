"use client";

import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { DEFAULT_WORKSPACE_STATE, STRATEGIES, type BacktestConfig, type BacktestResult, type StrategyParameters, type Timeframe, type WorkspaceState } from "@newbeing/core";

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
    watchlist: current.watchlist,
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
}), {
  name: "newbeing-workspace-v1",
  storage: createJSONStorage(() => localStorage),
  skipHydration: true,
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
