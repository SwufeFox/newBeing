import { NextResponse } from "next/server";
import { z } from "zod";
import { executePaperOrder } from "@newbeing/application";
import {
  getPaperPortfolio,
  listPaperOrders,
  paperAccountId,
  getWorkspaceState,
} from "@newbeing/storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const orderSchema = z.object({
  clientOrderId: z.string().min(8).max(100),
  symbol: z.string().regex(/^[A-Z0-9]{2,20}\/[A-Z0-9]{2,20}$/),
  side: z.enum(["buy", "sell"]),
  quantity: z.number().positive().max(1_000_000),
  mode: z.literal("paper"),
});

export async function GET(request: Request): Promise<NextResponse> {
  try {
    if (getWorkspaceState().state.activeWorkspace === "replay") {
      return NextResponse.json({ error: "The normal Paper wallet is hidden during Replay; use the session-isolated replay account." }, { status: 409 });
    }
    const symbol = new URL(request.url).searchParams.get("symbol") ?? "BTC/USDT";
    const accountId = paperAccountId(symbol);
    return NextResponse.json({ portfolio: getPaperPortfolio(accountId), orders: listPaperOrders(30), mode: "paper" }, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Paper account read failed.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(request: Request): Promise<NextResponse> {
  try {
    if (getWorkspaceState().state.activeWorkspace === "replay") {
      return NextResponse.json({ error: "Normal Paper orders are disabled during Replay; use the replay ticket at the revealed bar close." }, { status: 409 });
    }
    const body: unknown = await request.json();
    const parsed = orderSchema.safeParse(body);
    if (!parsed.success) return NextResponse.json({ error: "Invalid paper order." }, { status: 400 });
    const result = await executePaperOrder(parsed.data);
    const status = result.deduplicated ? 200 : result.order.status === "filled" ? 201 : result.order.status === "unknown" ? 202 : 422;
    return NextResponse.json({ ...result, reference: "public bid/ask, falling back to last; simulation only" }, { status });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Paper order failed.";
    return NextResponse.json({ error: message }, { status: 422 });
  }
}
