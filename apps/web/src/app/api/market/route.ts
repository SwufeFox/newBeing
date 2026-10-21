import { NextResponse } from "next/server";
import { z } from "zod";
import { timeframeMilliseconds, findCandleGaps } from "@newbeing/market-data";
import { logEvent, type ExchangeId, type Timeframe } from "@newbeing/core";
import { getReplaySession, getWorkspaceState } from "@newbeing/storage";
import { getWebMarketAdapter, marketDataSourceLabel } from "@/lib/market-adapter";

import { createCandleCacheAdapter } from "@/lib/candle-cache-adapter";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const timeframeSchema = z.enum(["1m", "5m", "15m", "30m", "1h", "4h", "1d"]);
const exchangeSchema = z.enum(["binance", "coinbaseexchange", "okx", "kraken"]);

export async function GET(request: Request): Promise<NextResponse> {
  const url = new URL(request.url);
  const kind = url.searchParams.get("kind") ?? "candles";
  const symbol = url.searchParams.get("symbol") ?? "BTC/USDT";
  try {
    const workspace = getWorkspaceState().state;
    const exchangeResult = exchangeSchema.safeParse(url.searchParams.get("exchange") ?? workspace.exchange);
    if (!exchangeResult.success) return NextResponse.json({ error: "Unsupported exchange." }, { status: 400 });
    const exchange: ExchangeId = exchangeResult.data;
    if (workspace.activeWorkspace === "replay" && kind !== "candles") {
      return NextResponse.json({ error: "Live quotes and depth are suppressed during Replay." }, { status: 409 });
    }
    const adapter = getWebMarketAdapter(exchange);
    if (kind === "summary") return NextResponse.json(await adapter.fetchSummary(symbol), { headers: { "Cache-Control": "no-store" } });
    if (kind === "tickers") {
      const symbols = (url.searchParams.get("symbols") ?? "").split(",").filter(Boolean).slice(0, 40);
      return NextResponse.json({ items: await adapter.fetchSummaries(symbols) }, { headers: { "Cache-Control": "no-store" } });
    }
    if (kind === "book") return NextResponse.json(await adapter.fetchOrderBook(symbol, 16), { headers: { "Cache-Control": "no-store" } });
    if (kind === "trades") return NextResponse.json({ items: await adapter.fetchRecentTrades(symbol, 24) }, { headers: { "Cache-Control": "no-store" } });
    if (kind !== "candles") return NextResponse.json({ error: "Unsupported market data kind." }, { status: 400 });
    const timeframeResult = timeframeSchema.safeParse(url.searchParams.get("timeframe") ?? "15m");
    if (!timeframeResult.success) return NextResponse.json({ error: "Unsupported timeframe." }, { status: 400 });
    const timeframe = timeframeResult.data as Timeframe;
    if (workspace.activeWorkspace === "replay") {
      const session = workspace.activeReplayId ? getReplaySession(workspace.activeReplayId) : undefined;
      if (!session || exchange !== session.exchange || session.symbol !== symbol || session.timeframe !== timeframe) {
        return NextResponse.json({ error: "Replay market data is limited to its session and revealed cursor." }, { status: 409 });
      }
      return NextResponse.json({ candles: session.bars, completed: session.bars, gaps: findCandleGaps(session.bars, timeframe), source: `Local ${session.exchange} replay session · revealed bars only`, futureBarsLoaded: 0 }, { headers: { "Cache-Control": "no-store" } });
    }
    const limitResult = z.coerce.number().int().min(50).max(1000).safeParse(url.searchParams.get("limit") ?? 500);
    if (!limitResult.success) return NextResponse.json({ error: "Limit must be between 50 and 1000." }, { status: 400 });
    const cachedAdapter = createCandleCacheAdapter(exchange, adapter);
    const sinceParam = url.searchParams.get("since");
    const sinceResult = sinceParam === null ? null : z.coerce.number().int().min(0).safeParse(sinceParam);
    if (sinceResult && !sinceResult.success) return NextResponse.json({ error: "Since must be a non-negative timestamp." }, { status: 400 });
    const candles = sinceResult
      ? await cachedAdapter.adapter.fetchOHLCVSince(symbol, timeframe, sinceResult.data, limitResult.data)
      : await cachedAdapter.adapter.fetchOHLCV(symbol, timeframe, limitResult.data);
    const interval = timeframeMilliseconds(timeframe);
    const completed = candles.filter((candle) => candle.timestamp + interval <= Date.now());
    const gaps = findCandleGaps(completed, timeframe);
    const provenance = cachedAdapter.getLastResult();
    const source = provenance?.source === "local-cache" ? "Local persistent candle cache fallback" : marketDataSourceLabel(exchange);
    return NextResponse.json({ candles, completed, gaps, source, cache: provenance?.cache ?? { cached: false, cachedAt: null, fallback: false } }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Market data request failed.";
    logEvent("warn", "market_data.request_failed", { kind, message });
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
