import { z } from "zod";
import { executeDerivativesOrder, getDerivativesAccount, openDerivativesAccount } from "@newbeing/application/derivatives";
import { DERIVATIVES_POLICY } from "@newbeing/application/derivatives-types";
import { getDerivativeInstrument, getDerivativeQuote } from "@newbeing/market-data/derivatives";
import type { DerivativeInstrument } from "@newbeing/market-data/derivatives";
import { derivativeFailure, derivativeIdSchema, derivativeJson, derivativeReplayRejection } from "@/lib/derivatives-http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Preserve decimal intent when JSON numbers use exponential notation. */
function plainDecimal(value: number | string): string {
  if (typeof value === "string") return value;
  const text = String(value);
  if (!text.includes("e")) return text;
  const [mantissa = "", exponent = "0"] = text.split("e");
  const [whole = "", fraction = ""] = mantissa.split(".");
  const digits = whole + fraction;
  const point = whole.length + Number(exponent);
  return point <= 0 ? `0.${"0".repeat(-point)}${digits}`
    : point >= digits.length ? digits + "0".repeat(point - digits.length)
      : `${digits.slice(0, point)}.${digits.slice(point)}`;
}
const decimal = z.union([z.number().finite().positive().max(1e12), z.string().max(80).regex(/^\d+(?:\.\d+)?$/)]).transform(plainDecimal);
const schema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("open"), instrumentId: derivativeIdSchema }).strict(),
  z.object({
    action: z.literal("order"), instrumentId: derivativeIdSchema,
    clientOrderId: z.string().min(8).max(128), side: z.enum(["buy", "sell"]),
    contracts: decimal, leverage: z.number().int().min(1).max(20).default(1),
    reduceOnly: z.boolean().default(false), limitPrice: decimal,
  }).strict(),
]);

export async function GET(request: Request) {
  try {
    const id = derivativeIdSchema.parse(new URL(request.url).searchParams.get("instrumentId"));
    // The account namespace is venue:settle, and every supported product's
    // settle currency is a fixed venue constant (OKX USDT; Deribit USDC or the
    // coin base for BTC/ETH options). Parse it locally instead of fetching
    // native metadata first — the UI can load the account in parallel.
    const match = /^(okx|deribit):(perpetual|future|option):([A-Za-z0-9_-]+)$/.exec(id);
    if (!match) throw new Error("Invalid derivative identity.");
    const [, venue = "", kind = "", nativeId = ""] = match;
    const settle = venue === "okx" ? "USDT" : kind === "option" && nativeId.startsWith("BTC-") ? "BTC" : kind === "option" && nativeId.startsWith("ETH-") ? "ETH" : "USDC";
    const account = getDerivativesAccount(venue as "okx" | "deribit", settle);
    return derivativeJson({ account: account ?? null, policy: DERIVATIVES_POLICY });
  } catch (error) {
    return derivativeFailure(error);
  }
}

export async function POST(request: Request) {
  const blocked = derivativeReplayRejection();
  if (blocked) return blocked;
  let instrument: DerivativeInstrument | undefined;
  let input: z.infer<typeof schema> | undefined;
  try {
    input = schema.parse(await request.json());
    instrument = await getDerivativeInstrument(input.instrumentId);
    const lateBlock = derivativeReplayRejection();
    if (lateBlock) return lateBlock;
    if (input.action === "open") {
      const initialBalance = instrument.settle === "BTC" ? "1" : instrument.settle === "ETH" ? "10" : "10000";
      return derivativeJson({ account: openDerivativesAccount(instrument.venue, instrument.settle, initialBalance), policy: DERIVATIVES_POLICY });
    }
    // Buy/sell alone must not imply a naked option short or close a hedge by accident.
    const close = input.reduceOnly || (instrument.kind === "option" && input.side === "sell");
    const side = close ? (input.side === "sell" ? "long" : "short") : (input.side === "buy" ? "long" : "short");
    const result = await executeDerivativesOrder({
      instrumentId: instrument.id, venue: instrument.venue, settle: instrument.settle,
      clientOrderId: input.clientOrderId, action: close ? "close" : "open", side,
      quantity: input.contracts, leverage: input.leverage,
      reduceOnly: close, maximumPrice: input.limitPrice,
    }, { getDerivativeInstrument, getDerivativeQuote });
    return derivativeJson({ ...result, policy: DERIVATIVES_POLICY });
  } catch (error) {
    const lateBlock = derivativeReplayRejection();
    if (lateBlock) return lateBlock;
    let outcome: Record<string, unknown> = {};
    if (instrument && input?.action === "order") {
      try {
        const account = getDerivativesAccount(instrument.venue, instrument.settle);
        const clientOrderId = input.clientOrderId;
        const order = account?.orders.find((entry) => entry.clientOrderId === clientOrderId);
        outcome = { account: account ?? null, order: order ?? null, intentRecorded: Boolean(order) };
      } catch { /* Do not claim a known outcome if storage cannot be read. */ }
    }
    const failure = derivativeFailure(error, 422);
    return derivativeJson({ ...await failure.json(), ...outcome }, failure.status);
  }
}
