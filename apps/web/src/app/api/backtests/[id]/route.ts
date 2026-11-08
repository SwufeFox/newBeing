import { NextResponse } from "next/server";
import { getExperiment } from "@newbeing/storage";
import { researchReadGuard } from "@/lib/research-route";

export const runtime = "nodejs";

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }): Promise<NextResponse> {
  const guard = researchReadGuard("Backtest results are hidden during Replay to avoid future-derived outcomes.");
  if (guard) return guard;
  const { id } = await context.params;
  const result = getExperiment(id);
  return result
    ? NextResponse.json(result, { headers: { "Cache-Control": "no-store" } })
    : NextResponse.json({ error: "Backtest result not found." }, { status: 404 });
}
