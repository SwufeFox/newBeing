import { beforeEach, describe, expect, it } from "vitest";
import { DEFAULT_WORKSPACE_STATE, type ReplaySession } from "@newbeing/core";
import { applyReplaySelection, captureReplaySelection, captureWorkspaceSelection } from "../src/lib/workspace-selection";
import { useWorkspaceStore } from "../src/store/workspace";

const session: ReplaySession = {
  id: "new-replay", exchange: "kraken", symbol: "ETH/USD", timeframe: "1m",
  startAt: 180_000, cursor: 120_000, bars: [], status: "active",
  createdAt: "2026-01-01T00:00:00Z", updatedAt: "2026-01-01T00:00:00Z",
};

beforeEach(() => {
  useWorkspaceStore.setState({ ...DEFAULT_WORKSPACE_STATE, activeWorkspace: "research", activeReplayId: null });
});

describe("Replay selection fencing", () => {
  it.each(["terminal", "research", "replay"] as const)("applies a normal creation from %s before its own ID update invalidates the guard", (activeWorkspace) => {
    useWorkspaceStore.setState({ activeWorkspace });
    const canApply = captureWorkspaceSelection();
    expect(applyReplaySelection(session, canApply)).toBe(true);
    expect(useWorkspaceStore.getState()).toMatchObject({ activeWorkspace: "replay", activeReplayId: session.id, exchange: "kraken", symbol: "ETH/USD", timeframe: "1m" });
    expect(canApply()).toBe(false);
  });

  it("ignores a delayed creation after navigation without changing the current replay ID or market", async () => {
    const canApply = captureWorkspaceSelection();
    const pending = Promise.resolve().then(() => applyReplaySelection(session, canApply));
    useWorkspaceStore.setState({ activeWorkspace: "terminal", symbol: "SOL/USDT", activeReplayId: "other-replay" });
    const navigated = useWorkspaceStore.getState();
    expect(await pending).toBe(false);
    expect(useWorkspaceStore.getState()).toBe(navigated);
  });

  it("does not revive creation navigation after leaving and returning", () => {
    const canApply = captureWorkspaceSelection();
    useWorkspaceStore.getState().setWorkspace("terminal");
    useWorkspaceStore.getState().setWorkspace("research");
    expect(applyReplaySelection(session, canApply)).toBe(false);
    expect(useWorkspaceStore.getState().activeReplayId).toBeNull();
  });

  it.each(["navigation", "market", "session", "reset", "away-and-back"])("rejects a delayed refresh after %s", async (change) => {
    useWorkspaceStore.setState({ activeWorkspace: "replay", activeReplayId: session.id });
    const canApply = captureReplaySelection(session.id);
    const pending = Promise.resolve().then(() => canApply());
    const store = useWorkspaceStore.getState();
    if (change === "navigation") store.setWorkspace("terminal");
    if (change === "market") store.setSymbol("SOL/USDT");
    if (change === "session") store.setActiveReplayId("other-replay");
    if (change === "reset") store.setActiveReplayId(null);
    if (change === "away-and-back") {
      store.setWorkspace("research");
      store.setWorkspace("replay");
    }
    expect(await pending).toBe(false);
  });

  it("allows refresh only for the selected replay and ignores unrelated theme changes", () => {
    useWorkspaceStore.getState().setActiveReplayId(session.id);
    const canApply = captureReplaySelection(session.id);
    useWorkspaceStore.getState().setTheme("light");
    expect(canApply()).toBe(true);
    expect(captureReplaySelection("older-replay")()).toBe(false);
  });
});
