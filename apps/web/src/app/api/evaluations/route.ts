import { NextResponse } from "next/server";
import { z } from "zod";
import { runResearchEvaluation, SWEEP_MAX_RUNS } from "@newbeing/application";
import { researchFailure, researchReadGuard } from "@/lib/research-route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const requestSchema = z.object({
  datasetId: z.string().regex(/^sha256:[a-f0-9]{64}$/),
  strategyId: z.string().min(1).max(120),
  candidates: z.array(z.record(z.string(), z.union([z.number().finite(), z.boolean()]))).min(1).max(SWEEP_MAX_RUNS),
  config: z.object({
    accountMode: z.literal("spot").default("spot"),
    initialCapital: z.number().finite().positive().max(1_000_000_000),
    positionFraction: z.number().finite().positive().max(1),
    feeRate: z.number().finite().min(0).max(0.05),
    slippageRate: z.number().finite().min(0).max(0.05),
    allowShorts: z.literal(false),
    stopLossPct: z.number().finite().positive().lt(1).optional(),
    takeProfitPct: z.number().finite().positive().lt(10).optional(),
  }).strict(),
  splitIndex: z.number().int().min(2),
}).strict();

export async function POST(request: Request): Promise<NextResponse> {
  const guard = researchReadGuard();
  if (guard) return guard;
  try {
    const parsed = requestSchema.safeParse(await request.json());
    if (!parsed.success) return NextResponse.json({ error: "Invalid evaluation request.", maxRuns: SWEEP_MAX_RUNS }, { status: 400 });
    const { stopLossPct, takeProfitPct, ...config } = parsed.data.config;
    const result = runResearchEvaluation({
      ...parsed.data,
      config: {
        ...config,
        ...(stopLossPct === undefined ? {} : { stopLossPct }),
        ...(takeProfitPct === undefined ? {} : { takeProfitPct }),
      },
    });
    return NextResponse.json(result, { status: 201, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return researchFailure(error);
  }
}
