import { NextResponse } from "next/server";
import { z } from "zod";
import { runBacktestSweep, SWEEP_MAX_RUNS } from "@newbeing/application";
import { getWorkspaceState, listSavedSweeps } from "@newbeing/storage";
import { researchFailure, researchReadGuard } from "@/lib/research-route";
import { EXCHANGE_TIMEFRAMES, logEvent, type ExchangeId } from "@newbeing/core";
import { getWebMarketAdapter } from "@/lib/market-adapter";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const requestSchema = z.object({
  symbol: z.string().regex(/^[A-Z0-9]{2,20}\/[A-Z0-9]{2,20}$/),
  timeframe: z.enum(["1m", "5m", "15m", "30m", "1h", "4h", "1d"]),
  exchange: z.enum(["binance", "coinbaseexchange", "okx", "kraken"]).optional(),
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
  parameter: z.string().min(1).max(60),
  from: z.number().finite(),
  to: z.number().finite(),
  step: z.number().finite().positive(),
  limit: z.number().int().min(50).max(1000).optional(),
});

export async function GET(request: Request): Promise<NextResponse> {
  const guard = researchReadGuard();
  if (guard) return guard;
  const limit = z.coerce.number().int().min(1).max(100).safeParse(new URL(request.url).searchParams.get("limit") ?? 20);
  if (!limit.success) return NextResponse.json({ error: "Invalid sweep limit." }, { status: 400 });
  return NextResponse.json({ items: listSavedSweeps(limit.data) }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: Request): Promise<NextResponse> {
  const guard = researchReadGuard();
  if (guard) return guard;
  try {
    const body: unknown = await request.json();
    const parsed = requestSchema.safeParse(body);
    if (!parsed.success) return NextResponse.json({ error: "Invalid sweep request." }, { status: 400 });

    const exchange: ExchangeId = parsed.data.exchange ?? getWorkspaceState().state.exchange;
    if (!EXCHANGE_TIMEFRAMES[exchange].includes(parsed.data.timeframe)) {
      return NextResponse.json({ error: `${exchange} does not provide ${parsed.data.timeframe} candles.` }, { status: 422 });
    }

    const result = await runBacktestSweep(
      {
        exchange,
        symbol: parsed.data.symbol,
        timeframe: parsed.data.timeframe,
        strategyId: parsed.data.strategyId,
        parameters: parsed.data.parameters,
        /* exactOptionalPropertyTypes: an absent optional must be ABSENT, not
           present-and-undefined, so spread it in conditionally. */
        config: {
          initialCapital: parsed.data.config.initialCapital,
          positionFraction: parsed.data.config.positionFraction,
          feeRate: parsed.data.config.feeRate,
          slippageRate: parsed.data.config.slippageRate,
          allowShorts: parsed.data.config.allowShorts,
          ...(parsed.data.config.stopLossPct === undefined ? {} : { stopLossPct: parsed.data.config.stopLossPct }),
          ...(parsed.data.config.takeProfitPct === undefined ? {} : { takeProfitPct: parsed.data.config.takeProfitPct }),
        },
        parameter: parsed.data.parameter,
        from: parsed.data.from,
        to: parsed.data.to,
        step: parsed.data.step,
        ...(parsed.data.limit === undefined ? {} : { limit: parsed.data.limit }),
      },
      { marketAdapter: getWebMarketAdapter(exchange) },
    );
    return NextResponse.json(result, { status: 201, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Sweep failed.";
    logEvent("warn", "sweep.failed", { message });
    /* 422: the request was understood but the range or dataset cannot be swept.
       A range over the run ceiling is the common case and the message says how
       to fix it. */
    const failure = researchFailure(error);
    if (failure.status !== 422) return failure;
    return NextResponse.json({ error: message, maxRuns: SWEEP_MAX_RUNS }, { status: 422 });
  }
}
