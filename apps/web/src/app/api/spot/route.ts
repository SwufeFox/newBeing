import { NextResponse } from "next/server";
import { z } from "zod";
import { SPOT_EXECUTION_POLICY } from "@newbeing/core";
import { assertSharedSpotAvailable, cancelSharedSpotIntent, executeSharedSpotOrder, openSharedSpotAccount, readSharedSpotAccount, SpotReplayBlockedError } from "@newbeing/application";
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
function replayBlockedResponse(error: unknown, message: string): NextResponse {
  if (!(error instanceof SpotReplayBlockedError)) throw error;
  return NextResponse.json({ error: message }, { status: 409 });
}

function spotReplayGuard(message: string): NextResponse | null {
  try {
    assertSharedSpotAvailable();
    return null;
  } catch (error) {
    return replayBlockedResponse(error, message);
  }
}

export async function GET(request: Request) {
  const message = "Shared Paper accounts are hidden during Replay.";
  const guard = spotReplayGuard(message);
  if (guard) return guard;
  const params = new URL(request.url).searchParams;
  const parsed = z.object({ exchange, quote }).safeParse({ exchange: params.get("exchange"), quote: params.get("quote") });
  if (!parsed.success) return NextResponse.json({ error: "Invalid shared spot account." }, { status: 400 });
  try {
    return NextResponse.json({ account: readSharedSpotAccount(parsed.data.exchange, parsed.data.quote) ?? null, policy: SPOT_EXECUTION_POLICY, legacyAssets: "preserved-separately" }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return replayBlockedResponse(error, message);
  }
}
export async function POST(request: Request) {
  const replayMessage = "Normal Paper commands are disabled during Replay.";
  const guard = spotReplayGuard(replayMessage);
  if (guard) return guard;
  let input: z.infer<typeof schema> | undefined;
  try {
    input = schema.parse(await request.json());
    const parsedGuard = spotReplayGuard(replayMessage);
    if (parsedGuard) return parsedGuard;
    if (input.action === "open") return NextResponse.json({ account: openSharedSpotAccount(input.exchange, input.quote), legacyAssets: "preserved-separately" });
    if (input.action === "cancel") return NextResponse.json(cancelSharedSpotIntent(input.exchange, input.quote, input.clientOrderId));
    const result = await executeSharedSpotOrder(input, getWebMarketAdapter(input.exchange));
    if (result.order.status === "rejected" && result.order.rejectionReason) return NextResponse.json({ ...result, error: result.order.rejectionReason }, { status: 422 });
    return NextResponse.json(result, { status: result.order.status === "filled" ? 200 : ["submitted", "unknown"].includes(result.order.status) ? 202 : 422 });
  } catch (error) {
    if (error instanceof SpotReplayBlockedError) return NextResponse.json({ error: error.message }, { status: 409 });
    // A validation/metadata failure can occur before an intent exists. Report the
    // persisted outcome so the ticket can distinguish that from an unknown fill.
    let outcome: Record<string, unknown> = {};
    if (input?.action === "order") {
      try {
        const account = readSharedSpotAccount(input.exchange, input.symbol.split("/")[1]!);
        const clientOrderId = input.clientOrderId;
        const order = account?.orders.find((item) => item.clientOrderId === clientOrderId);
        outcome = { account: account ?? null, order: order ?? null, intentRecorded: Boolean(order) };
      } catch {
        // Storage could not be read: the outcome remains unconfirmed.
      }
    }
    return NextResponse.json({ ...outcome, error: error instanceof Error ? error.message : "Shared spot command failed." }, { status: 422 });
  }
}
