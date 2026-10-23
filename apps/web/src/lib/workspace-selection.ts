import type { ReplaySession } from "@newbeing/core";
import { useWorkspaceStore, type WorkspaceStore } from "@/store/workspace";

const selectionKeys = ["activeWorkspace", "exchange", "symbol", "timeframe", "selectedStrategyId", "strategyParameters", "backtestConfig", "sourceDrafts", "activeBacktestId", "activeReplayId", "dockTab", "inspectorTab"] as const satisfies readonly (keyof WorkspaceStore)[];
let selectionRevision = 0;
useWorkspaceStore.subscribe((state, previous) => {
  if (selectionKeys.some((key) => state[key] !== previous[key])) selectionRevision += 1;
});

/** Also fences navigation away and back while a request is pending. */
export function captureWorkspaceSelection(): () => boolean {
  const revision = selectionRevision;
  return () => revision === selectionRevision;
}

/** Check before our own setters advance the selection revision. */
export function applyReplaySelection(session: ReplaySession, canApply: () => boolean): boolean {
  if (!canApply()) return false;
  const store = useWorkspaceStore.getState();
  if (store.exchange !== session.exchange) store.setExchange(session.exchange);
  if (useWorkspaceStore.getState().symbol !== session.symbol) store.setSymbol(session.symbol);
  if (useWorkspaceStore.getState().timeframe !== session.timeframe) store.setTimeframe(session.timeframe);
  store.setActiveReplayId(session.id);
  store.setWorkspace("replay");
  return true;
}

export function captureReplaySelection(id: string): () => boolean {
  const canApply = captureWorkspaceSelection();
  return () => canApply() && useWorkspaceStore.getState().activeReplayId === id;
}
