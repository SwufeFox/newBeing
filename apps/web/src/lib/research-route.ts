import { NextResponse } from "next/server";
import { ResearchError } from "@newbeing/application";
import { getWorkspaceState } from "@newbeing/storage";

export function researchReadGuard(): NextResponse | null {
  return getWorkspaceState().state.activeWorkspace === "replay"
    ? NextResponse.json({ error: "Research results are hidden during Replay to avoid future-derived outcomes." }, { status: 409 }) : null;
}
export function researchFailure(error: unknown): NextResponse {
  const status = error instanceof SyntaxError ? 400 : error instanceof ResearchError ? error.status : 422;
  return NextResponse.json({ error: error instanceof Error ? error.message : "Research operation failed." }, { status, headers: { "Cache-Control": "no-store" } });
}
/** Saved reruns accept no overrides, including empty-looking unknown keys. */
export async function validateRerunBody(request: Request): Promise<boolean> {
  const text = await request.text();
  if (!text.trim()) return true;
  const body: unknown = JSON.parse(text);
  return typeof body === "object" && body !== null && !Array.isArray(body) && Object.keys(body).length === 0;
}
