"use client";

import { useEffect } from "react";
import { replayIdentity, toSharedWorkspaceState, useWorkspaceStore } from "@/store/workspace";
import type { WorkspaceState } from "@newbeing/core";

interface WorkspaceEnvelope {
  state: WorkspaceState;
  updatedAt: number;
}

const PENDING_WORKSPACE_NAVIGATION_KEY = "newbeing:pending-workspace-navigation";
type WorkspaceNavigationTarget = "terminal" | "research" | "replay";

export function queueWorkspaceNavigation(target: WorkspaceNavigationTarget): void {
  try {
    window.sessionStorage.setItem(PENDING_WORKSPACE_NAVIGATION_KEY, target);
  } catch {
    // Navigation still proceeds if session storage is unavailable.
  }
}

function consumeWorkspaceNavigation(): WorkspaceNavigationTarget | null {
  try {
    const target = window.sessionStorage.getItem(PENDING_WORKSPACE_NAVIGATION_KEY);
    window.sessionStorage.removeItem(PENDING_WORKSPACE_NAVIGATION_KEY);
    return target === "terminal" || target === "research" || target === "replay" ? target : null;
  } catch {
    return null;
  }
}

async function readRemote(): Promise<WorkspaceEnvelope | null> {
  try {
    const response = await fetch("/api/workspace", { cache: "no-store", signal: AbortSignal.timeout(10_000) });
    if (!response.ok) return null;
    const payload: unknown = await response.json();
    if (typeof payload !== "object" || payload === null || !("state" in payload) || !("updatedAt" in payload)) return null;
    return payload as WorkspaceEnvelope;
  } catch {
    return null;
  }
}

