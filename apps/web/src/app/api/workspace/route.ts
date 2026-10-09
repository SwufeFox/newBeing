import { NextResponse } from "next/server";
import { z } from "zod";
import { DEFAULT_WORKSPACE_STATE, type WorkspaceState } from "@newbeing/core";
import { getWorkspaceState, saveWorkspaceState } from "@newbeing/storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const stateSchema = z.object({
  symbol: z.string().regex(/^[A-Z0-9]{2,20}\/[A-Z0-9]{2,20}$/),
  timeframe: z.enum(["1m", "5m", "15m", "30m", "1h", "4h", "1d"]),
  exchange: z.literal("binance"),
  mode: z.literal("paper"),
  activeWorkspace: z.enum(["terminal", "research", "backtest", "replay"]),
  selectedStrategyId: z.string().min(1).max(120),
  activeBacktestId: z.string().max(120).nullable(),
  activeReplayId: z.string().max(120).nullable(),
  visibleRange: z.object({ from: z.number().nullable(), to: z.number().nullable() }),
  layout: z.object({
    watchlistWidth: z.number().min(160).max(360),
    inspectorWidth: z.number().min(240).max(480),
    bottomHeight: z.number().min(150).max(480),
  }),
});

export async function GET(): Promise<NextResponse> {
  try {
    return NextResponse.json(getWorkspaceState(), { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ state: DEFAULT_WORKSPACE_STATE, updatedAt: 0 });
  }
}

export async function PUT(request: Request): Promise<NextResponse> {
  try {
    const body: unknown = await request.json();
    const parsed = stateSchema.safeParse(body);
    if (!parsed.success) return NextResponse.json({ error: "Invalid workspace state." }, { status: 400 });
    const state: WorkspaceState = parsed.data;
    const updatedAt = saveWorkspaceState(state);
    return NextResponse.json({ state, updatedAt }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Workspace persistence failed.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
