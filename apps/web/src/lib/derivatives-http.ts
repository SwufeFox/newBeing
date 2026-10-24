import { NextResponse } from "next/server";
import { z } from "zod";
import { getWorkspaceState } from "@newbeing/storage";

export const derivativeIdSchema = z.string().min(8).max(240).regex(/^(okx|deribit):(perpetual|future|option):[^\s]+$/);
export const derivativeKindSchema = z.enum(["perpetual", "future", "option"]);
export const derivativeTimeframeSchema = z.enum(["1m", "5m", "15m", "30m", "1h", "4h", "1d"]);

export function derivativeJson(body: unknown, status = 200): NextResponse {
  return NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

/** Live derivatives are a separate workspace, never an escape from a frozen cursor. */
export function derivativeReplayRejection(): NextResponse | null {
  return getWorkspaceState().state.activeWorkspace === "replay"
    ? derivativeJson({ error: "Live derivatives and normal Paper accounts are hidden during Replay. Return to Markets first." }, 409)
    : null;
}

export function derivativeFailure(error: unknown, status = 503): NextResponse {
  if (error instanceof z.ZodError || error instanceof SyntaxError) {
    return derivativeJson({ error: "Invalid derivatives request." }, 400);
  }
  return derivativeJson({ error: error instanceof Error ? error.message : "Derivatives request failed." }, status);
}