export function WorkspaceSync(): null {
  useEffect(() => {
    let stopped = false;
    let ready = false;
    let lastServerTime = 0;
    let lastLocalWrite = 0;
    let lastSyncedJson = "";
    let revision = 0;
    let identityRevision = 0;
    let isSending = false;
    let isPolling = false;
    let lastFocusRefreshAt = 0;
    let pendingSend = false;
    let debounce: ReturnType<typeof setTimeout> | undefined;
    let poll: number | undefined;
    const currentJson = (): string => JSON.stringify(toSharedWorkspaceState(useWorkspaceStore.getState()));

    const sendState = async (): Promise<void> => {
      if (stopped) return;
      if (isSending) {
        pendingSend = true;
        const current = useWorkspaceStore.getState();
        if (current.activeWorkspace === "replay" && current.replayConfirmedJson !== replayIdentity(current)) {
          useWorkspaceStore.setState({ replaySyncError: "Replay confirmation is queued until the pending server request finishes. You can cancel the switch." });
        }
        return;
      }
      isSending = true;
      const sentState = toSharedWorkspaceState(useWorkspaceStore.getState());
      const stateJson = JSON.stringify(sentState);
      const sentIdentity = replayIdentity(sentState);
      const sentIdentityRevision = identityRevision;
      /* Optimistic concurrency: commit only if the server row is still at the
         version this tab last read. A stale request that hung in the browser
         and lands later is rejected instead of overwriting newer state, so a
         retry does not have to wait for the old request to finish. */
      const expectedVersion = lastServerTime;
      const timeout = setTimeout(() => {
        const current = useWorkspaceStore.getState();
        if (!stopped && sentIdentityRevision === identityRevision && current.activeWorkspace === "replay" && current.replayConfirmedJson !== sentIdentity) {
          useWorkspaceStore.setState({ replaySyncError: "The server request timed out and will be retried automatically. You can cancel the switch." });
        }
      }, 10_000);
      try {
        const response = await fetch("/api/workspace", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ...sentState, expectedUpdatedAt: expectedVersion }),
          // A hung write must settle so the next attempt can run. If the server
          // actually committed before the abort, its version moved ahead and the
          // retry gets a 409 carrying the authoritative state, so the late
          // arrival can no longer overwrite anything.
          signal: AbortSignal.timeout(10_000),
        });
        if (!response.ok) {
          if (response.status === 409) {
            // The server rejected this write as stale. Adopt its authoritative
            // state; the local change that lost simply becomes unsynced and the
            // next local edit (or an explicit retry) resends against the new
            // version. No waiting on the losing request is required.
            try {
              const conflict = (await response.json()) as WorkspaceEnvelope & { error: string };
              lastServerTime = Math.max(lastServerTime, conflict.updatedAt);
              lastSyncedJson = JSON.stringify(conflict.state);
              if (sentIdentityRevision === identityRevision) {
                const store = useWorkspaceStore.getState();
                if (store.activeWorkspace !== "replay" || replayIdentity(store) === replayIdentity(conflict.state)) {
                  store.setFromRemote(conflict.state, conflict.updatedAt);
                } else {
                  useWorkspaceStore.setState({ replaySyncError: "The server changed the requested Replay state. Retry or cancel the switch." });
                }
              }
            } catch { /* A malformed conflict body still counts as a failed write. */ }
            return;
          }
          throw new Error(`Workspace sync failed (${response.status}).`);
        }
        const envelope = (await response.json()) as WorkspaceEnvelope;
        if (stopped) return;
        const serverJson = JSON.stringify(envelope.state);
        lastLocalWrite = envelope.updatedAt;
        lastServerTime = Math.max(lastServerTime, envelope.updatedAt);
        lastSyncedJson = serverJson;
        // An older response must never overwrite or confirm a newer selection,
        // even if the user navigated away and back to identical values.
        if (sentIdentityRevision !== identityRevision || replayIdentity(useWorkspaceStore.getState()) !== sentIdentity) return;
        if (replayIdentity(envelope.state) !== sentIdentity) {
          if (useWorkspaceStore.getState().activeWorkspace === "replay") {
            useWorkspaceStore.setState({ replaySyncError: "The server changed the requested Replay state. Retry or cancel the switch." });
          } else if (currentJson() === stateJson) {
            useWorkspaceStore.getState().setFromRemote(envelope.state, envelope.updatedAt);
          }
        } else {
          useWorkspaceStore.getState().markSynced(envelope.updatedAt);
          if (envelope.state.activeWorkspace === "replay") {
            useWorkspaceStore.setState({ replayConfirmedJson: sentIdentity, replaySyncError: null });
          }
        }
      } catch {
        if (!stopped && sentIdentityRevision === identityRevision && replayIdentity(useWorkspaceStore.getState()) === sentIdentity && useWorkspaceStore.getState().activeWorkspace === "replay" && useWorkspaceStore.getState().replayConfirmedJson !== sentIdentity) {
          useWorkspaceStore.setState({ replaySyncError: "Could not confirm Replay with the server. Retry or cancel the switch." });
        }
      } finally {
        clearTimeout(timeout);
        isSending = false;
        if (pendingSend && !stopped) {
          pendingSend = false;
          void sendState();
        }
      }
    };

    const pollRemote = async (): Promise<void> => {
      if (stopped || !ready || document.hidden || isSending || isPolling || currentJson() !== lastSyncedJson) return;
      const readRevision = revision;
      isPolling = true;
      try {
        const next = await readRemote();
        if (stopped || !next || isSending || readRevision !== revision || currentJson() !== lastSyncedJson || next.updatedAt <= lastServerTime) return;
        lastServerTime = next.updatedAt;
        if (next.updatedAt <= lastLocalWrite) return;
        lastSyncedJson = JSON.stringify(next.state);
        useWorkspaceStore.getState().setFromRemote(next.state, next.updatedAt);
        if (next.state.activeWorkspace === "replay" && replayIdentity(useWorkspaceStore.getState()) === replayIdentity(next.state)) {
          useWorkspaceStore.setState({ replayConfirmedJson: replayIdentity(next.state), replaySyncError: null });
        }
      } finally {
        isPolling = false;
      }
    };

    const refreshWhenVisible = (): void => {
      if (document.hidden) return;
      const now = Date.now();
      if (now - lastFocusRefreshAt < 250) return;
      lastFocusRefreshAt = now;
      void pollRemote();
    };

    const synchronize = async (): Promise<void> => {
      await useWorkspaceStore.persist.rehydrate();
      if (stopped) return;
      const readRevision = revision;
      const remote = await readRemote();
      if (stopped) return;
      if (readRevision !== revision) {
        void sendState();
      } else if (remote) {
        lastServerTime = remote.updatedAt;
        const localTimestamp = useWorkspaceStore.getState().syncUpdatedAt;
        if (remote.updatedAt >= localTimestamp) {
          lastSyncedJson = JSON.stringify(remote.state);
          useWorkspaceStore.getState().setFromRemote(remote.state, remote.updatedAt);
          if (remote.state.activeWorkspace === "replay" && replayIdentity(useWorkspaceStore.getState()) === replayIdentity(remote.state)) {
            useWorkspaceStore.setState({ replayConfirmedJson: replayIdentity(remote.state), replaySyncError: null });
          }
        } else {
          void sendState();
        }
      } else if (useWorkspaceStore.getState().activeWorkspace === "replay") {
        useWorkspaceStore.setState({ replaySyncError: "Could not confirm Replay with the server. Retry or cancel the switch." });
      } else {
        lastSyncedJson = currentJson();
      }
      ready = true;
      useWorkspaceStore.getState().setWorkspaceReady(true);
      const pendingWorkspace = consumeWorkspaceNavigation();
      if (pendingWorkspace) {
        const store = useWorkspaceStore.getState();
        store.setWorkspace(pendingWorkspace);
        if (pendingWorkspace === "research") {
          store.setInspectorTab("strategy");
          store.setDockTab("backtest");
        }
      }
      poll = window.setInterval(() => { void pollRemote(); }, 3_000);
      document.addEventListener("visibilitychange", refreshWhenVisible);
      window.addEventListener("focus", refreshWhenVisible);
    };

    const unsubscribe = useWorkspaceStore.subscribe((state, previous) => {
      const stateJson = JSON.stringify(toSharedWorkspaceState(state));
      const previousJson = JSON.stringify(toSharedWorkspaceState(previous));
      if (stateJson !== previousJson) revision += 1;
      if (replayIdentity(state) !== replayIdentity(previous)) {
        identityRevision += 1;
        if (state.replayConfirmedJson || state.replaySyncError) {
          useWorkspaceStore.setState({ replayConfirmedJson: null, replaySyncError: null });
        }
      }
      if (!ready || stopped) return;
      if (state.replayRetry !== previous.replayRetry) {
        if (debounce) clearTimeout(debounce);
        void sendState();
        return;
      }
      if (stateJson === previousJson) return;
      if (stateJson === lastSyncedJson && !isSending && state.activeWorkspace !== "replay") return;
      const current = toSharedWorkspaceState(state);
      const prior = toSharedWorkspaceState(previous);
      const isOnlyContinuous = current.activeWorkspace === prior.activeWorkspace && current.symbol === prior.symbol &&
        current.timeframe === prior.timeframe && current.exchange === prior.exchange &&
        current.selectedStrategyId === prior.selectedStrategyId && current.activeBacktestId === prior.activeBacktestId &&
        current.activeReplayId === prior.activeReplayId;
      if (debounce) clearTimeout(debounce);
      if (isOnlyContinuous) debounce = setTimeout(() => void sendState(), 100);
      else void sendState();
    });

    void synchronize();
    return () => {
      stopped = true;
      unsubscribe();
      if (debounce) clearTimeout(debounce);
      if (poll) clearInterval(poll);
      document.removeEventListener("visibilitychange", refreshWhenVisible);
      window.removeEventListener("focus", refreshWhenVisible);
    };
  }, []);
  return null;
}
