import { NextResponse } from "next/server";
import { rerunBacktestSweep } from "@newbeing/application";
import { researchFailure, researchReadGuard, validateRerunBody } from "@/lib/research-route";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function POST(request: Request, context: { params: Promise<{ id: string }> }): Promise<NextResponse> {
  const guard = researchReadGuard();
  if (guard) return guard;
  try {
    if (!await validateRerunBody(request)) return NextResponse.json({ error: "Saved reruns accept no input overrides." }, { status: 400 });
    const { id } = await context.params;
    return NextResponse.json(rerunBacktestSweep(id), { status: 201, headers: { "Cache-Control": "no-store" } });
  } catch (error) { return researchFailure(error); }
}
