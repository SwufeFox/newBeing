import { NextResponse } from "next/server";
import { z } from "zod";
import { SPOT_EXECUTION_POLICY } from "@newbeing/core";
import { executeSharedSpotOrder } from "@newbeing/application";
import { cancelSpotIntent, getSpotAccount, getWorkspaceState, openSpotAccount } from "@newbeing/storage";
import { getWebMarketAdapter } from "@/lib/market-adapter";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const exchange = z.enum(["binance", "coinbaseexchange", "okx", "kraken"]);
const quote = z.string().regex(/^[A-Z0-9]{2,20}$/);
const schema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("open"), exchange, quote }).strict(),
  z.object({ action: z.literal("cancel"), exchange, quote, clientOrderId: z.string().min(1).max(160) }).strict(),
  z.object({ action: z.literal("order"), exchange, symbol: z.string().regex(/^[A-Z0-9]{2,20}\/[A-Z0-9]{2,20}$/), clientOrderId: z.string().min(8).max(160), side: z.enum(["buy", "sell"]), quantity: z.number().positive().max(1e6), maximumPrice: z.number().positive() }).strict(),
]);
export async function GET(request: Request) {
  if (getWorkspaceState().state.activeWorkspace === "replay") return NextResponse.json({ error: "Shared Paper accounts are hidden during Replay." }, { status: 409 });
  const params = new URL(request.url).searchParams;
  const parsed = z.object({ exchange, quote }).safeParse({ exchange: params.get("exchange"), quote: params.get("quote") });
  if (!parsed.success) return NextResponse.json({ error: "Invalid shared spot account." }, { status: 400 });
  return NextResponse.json({ account: getSpotAccount(parsed.data.exchange, parsed.data.quote) ?? null, policy: SPOT_EXECUTION_POLICY, legacyAssets: "preserved-separately" }, { headers: { "Cache-Control": "no-store" } });
}
export async function POST(request: Request) {
  if (getWorkspaceState().state.activeWorkspace === "replay") return NextResponse.json({ error: "Normal Paper commands are disabled during Replay." }, { status: 409 });
  try {
    const input = schema.parse(await request.json());
    if (getWorkspaceState().state.activeWorkspace === "replay") return NextResponse.json({ error: "Normal Paper commands are disabled during Replay." }, { status: 409 });
    if (input.action === "open") return NextResponse.json({ account: openSpotAccount(input.exchange, input.quote), legacyAssets: "preserved-separately" });
    if (input.action === "cancel") return NextResponse.json(cancelSpotIntent(input.exchange, input.quote, input.clientOrderId));
    const result = await executeSharedSpotOrder(input, getWebMarketAdapter(input.exchange));
    return NextResponse.json(result, { status: result.order.status === "filled" ? 200 : ["submitted", "unknown"].includes(result.order.status) ? 202 : 422 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Shared spot command failed." }, { status: 422 });
  }
}
