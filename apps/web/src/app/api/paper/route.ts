import { NextResponse } from "next/server";
import { z } from "zod";
import { SIMULATION_PRECISION } from "@newbeing/core";
import { executePaperOrder } from "@newbeing/application";
import { getPaperPortfolio, listPaperOrders, paperAccountId, getWorkspaceState, PaperReplayBlockedError } from "@newbeing/storage";
import { getWebMarketAdapter } from "@/lib/market-adapter";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const exchangeSchema = z.enum(["binance", "coinbaseexchange", "okx", "kraken"]);

const orderSchema = z.object({
  clientOrderId: z.string().min(8).max(100),
  symbol: z.string().regex(/^[A-Z0-9]{2,20}\/[A-Z0-9]{2,20}$/),
  side: z.enum(["buy", "sell"]),
  quantity: z.number().positive().max(1_000_000),
  mode: z.literal("paper"),
  /* Optional: defaults to the workspace's active venue. */
  exchange: exchangeSchema.optional(),
}).strict();

/* Replay isolation is the only blanket rule left; which venue fills an order
   is now a per-request choice rather than a capability the app lacks. */
function unsupported(): NextResponse | null {
  if (getWorkspaceState().state.activeWorkspace === "replay") {
    return NextResponse.json({ error: "Normal Paper orders are disabled during Replay; use the replay ticket at the revealed bar close." }, { status: 409 });
  }
  return null;
}

export async function GET(request: Request): Promise<NextResponse> {
  try {
    const blocked = unsupported();
    if (blocked) return blocked;
    const params = new URL(request.url).searchParams;
    const symbol = params.get("symbol") ?? "BTC/USDT";
    const parsedExchange = exchangeSchema.safeParse(params.get("exchange") ?? getWorkspaceState().state.exchange);
    if (!parsedExchange.success) return NextResponse.json({ error: "Unknown exchange." }, { status: 400 });
    const accountId = paperAccountId(symbol, parsedExchange.data);
    return NextResponse.json({
      portfolio: getPaperPortfolio(accountId), orders: listPaperOrders(30, accountId), mode: "paper", exchange: parsedExchange.data, accountId, simulationPrecision: SIMULATION_PRECISION,
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Paper account read failed." }, { status: 500 });
  }
}

export async function POST(request: Request): Promise<NextResponse> {
  try {
    const blocked = unsupported();
    if (blocked) return blocked;
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: "Invalid JSON in request body." }, { status: 400 });
    }
    const parsed = orderSchema.safeParse(body);
    if (!parsed.success) return NextResponse.json({ error: "Invalid paper order." }, { status: 400 });
    const exchange = parsed.data.exchange ?? getWorkspaceState().state.exchange;
    /* The adapter that prices the fill is the account's own venue. */
    const result = await executePaperOrder({ ...parsed.data, exchange }, getWebMarketAdapter(exchange));
    const status = result.deduplicated ? 200 : result.order.status === "filled" ? 201 : result.order.status === "unknown" ? 202 : 422;
    return NextResponse.json({ ...result, simulationPrecision: SIMULATION_PRECISION, reference: "public bid/ask, falling back to last; simulation only" }, { status });
  } catch (error) {
    if (error instanceof PaperReplayBlockedError) return NextResponse.json({ error: "Normal Paper orders are disabled during Replay; use the replay ticket at the revealed bar close." }, { status: 409 });
    return NextResponse.json({ error: error instanceof Error ? error.message : "Paper order failed." }, { status: 422 });
  }
}
