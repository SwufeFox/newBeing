import { NextResponse } from "next/server";
import { z } from "zod";
import { executeReplayOrder } from "@newbeing/application";
import { logEvent, type Timeframe } from "@newbeing/core";
import { getBinanceAdapter, nextCompletedBarAfter, timeframeMilliseconds } from "@newbeing/market-data";
import {
  advanceReplaySession,
  finishReplaySession,
  getPaperPortfolio,
  getReplaySession,
  listPaperOrders,
  replayAccountId,
} from "@newbeing/storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const actionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("step") }),
  z.object({ action: z.literal("finish") }),
  z.object({
    action: z.literal("order"),
    requestId: z.string().uuid(),
    side: z.enum(["buy", "sell"]),
    quantity: z.number().positive().max(1_000_000),
  }),
]);

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }): Promise<NextResponse> {
  try {
    const { id } = await context.params;
    const session = getReplaySession(id);
    if (!session) return NextResponse.json({ error: "Replay session not found." }, { status: 404 });
    const accountId = replayAccountId(session.id, session.symbol);
    const portfolio = getPaperPortfolio(accountId);
    const clientPrefix = `replay-${session.id}-`;
    const orders = listPaperOrders(100).filter((order) => order.clientOrderId.startsWith(clientPrefix));
    return NextResponse.json({ session, portfolio, orders, futureBarsLoaded: 0 }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Replay session read failed.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(request: Request, context: { params: Promise<{ id: string }> }): Promise<NextResponse> {
  try {
    const { id } = await context.params;
    const body: unknown = await request.json();
    const action = actionSchema.safeParse(body);
    if (!action.success) return NextResponse.json({ error: "Invalid replay action." }, { status: 400 });
    let session = getReplaySession(id);
    if (!session) return NextResponse.json({ error: "Replay session not found." }, { status: 404 });

    if (action.data.action === "finish") {
      session = finishReplaySession(id) ?? session;
      return NextResponse.json({ session, finished: true });
    }

    if (session.status !== "active") return NextResponse.json({ error: "Replay session has finished." }, { status: 409 });

    if (action.data.action === "step") {
      const interval = timeframeMilliseconds(session.timeframe as Timeframe);
      const from = session.cursor + interval;
      const fetched = await getBinanceAdapter().fetchOHLCVSince(session.symbol, session.timeframe as Timeframe, from, 4);
      const next = nextCompletedBarAfter(fetched, session.timeframe as Timeframe, session.cursor);
      if (!next) return NextResponse.json({ session, bar: null, hasNext: false, futureBarsLoaded: 0 });
      if (next.timestamp > session.cursor + interval) {
        return NextResponse.json({ error: "A missing OHLCV interval blocks safe replay; the cursor was not advanced." }, { status: 409 });
      }
      const advanced = advanceReplaySession(id, session.cursor, next);
      session = advanced.session;
      return NextResponse.json({ session, bar: session.bars.at(-1) ?? null, hasNext: true, deduplicated: advanced.deduplicated, futureBarsLoaded: 0 });
    }

    const currentBar = session.bars.at(-1);
    if (!currentBar) return NextResponse.json({ error: "Replay cursor has no current bar." }, { status: 409 });
    const clientOrderId = `replay-${session.id}-${action.data.requestId}`;
    const result = executeReplayOrder({
      sessionId: session.id,
      clientOrderId,
      symbol: session.symbol,
      side: action.data.side,
      quantity: action.data.quantity,
      price: currentBar.close,
    });
    return NextResponse.json({ ...result, cursor: session.cursor, execution: "current replay bar close; fee applied; no live market request" }, {
      status: result.order.status === "filled" ? 201 : result.order.status === "rejected" ? 422 : 200,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Replay action failed.";
    logEvent("warn", "replay.action_failed", { message });
    return NextResponse.json({ error: message }, { status: 422 });
  }
}
