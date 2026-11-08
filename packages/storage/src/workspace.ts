import { eq } from "drizzle-orm";
import { DEFAULT_WORKSPACE_STATE, type WorkspaceState } from "@newbeing/core";
import { getDatabase } from "./db.js";
import { workspaceStates } from "./schema.js";

export function getWorkspaceState(): { state: WorkspaceState; updatedAt: number } {
  const row = getDatabase().select().from(workspaceStates).where(eq(workspaceStates.id, 1)).get();
  if (!row) return { state: DEFAULT_WORKSPACE_STATE, updatedAt: 0 };
  try {
    /* Read the stored value as a plain string: the typed union no longer admits
       "backtest", and that is exactly the legacy value we must detect. */
    const raw = JSON.parse(row.payload) as Record<string, unknown>;
    /* A row written before the Backtest workspace was absorbed still names it.
       Normalising on READ (rather than only on write) means the API never
       returns a workspace the UI cannot render, even before the next save. */
    const activeWorkspace = raw.activeWorkspace === "backtest" ? "research" : raw.activeWorkspace;
    return {
      state: {
        ...DEFAULT_WORKSPACE_STATE,
        ...(raw as Partial<WorkspaceState>),
        activeWorkspace: activeWorkspace as WorkspaceState["activeWorkspace"],
      },
      updatedAt: row.updatedAt,
    };
  } catch {
    return { state: DEFAULT_WORKSPACE_STATE, updatedAt: row.updatedAt };
  }
}

export function saveWorkspaceState(state: WorkspaceState): number {
  const updatedAt = Math.max(Date.now(), getWorkspaceState().updatedAt + 1);
  getDatabase().insert(workspaceStates).values({ id: 1, payload: JSON.stringify(state), updatedAt })
    .onConflictDoUpdate({ target: workspaceStates.id, set: { payload: JSON.stringify(state), updatedAt } }).run();
  return updatedAt;
}

export interface WorkspaceWriteResult { committed: boolean; updatedAt: number }

/** Conditional workspace write: commits only while the stored row still carries
 *  expectedUpdatedAt (0 = no row yet), inside the same immediate transaction the
 *  Paper guards read. A writer that read version N cannot commit over version
 *  N+1 written by someone else in between — a late or retried request is
 *  rejected with the current version instead of blindly overwriting. */
export function saveWorkspaceStateIfVersion(state: WorkspaceState, expectedUpdatedAt: number): WorkspaceWriteResult {
  return getDatabase().transaction(() => {
    const current = getWorkspaceState();
    if (current.updatedAt !== expectedUpdatedAt) return { committed: false, updatedAt: current.updatedAt };
    const updatedAt = Math.max(Date.now(), current.updatedAt + 1);
    getDatabase().insert(workspaceStates).values({ id: 1, payload: JSON.stringify(state), updatedAt })
      .onConflictDoUpdate({ target: workspaceStates.id, set: { payload: JSON.stringify(state), updatedAt } }).run();
    return { committed: true, updatedAt };
  }, { behavior: "immediate" });
}
