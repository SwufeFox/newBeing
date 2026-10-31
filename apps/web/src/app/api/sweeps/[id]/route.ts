import { NextResponse } from "next/server";
import { getSavedSweep } from "@newbeing/storage";
import { researchFailure, researchReadGuard } from "@/lib/research-route";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }): Promise<NextResponse> {
  const guard = researchReadGuard();
  if (guard) return guard;
  try {
    const { id } = await context.params;
    const result = getSavedSweep(id);
    if (!result) return NextResponse.json({ error: "Sweep result not found." }, { status: 404 });
    const report = { ...result, mode: result.mode ?? (result.walkForward ? "walk-forward" : "full-sample") };
    return NextResponse.json(report, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return researchFailure(error); }
}
