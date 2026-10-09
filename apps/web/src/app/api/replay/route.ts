import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import { logEvent, type ReplaySession, type Timeframe } from "@newbeing/core";
import { completedBarsThrough, findCandleGaps, getBinanceAdapter, timeframeMilliseconds } from "@newbeing/market-data";
import { createReplaySession, getPaperPortfolio, getWorkspaceState, replayAccountId, saveWorkspaceState } from "@newbeing/storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const requestSchema = z.object({
  symbol: z.string().regex(/^[A-Z0-9]{2,20}\/USDT$/),
  timeframe: z.enum(["1m", "5m", "15m", "30m", "1h", "4h", "1d"]),
  endAt: z.number().int().positive(),
  limit: z.number().int().min(50).max(500).default(200),
});

export async function POST(request: Request): Promise<NextResponse> {
  try {
    const body: unknown = await request.json();
    const parsed = requestSchema.safeParse(body);
    if (!parsed.success) return NextResponse.json({ error: "Invalid replay start request." }, { status: 400 });
    if (parsed.data.endAt > Date.now()) return NextResponse.json({ error: "Replay cannot begin in the future." }, { status: 400 });
    const timeframe = parsed.data.timeframe as Timeframe;
    const interval = timeframeMilliseconds(timeframe);
    const since = Math.max(0, parsed.data.endAt - interval * (parsed.data.limit + 4));
    const fetched = await getBinanceAdapter().fetchOHLCVSince(parsed.data.symbol, timeframe, since, parsed.data.limit + 4);
    const candles = completedBarsThrough(fetched, timeframe, parsed.data.endAt).slice(-parsed.data.limit);
    if (candles.length < 2) return NextResponse.json({ error: "Not enough completed historical bars at this time." }, { status: 422 });
    const gaps = findCandleGaps(candles, timeframe);
    if (gaps.length > 0) return NextResponse.json({ error: `Replay seed contains ${gaps.length} missing interval(s); choose a continuous dataset.` }, { status: 422 });
    const last = candles.at(-1);
    if (!last) return NextResponse.json({ error: "Replay seed is empty." }, { status: 422 });
    const now = new Date().toISOString();
    const session: ReplaySession = {
      id: randomUUID(),
      symbol: parsed.data.symbol,
      timeframe,
      startAt: parsed.data.endAt,
      cursor: last.timestamp,
      bars: candles,
      status: "active",
      createdAt: now,
      updatedAt: now,
    };
    createReplaySession(session);
    const portfolio = getPaperPortfolio(replayAccountId(session.id, session.symbol));
    const current = getWorkspaceState().state;
    saveWorkspaceState({ ...current, activeWorkspace: "replay", activeReplayId: session.id });
    return NextResponse.json({ session, portfolio, source: "Binance Spot historical bars", futureBarsLoaded: 0 }, { status: 201, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Replay could not be initialized.";
    logEvent("warn", "replay.start_failed", { message });
    return NextResponse.json({ error: message }, { status: 422 });
  }
}
