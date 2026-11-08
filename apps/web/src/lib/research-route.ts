import { NextResponse } from "next/server";
import { assertResearchAvailable, ResearchError } from "@newbeing/application";

export function researchReadGuard(message = "Research results are hidden during Replay to avoid future-derived outcomes."): NextResponse | null {
  try {
    assertResearchAvailable(message);
    return null;
  } catch (error) {
    if (!(error instanceof ResearchError)) throw error;
    return NextResponse.json({ error: message }, { status: error.status });
  }
}
export function researchFailure(error: unknown): NextResponse {
  const status = error instanceof SyntaxError ? 400 : error instanceof ResearchError ? error.status : 422;
  return NextResponse.json({
    error: error instanceof Error ? error.message : "Research operation failed.",
    ...(error instanceof ResearchError && error.code !== undefined ? { code: error.code } : {}),
    ...(error instanceof ResearchError && error.nextAction !== undefined ? { nextAction: error.nextAction } : {}),
  }, { status, headers: { "Cache-Control": "no-store" } });
}
/** Saved reruns accept no overrides, including empty-looking unknown keys. */
export async function validateRerunBody(request: Request): Promise<boolean> {
  const text = await request.text();
  if (!text.trim()) return true;
  const body: unknown = JSON.parse(text);
  return typeof body === "object" && body !== null && !Array.isArray(body) && Object.keys(body).length === 0;
}
