import { NextResponse } from "next/server";
import { getStoredStrategy } from "@newbeing/storage";

export const runtime = "nodejs";
const STORED_ID = /^custom-[a-z0-9-]{2,80}$/;

/** Full saved draft, including its research-only source text. */
export async function GET(_request: Request, context: { params: Promise<{ id: string }> }): Promise<NextResponse> {
  const { id } = await context.params;
  if (!STORED_ID.test(id)) return NextResponse.json({ error: "Strategy draft not found." }, { status: 404, headers: { "Cache-Control": "no-store" } });
  const strategy = getStoredStrategy(id);
  return strategy
    ? NextResponse.json({ strategy, executable: false }, { headers: { "Cache-Control": "no-store" } })
    : NextResponse.json({ error: "Strategy draft not found." }, { status: 404, headers: { "Cache-Control": "no-store" } });
}
