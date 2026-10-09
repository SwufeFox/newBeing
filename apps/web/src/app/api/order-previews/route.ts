import { NextResponse } from "next/server";
import { z } from "zod";
import { getWorkspaceState, listOrderPreviews } from "@newbeing/storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<NextResponse> {
  if (getWorkspaceState().state.activeWorkspace === "replay") {
    return NextResponse.json({ error: "Normal order previews are hidden during Replay." }, { status: 409 });
  }
  const url = new URL(request.url);
  const symbol = url.searchParams.get("symbol") ?? undefined;
  if (symbol && !/^[A-Z0-9]{2,20}\/[A-Z0-9]{2,20}$/.test(symbol)) return NextResponse.json({ error: "Invalid symbol." }, { status: 400 });
  return NextResponse.json({ items: listOrderPreviews(symbol, 20) }, { headers: { "Cache-Control": "no-store" } });
}
