import { NextResponse } from "next/server";
import { getExperiment, getWorkspaceState } from "@newbeing/storage";

export const runtime = "nodejs";

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }): Promise<NextResponse> {
  if (getWorkspaceState().state.activeWorkspace === "replay") {
    return NextResponse.json({ error: "Backtest results are hidden during Replay to avoid future-derived outcomes." }, { status: 409 });
  }
  const { id } = await context.params;
  const result = getExperiment(id);
  return result
    ? NextResponse.json(result, { headers: { "Cache-Control": "no-store" } })
    : NextResponse.json({ error: "Backtest result not found." }, { status: 404 });
}
