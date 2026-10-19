import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import { EXCHANGE_TIMEFRAMES, logEvent, type ExchangeId, type ReplaySession, type Timeframe } from "@newbeing/core";
import { completedBarsThrough, findCandleGaps, timeframeMilliseconds } from "@newbeing/market-data";
import { createReplaySession, getPaperPortfolio, getWorkspaceState, replayAccountId, saveWorkspaceState } from "@newbeing/storage";
import { getWebMarketAdapter, marketDataSourceLabel } from "@/lib/market-adapter";

import { createCandleCacheAdapter } from "@/lib/candle-cache-adapter";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const requestSchema = z.object({
  /* Any quote currency: Coinbase and Kraken list against USD, not USDT. The
     venue itself rejects pairs it does not carry, so hardcoding a quote here
     only ruled out valid markets. */
  symbol: z.string().regex(/^[A-Z0-9]{2,20}\/[A-Z0-9]{2,20}$/),
  timeframe: z.enum(["1m", "5m", "15m", "30m", "1h", "4h", "1d"]),
  endAt: z.number().int().positive(),
  limit: z.number().int().min(50).max(500).default(200),
  /* Optional: defaults to the workspace's active venue. */
  exchange: z.enum(["binance", "coinbaseexchange", "okx", "kraken"]).optional(),
});

export async function POST(request: Request): Promise<NextResponse> {
  try {
    const body: unknown = await request.json();
    const parsed = requestSchema.safeParse(body);
    if (!parsed.success) return NextResponse.json({ error: "Invalid replay start request." }, { status: 400 });
    /* The venue is resolved once and used for the seed fetch, the stored
       session, and every later step — a session must not change venue midway. */
    const exchange: ExchangeId = parsed.data.exchange ?? getWorkspaceState().state.exchange;
    if (!EXCHANGE_TIMEFRAMES[exchange].includes(parsed.data.timeframe)) {
      return NextResponse.json({ error: `${exchange} does not provide ${parsed.data.timeframe} candles.` }, { status: 422 });
    }
    if (parsed.data.endAt > Date.now()) return NextResponse.json({ error: "Replay cannot begin in the future." }, { status: 400 });
    const timeframe = parsed.data.timeframe as Timeframe;
    const interval = timeframeMilliseconds(timeframe);
    const since = Math.max(0, parsed.data.endAt - interval * (parsed.data.limit + 4));
    const cachedAdapter = createCandleCacheAdapter(exchange, getWebMarketAdapter(exchange));
    const fetched = await cachedAdapter.adapter.fetchOHLCVSinceThrough(parsed.data.symbol, timeframe, since, parsed.data.limit + 4, parsed.data.endAt);
    const candles = completedBarsThrough(fetched, timeframe, parsed.data.endAt).slice(-parsed.data.limit);
    const provenance = cachedAdapter.getLastResult();
    if (candles.length < 2) return NextResponse.json({ error: "Not enough completed historical bars at this time." }, { status: 422 });
    const gaps = findCandleGaps(candles, timeframe);
    if (gaps.length > 0) return NextResponse.json({ error: `Replay seed contains ${gaps.length} missing interval(s); choose a continuous dataset.` }, { status: 422 });
    const last = candles.at(-1);
    if (!last) return NextResponse.json({ error: "Replay seed is empty." }, { status: 422 });
    const now = new Date().toISOString();
    const session: ReplaySession = {
      id: randomUUID(), exchange, symbol: parsed.data.symbol, timeframe, startAt: parsed.data.endAt,
      cursor: last.timestamp, bars: candles, status: "active", createdAt: now, updatedAt: now,
    };
    createReplaySession(session);
    const portfolio = getPaperPortfolio(replayAccountId(session.id, session.symbol));
    const current = getWorkspaceState().state;
    saveWorkspaceState({ ...current, activeWorkspace: "replay", activeReplayId: session.id });
    return NextResponse.json({ session, portfolio, source: provenance?.source === "local-cache" ? "Local persistent candle cache fallback" : `${marketDataSourceLabel(exchange)} historical bars`, cache: provenance?.cache ?? { cached: false, cachedAt: null, fallback: false }, futureBarsLoaded: 0 }, { status: 201, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Replay could not be initialized.";
    logEvent("warn", "replay.start_failed", { message });
    return NextResponse.json({ error: message }, { status: 422 });
  }
}
