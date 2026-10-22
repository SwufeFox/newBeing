import { NextResponse } from "next/server";
import { z } from "zod";
import { logEvent, replayReport, type ReplaySession } from "@newbeing/core";
import { nextCompletedBarAfter, timeframeMilliseconds } from "@newbeing/market-data";
import { nextFrozenReplayBar, advanceReplaySession, commandReplay, getReplayExecution, getPaperPortfolio, getReplaySession, listPaperOrders, replayAccountId } from "@newbeing/storage";
import { getWebMarketAdapter } from "@/lib/market-adapter";
import { createCandleCacheAdapter } from "@/lib/candle-cache-adapter";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const revision = z.number().int().nonnegative();
const actionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("step"), expectedCursor: z.number().int().nonnegative(), expectedRevision: revision }),
  z.object({ action: z.literal("finish"), expectedRevision: revision }),
  z.object({ action: z.literal("cancel"), clientOrderId: z.string().min(1).max(160), expectedRevision: revision }),
  z.object({ action: z.literal("journal"), notes: z.string().max(20_000), tags: z.array(z.string().trim().min(1).max(80)).max(20), expectedRevision: revision }),
  z.object({ action: z.literal("order"), requestId: z.string().uuid(), side: z.enum(["buy", "sell"]), quantity: z.number().positive().max(1_000_000), type: z.enum(["market", "limit", "stop"]).default("market"), price: z.number().positive().optional(), stopLoss: z.number().positive().optional(), takeProfit: z.number().positive().optional(), expectedRevision: revision }),
]);
function snapshot(session: ReplaySession) {
  const execution = getReplayExecution(session.id);
  const legacyOrders = listPaperOrders(100, replayAccountId(session.id, session.symbol, session.exchange));
  return { session, execution: execution ?? null, portfolio: execution?.portfolio ?? getPaperPortfolio(replayAccountId(session.id, session.symbol, session.exchange)), orders: execution?.orders ?? legacyOrders, legacyOrders,
    report: execution ? replayReport(execution, session.bars.at(-1)?.close ?? 0) : null, futureBarsLoaded: 0 };
}
export async function GET(_request: Request, context: { params: Promise<{ id: string }> }): Promise<NextResponse> {
  try {
    const { id } = await context.params;
    const session = getReplaySession(id);
    if (!session) return NextResponse.json({ error: "Replay session not found." }, { status: 404 });
    return NextResponse.json(snapshot(session), { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Replay read failed." }, { status: 500 });
  }
}
export async function POST(request: Request, context: { params: Promise<{ id: string }> }): Promise<NextResponse> {
  try {
    const { id } = await context.params;
    const parsed = actionSchema.safeParse(await request.json());
    if (!parsed.success) return NextResponse.json({ error: "Invalid replay action." }, { status: 400 });
    const action = parsed.data;
    const session = getReplaySession(id);
    if (!session) return NextResponse.json({ error: "Replay session not found." }, { status: 404 });
    const execution = getReplayExecution(id);
    if (!execution || execution.policyVersion !== 2) {
      throw new Error("Legacy Replay is read-only. Start a new configured session to use pending execution; existing wallet and history are preserved.");
    }
    if (action.action === "step") {
      if (session.status !== "active") throw new Error("Replay session has finished.");
      const expectedCursor = action.expectedCursor ?? session.cursor;
      if (expectedCursor !== session.cursor) return NextResponse.json({ ...snapshot(session), deduplicated: true });
      const expectedRevision = action.expectedRevision ?? execution.revision;
      const interval = timeframeMilliseconds(session.timeframe);
      const cached = execution.datasetId ? undefined : createCandleCacheAdapter(session.exchange, getWebMarketAdapter(session.exchange));
      const fetched = cached ? await cached.adapter.fetchOHLCVSince(session.symbol, session.timeframe, session.cursor + interval, 4) : [];
      const next = execution.datasetId ? nextFrozenReplayBar(id) : nextCompletedBarAfter(fetched, session.timeframe, session.cursor);
      const provenance = cached?.getLastResult();
      if (!next) return NextResponse.json({ ...snapshot(getReplaySession(id)!), bar: null, hasNext: false });
      if (next.timestamp !== session.cursor + interval) throw new Error("A missing OHLCV interval blocks safe replay; cursor was not advanced.");
      const advanced = advanceReplaySession(id, expectedCursor, next, provenance ? { source: provenance.source, cache: { fallback: provenance.cache.fallback, cachedAt: provenance.cache.cachedAt } } : undefined, expectedRevision);
      return NextResponse.json({ ...snapshot(advanced.session), bar: advanced.session.bars.at(-1), hasNext: true, deduplicated: advanced.deduplicated });
    }
    const expectedRevision = action.expectedRevision ?? execution.revision;
    if (action.action === "order") {
      const { requestId, side, quantity, type, price, stopLoss, takeProfit } = action;
      commandReplay(id, expectedRevision, { action: "order", order: { clientOrderId: `replay-${id}-${requestId}`, side, quantity, type, ...(price !== undefined ? { price } : {}), ...(stopLoss !== undefined ? { stopLoss } : {}), ...(takeProfit !== undefined ? { takeProfit } : {}) } });
    } else if (action.action === "cancel") commandReplay(id, expectedRevision, { action: "cancel", clientOrderId: action.clientOrderId });
    else if (action.action === "journal") commandReplay(id, expectedRevision, { action: "journal", notes: action.notes, tags: action.tags });
    else commandReplay(id, expectedRevision, { action: "finish" });
    return NextResponse.json(snapshot(getReplaySession(id)!), { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Replay action failed.";
    logEvent("warn", "replay.action_failed", { message });
    return NextResponse.json({ error: message }, { status: message.includes("conflict") ? 409 : 422 });
  }
}
