"use client";

import { useEffect } from "react";
import { replayIdentity, toSharedWorkspaceState, useWorkspaceStore } from "@/store/workspace";
import type { WorkspaceState } from "@newbeing/core";

interface WorkspaceEnvelope {
  state: WorkspaceState;
  updatedAt: number;
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
    let pendingSend = false;
    let debounce: ReturnType<typeof setTimeout> | undefined;
    let poll: ReturnType<typeof setInterval> | undefined;
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
      const timeout = setTimeout(() => {
        const current = useWorkspaceStore.getState();
        if (!stopped && sentIdentityRevision === identityRevision && current.activeWorkspace === "replay" && current.replayConfirmedJson !== sentIdentity) {
          useWorkspaceStore.setState({ replaySyncError: "The server request is still pending. Retry will wait for it to finish; you can cancel the switch." });
        }
      }, 10_000);
      try {
        const response = await fetch("/api/workspace", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: stateJson,
        });
        if (!response.ok) throw new Error(`Workspace sync failed (${response.status}).`);
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
      poll = setInterval(() => {
        const readRevision = revision;
        if (isSending || currentJson() !== lastSyncedJson) return;
        void (async () => {
          const next = await readRemote();
          if (stopped || !next || isSending || readRevision !== revision || currentJson() !== lastSyncedJson || next.updatedAt <= lastServerTime) return;
          lastServerTime = next.updatedAt;
          if (next.updatedAt <= lastLocalWrite) return;
          lastSyncedJson = JSON.stringify(next.state);
          useWorkspaceStore.getState().setFromRemote(next.state, next.updatedAt);
          if (next.state.activeWorkspace === "replay" && replayIdentity(useWorkspaceStore.getState()) === replayIdentity(next.state)) {
            useWorkspaceStore.setState({ replayConfirmedJson: replayIdentity(next.state), replaySyncError: null });
          }
        })();
      }, 1_500);
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
        if (isSending) {
          pendingSend = true;
          useWorkspaceStore.setState({ replaySyncError: "Retry is queued until the pending server request finishes. You can cancel the switch." });
        } else {
          void sendState();
        }
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
    };
  }, []);
  return null;
}
