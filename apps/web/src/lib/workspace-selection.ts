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
