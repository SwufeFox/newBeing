import { NextResponse } from "next/server";
import { getBinanceAdapter } from "@newbeing/market-data";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<NextResponse> {
  try {
    const url = new URL(request.url);
    const query = url.searchParams.get("q") ?? "";
    const items = await getBinanceAdapter().searchSymbols(query, 60);
    return NextResponse.json({ items, source: "Binance Spot via CCXT" }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Market search failed.";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
