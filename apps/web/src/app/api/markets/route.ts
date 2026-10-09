import { NextResponse } from "next/server";
import { getWebMarketAdapter, marketDataSourceLabel } from "@/lib/market-adapter";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<NextResponse> {
  try {
    const url = new URL(request.url);
    const query = url.searchParams.get("q") ?? "";
    const items = await getWebMarketAdapter().searchSymbols(query, 60);
    return NextResponse.json({ items, source: marketDataSourceLabel() }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Market search failed.";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
