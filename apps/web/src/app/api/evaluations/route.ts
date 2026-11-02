import { NextResponse } from "next/server";
import { listSavedEvaluations } from "@newbeing/storage";
import { z } from "zod";
import { runResearchEvaluation, SWEEP_MAX_RUNS } from "@newbeing/application";
import { researchFailure, researchReadGuard } from "@/lib/research-route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_EVALUATION_BODY_BYTES = 1_000_000;
const EVALUATION_LIMIT = z.coerce.number().int().min(1).max(100);
const bodyTooLarge = () => NextResponse.json({ error: "Evaluation request body is too large." }, { status: 413, headers: { "Cache-Control": "no-store" } });

// Streams the request body with a hard byte cap so a chunked body cannot buffer past the limit.
async function readBodyCapped(request: Request, cap: number): Promise<string | null> {
  const body = request.body;
  if (!body) return null;
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let bytes = 0;
  const chunks: Uint8Array[] = [];
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    bytes += value.byteLength;
    if (bytes > cap) {
      reader.cancel().catch(() => undefined);
      return null;
    }
    chunks.push(value);
  }
  const parts: string[] = [];
  for (const chunk of chunks) parts.push(decoder.decode(chunk, { stream: true }));
  parts.push(decoder.decode());
  return parts.join("");
}

const requestSchema = z.object({
  datasetId: z.string().regex(/^sha256:[a-f0-9]{64}$/),
  strategyId: z.string().min(1).max(120),
  candidates: z.array(z.record(z.string(), z.union([z.number().finite(), z.boolean()]))).min(1).max(SWEEP_MAX_RUNS),
  config: z.object({
    accountMode: z.literal("spot").default("spot"), initialCapital: z.number().finite().positive().max(1_000_000_000),
    positionFraction: z.number().finite().positive().max(1), feeRate: z.number().finite().min(0).max(0.05),
    slippageRate: z.number().finite().min(0).max(0.05), allowShorts: z.literal(false),
    stopLossPct: z.number().finite().positive().lt(1).optional(), takeProfitPct: z.number().finite().positive().lt(10).optional(),
  }).strict(),
  splitIndex: z.number().int().min(2),
  sweepParameter: z.string().min(1).max(120).optional(),
}).strict();

export async function GET(request: Request): Promise<NextResponse> {
  const guard = researchReadGuard();
  if (guard) return guard;
  const limit = EVALUATION_LIMIT.safeParse(new URL(request.url).searchParams.get("limit") ?? 20);
  if (!limit.success) return NextResponse.json({ error: "Invalid evaluation limit." }, { status: 400, headers: { "Cache-Control": "no-store" } });
  const reports = listSavedEvaluations(limit.data).map((row) => ({
    ...JSON.parse(row.report),
    reportId: row.evaluationId,
    createdAt: new Date(row.createdAt).toISOString(),
  }));
  return NextResponse.json(reports, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: Request): Promise<NextResponse> {
  const guard = researchReadGuard();
  if (guard) return guard;
  const declaredLength = request.headers.get("content-length");
  if (declaredLength !== null && Number(declaredLength) > MAX_EVALUATION_BODY_BYTES) {
    return bodyTooLarge();
  }
  try {
    const originalRequest = await readBodyCapped(request, MAX_EVALUATION_BODY_BYTES);
    if (originalRequest === null) {
      return bodyTooLarge();
    }
    const parsed = requestSchema.safeParse(JSON.parse(originalRequest));
    if (!parsed.success) return NextResponse.json({ error: "Invalid evaluation request.", maxRuns: SWEEP_MAX_RUNS }, { status: 400 });
    const { stopLossPct, takeProfitPct, ...config } = parsed.data.config;
    const result = runResearchEvaluation({ ...parsed.data, config: { ...config, ...(stopLossPct === undefined ? {} : { stopLossPct }), ...(takeProfitPct === undefined ? {} : { takeProfitPct }) } }, originalRequest);
    return NextResponse.json(result, { status: 201, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return researchFailure(error);
  }
}
