"use client";

import { useEffect } from "react";
import { toSharedWorkspaceState, useWorkspaceStore } from "@/store/workspace";
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
    let isSending = false;
    let pendingSend = false;
    let debounce: ReturnType<typeof setTimeout> | undefined;
    let poll: ReturnType<typeof setInterval> | undefined;

    const sendState = async (): Promise<void> => {
      if (stopped) return;
      if (isSending) {
        pendingSend = true;
        return;
      }
      isSending = true;
      const state = toSharedWorkspaceState(useWorkspaceStore.getState());
      const stateJson = JSON.stringify(state);
      try {
        const response = await fetch("/api/workspace", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: stateJson,
        });
        if (stopped || !response.ok) return;
        const envelope = (await response.json()) as WorkspaceEnvelope;
        if (stopped) return;
        lastLocalWrite = envelope.updatedAt;
        lastServerTime = Math.max(lastServerTime, envelope.updatedAt);
        lastSyncedJson = JSON.stringify(envelope.state);
        /* The server is the authority on venue-consistent values: it re-denominates
           a pair the venue does not list (BTC/USDT on Kraken). If it corrected
           anything, adopt its version rather than keeping the value it rejected,
           which would otherwise stick in the UI forever. */
        if (lastSyncedJson !== stateJson) {
          useWorkspaceStore.getState().setFromRemote(envelope.state, envelope.updatedAt);
        } else {
          useWorkspaceStore.getState().markSynced(envelope.updatedAt);
        }
      } catch {
        // The browser's persisted Zustand snapshot remains the offline fallback.
      } finally {
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
      const remote = await readRemote();
      if (stopped) return;
      if (remote) {
        lastServerTime = remote.updatedAt;
        const localTimestamp = useWorkspaceStore.getState().syncUpdatedAt;
        /* The persisted browser snapshot is a cache of the shared workspace, not a
           competing source of truth: it can be stale from another tab, another
           session, or a state the server has since moved past. Until this tab
           writes, the server's copy wins — otherwise reopening the app silently
           pushes an old symbol/timeframe back over the stored one. */
        if (remote.updatedAt >= localTimestamp) {
          lastSyncedJson = JSON.stringify(remote.state);
          useWorkspaceStore.getState().setFromRemote(remote.state, remote.updatedAt);
        } else {
          lastSyncedJson = JSON.stringify(toSharedWorkspaceState(useWorkspaceStore.getState()));
          await sendState();
          if (stopped) return;
        }
      } else {
        lastSyncedJson = JSON.stringify(toSharedWorkspaceState(useWorkspaceStore.getState()));
      }
      ready = true;
      useWorkspaceStore.getState().setWorkspaceReady(true);
      poll = setInterval(() => {
        void (async () => {
          const next = await readRemote();
          if (stopped || !next || next.updatedAt <= lastServerTime) return;
          lastServerTime = next.updatedAt;
          if (next.updatedAt <= lastLocalWrite) return;
          const currentShared = toSharedWorkspaceState(useWorkspaceStore.getState());
          const currentJson = JSON.stringify(currentShared);
          const nextJson = JSON.stringify(next.state);
          if (currentJson !== nextJson) {
            lastSyncedJson = nextJson;
            useWorkspaceStore.getState().setFromRemote(next.state, next.updatedAt);
          }
        })();
      }, 1_500);
    };

    const unsubscribe = useWorkspaceStore.subscribe((state, previous) => {
      if (!ready || stopped) return;
      const currentShared = toSharedWorkspaceState(state);
      const currentJson = JSON.stringify(currentShared);
      if (currentJson === lastSyncedJson) return;

      const previousShared = toSharedWorkspaceState(previous);
      const isOnlyContinuous =
        currentShared.activeWorkspace === previousShared.activeWorkspace &&
        currentShared.symbol === previousShared.symbol &&
        currentShared.timeframe === previousShared.timeframe &&
        currentShared.exchange === previousShared.exchange &&
        currentShared.selectedStrategyId === previousShared.selectedStrategyId &&
        currentShared.activeBacktestId === previousShared.activeBacktestId &&
        currentShared.activeReplayId === previousShared.activeReplayId;

      if (debounce) clearTimeout(debounce);
      if (isOnlyContinuous) {
        debounce = setTimeout(() => void sendState(), 100);
      } else {
        void sendState();
      }
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
