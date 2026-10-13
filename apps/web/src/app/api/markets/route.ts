import { NextResponse } from "next/server";
import { z } from "zod";
import { getWorkspaceState } from "@newbeing/storage";
import type { ExchangeId } from "@newbeing/core";
import { getWebMarketAdapter, marketDataSourceLabel } from "@/lib/market-adapter";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<NextResponse> {
  try {
    const url = new URL(request.url);
    const query = url.searchParams.get("q") ?? "";
    const exchange = z.enum(["binance", "coinbaseexchange", "okx", "kraken"]).safeParse(url.searchParams.get("exchange") ?? getWorkspaceState().state.exchange);
    if (!exchange.success) return NextResponse.json({ error: "Unsupported exchange." }, { status: 400 });
    const id = exchange.data as ExchangeId;
    const markets = await getWebMarketAdapter(id).searchSymbols(query, 60);
    const items = markets.filter((market) => market.quote === "USDT");
    return NextResponse.json({ items, source: marketDataSourceLabel(id) }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Market search failed.";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
