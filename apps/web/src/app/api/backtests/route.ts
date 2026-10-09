import { NextResponse } from "next/server";
import { z } from "zod";
import { runResearchBacktest } from "@newbeing/application";
import { getWorkspaceState, listExperiments } from "@newbeing/storage";
import { logEvent } from "@newbeing/core";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const requestSchema = z.object({
  symbol: z.string().regex(/^[A-Z0-9]{2,20}\/[A-Z0-9]{2,20}$/),
  timeframe: z.enum(["1m", "5m", "15m", "30m", "1h", "4h", "1d"]),
  strategyId: z.string().min(1).max(120),
  parameters: z.record(z.string(), z.union([z.number().finite(), z.boolean()])),
  config: z.object({
    initialCapital: z.number().positive().max(1_000_000_000),
    positionFraction: z.number().positive().max(1),
    feeRate: z.number().min(0).max(0.05),
    slippageRate: z.number().min(0).max(0.05),
    allowShorts: z.boolean(),
    stopLossPct: z.number().positive().max(0.99).optional(),
    takeProfitPct: z.number().positive().max(9.99).optional(),
  }),
  limit: z.number().int().min(50).max(1000).optional(),
});

export async function GET(request: Request): Promise<NextResponse> {
  if (getWorkspaceState().state.activeWorkspace === "replay") {
    return NextResponse.json({ error: "Backtest history is hidden during Replay to avoid future-derived results." }, { status: 409 });
  }
  const limitParam = new URL(request.url).searchParams.get("limit");
  const parsed = z.coerce.number().int().min(1).max(100).safeParse(limitParam ?? 20);
  if (!parsed.success) return NextResponse.json({ error: "Invalid experiment limit." }, { status: 400 });
  return NextResponse.json({ items: listExperiments(parsed.data) }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: Request): Promise<NextResponse> {
  try {
    const body: unknown = await request.json();
    const parsed = requestSchema.safeParse(body);
    if (!parsed.success) return NextResponse.json({ error: "Invalid backtest request." }, { status: 400 });
    const config = {
      initialCapital: parsed.data.config.initialCapital,
      positionFraction: parsed.data.config.positionFraction,
      feeRate: parsed.data.config.feeRate,
      slippageRate: parsed.data.config.slippageRate,
      allowShorts: parsed.data.config.allowShorts,
      ...(parsed.data.config.stopLossPct === undefined ? {} : { stopLossPct: parsed.data.config.stopLossPct }),
      ...(parsed.data.config.takeProfitPct === undefined ? {} : { takeProfitPct: parsed.data.config.takeProfitPct }),
    };
    const result = await runResearchBacktest({
      symbol: parsed.data.symbol,
      timeframe: parsed.data.timeframe,
      strategyId: parsed.data.strategyId,
      parameters: parsed.data.parameters,
      config,
      ...(parsed.data.limit === undefined ? {} : { limit: parsed.data.limit }),
    });
    return NextResponse.json(result, { status: 201, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Backtest failed.";
    logEvent("warn", "backtest.failed", { message });
    return NextResponse.json({ error: message }, { status: 422 });
  }
}
