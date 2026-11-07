import type { WorkspaceState } from "@newbeing/core";

/** The three views the shell can render. `activeWorkspace` already carries this
 *  union, so the routes and the store cannot drift apart silently. */
export type WorkspaceId = WorkspaceState["activeWorkspace"];

/** One URL per view. Every entry point — the top-bar tabs, the number keys, the
 *  derivatives top bar — pushes these, so a view can be linked, bookmarked and
 *  reached with the browser's back button. */
export const WORKSPACE_PATH: Record<WorkspaceId, string> = {
  terminal: "/w/markets",
  research: "/w/research",
  replay: "/w/replay",
};

export const WORKSPACE_SLUGS = ["markets", "research", "replay"] as const;
export type WorkspaceSlug = (typeof WORKSPACE_SLUGS)[number];

export const SLUG_WORKSPACE: Record<WorkspaceSlug, WorkspaceId> = {
  markets: "terminal",
  research: "research",
  replay: "replay",
};

export function isWorkspaceSlug(value: string): value is WorkspaceSlug {
  return (WORKSPACE_SLUGS as readonly string[]).includes(value);
}

/** A saved run is addressable on its own: the link opens Research with that
 *  result loaded. Kept out of the `/w/` segment so the shell keeps one mounted
 *  page while the address changes under it. */
export function runPath(resultId: string): string {
  return `/runs/${encodeURIComponent(resultId)}`;
}

const RUN_ID = /^[A-Za-z0-9-]{8,64}$/;

export function isRunId(value: string): boolean {
  return RUN_ID.test(value);
}
