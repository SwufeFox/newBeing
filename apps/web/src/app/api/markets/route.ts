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
    /* Prefer the venue's dominant quote (USD on Coinbase and Kraken, USDT
       elsewhere) but keep the others: filtering to a single quote is what made
       non-USDT venues look empty. */
    const preferredQuote = id === "coinbaseexchange" || id === "kraken" ? "USD" : "USDT";
    const preferred = markets.filter((market) => market.quote === preferredQuote);
    const usdt = preferred.length > 0 ? preferred : markets;

    /* The exchange returns its own order, which puts BNSOL and RESOLV ahead of
       a literal SOL query. Rank by match quality so the obvious answer is first:
         exact base > base starts with the query > base contains it > symbol contains it. */
    const q = query.trim().toUpperCase();
    const rank = (base: string): number => {
      if (!q) return 3;
      if (base === q) return 0;
      if (base.startsWith(q)) return 1;
      if (base.includes(q)) return 2;
      return 3;
    };
    const items = [...usdt].sort((a, b) => {
      const d = rank(a.base) - rank(b.base);
      if (d !== 0) return d;
      // shorter bases win ties: "SOL" over "SOLV"
      return a.base.length - b.base.length || a.base.localeCompare(b.base);
    });

    return NextResponse.json({ items, source: marketDataSourceLabel(id) }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Market search failed.";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
