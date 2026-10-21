import { NextResponse } from "next/server";
import { z } from "zod";
import { getWorkspaceState, listOrderPreviews, paperAccountId } from "@newbeing/storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<NextResponse> {
  const workspace = getWorkspaceState().state;
  // Only the requested venue/account is visible in the normal ticket.
  if (workspace.activeWorkspace === "replay") {
    return NextResponse.json({ error: "Normal order previews are hidden during Replay." }, { status: 409 });
  }
  const url = new URL(request.url);
  const symbol = url.searchParams.get("symbol") ?? workspace.symbol;
  const exchange = z.enum(["binance", "coinbaseexchange", "okx", "kraken"]).safeParse(url.searchParams.get("exchange") ?? workspace.exchange);
  if (!exchange.success) return NextResponse.json({ error: "Unknown exchange." }, { status: 400 });
  if (symbol && !/^[A-Z0-9]{2,20}\/[A-Z0-9]{2,20}$/.test(symbol)) return NextResponse.json({ error: "Invalid symbol." }, { status: 400 });
  return NextResponse.json({ items: listOrderPreviews(symbol, 20, paperAccountId(symbol, exchange.data)) }, { headers: { "Cache-Control": "no-store" } });
}
