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
    const response = await fetch("/api/workspace", { cache: "no-store" });
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
    let applyingRemote = false;
    let lastServerTime = 0;
    let lastLocalWrite = 0;
    let debounce: ReturnType<typeof setTimeout> | undefined;
    let poll: ReturnType<typeof setInterval> | undefined;

    const sendState = async (): Promise<void> => {
      const state = toSharedWorkspaceState(useWorkspaceStore.getState());
      try {
        const response = await fetch("/api/workspace", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(state),
        });
        if (!response.ok) return;
        const envelope = await response.json() as WorkspaceEnvelope;
        lastLocalWrite = envelope.updatedAt;
        lastServerTime = Math.max(lastServerTime, envelope.updatedAt);
        useWorkspaceStore.getState().markSynced(envelope.updatedAt);
      } catch {
        // The browser's persisted Zustand snapshot remains the offline fallback.
      }
    };

    const synchronize = async (): Promise<void> => {
      await useWorkspaceStore.persist.rehydrate();
      if (stopped) return;
      const remote = await readRemote();
      if (remote) {
        lastServerTime = remote.updatedAt;
        const localTimestamp = useWorkspaceStore.getState().syncUpdatedAt;
        if (remote.updatedAt > localTimestamp) {
          applyingRemote = true;
          useWorkspaceStore.getState().setFromRemote(remote.state, remote.updatedAt);
        } else {
          await sendState();
        }
      }
      ready = true;
      poll = setInterval(() => {
        void (async () => {
          const next = await readRemote();
          if (!next || next.updatedAt <= lastServerTime) return;
          lastServerTime = next.updatedAt;
          if (next.updatedAt <= lastLocalWrite) return;
          const local = toSharedWorkspaceState(useWorkspaceStore.getState());
          if (JSON.stringify(local) !== JSON.stringify(next.state)) {
            applyingRemote = true;
            useWorkspaceStore.getState().setFromRemote(next.state, next.updatedAt);
          }
        })();
      }, 1_500);
    };

    const unsubscribe = useWorkspaceStore.subscribe((state, previous) => {
      if (!ready || stopped) return;
      if (applyingRemote) {
        applyingRemote = false;
        return;
      }
      const nextShared = toSharedWorkspaceState(state);
      const previousShared = toSharedWorkspaceState(previous);
      if (JSON.stringify(nextShared) === JSON.stringify(previousShared)) return;
      if (debounce) clearTimeout(debounce);
      debounce = setTimeout(() => void sendState(), 350);
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
