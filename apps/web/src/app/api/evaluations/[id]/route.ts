import { NextResponse } from "next/server";
import { getSavedEvaluation } from "@newbeing/storage";
import { researchReadGuard } from "@/lib/research-route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }): Promise<NextResponse> {
  const guard = researchReadGuard();
  if (guard) return guard;
  const { id } = await context.params;
  const saved = getSavedEvaluation(id);
  if (!saved) return NextResponse.json({ error: "Evaluation not found." }, { status: 404, headers: { "Cache-Control": "no-store" } });
  return NextResponse.json({
    ...JSON.parse(saved.report),
    reportId: saved.evaluationId,
    createdAt: new Date(saved.createdAt).toISOString(),
    request: saved.request,
  }, { headers: { "Cache-Control": "no-store" } });
}
