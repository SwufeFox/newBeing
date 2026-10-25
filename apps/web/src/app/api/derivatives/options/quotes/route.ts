import { z } from "zod";
import { getDerivativeOptionQuotes } from "@newbeing/market-data/derivatives";
import { derivativeFailure, derivativeIdSchema, derivativeJson, derivativeReplayRejection } from "@/lib/derivatives-http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const optionIdSchema = derivativeIdSchema.refine((id) => /^deribit:option:(?:[A-Z0-9]+_USDC-[A-Z0-9][A-Z0-9.-]{1,99}|(?:BTC|ETH)-[A-Z0-9][A-Z0-9.-]{1,99})$/.test(id));
const schema = z.object({ instrumentIds: z.array(optionIdSchema).min(1).max(100) });

export async function POST(request: Request) {
  const blocked = derivativeReplayRejection();
  if (blocked) return blocked;
  try {
    const input = schema.parse(await request.json());
    const quotes = await getDerivativeOptionQuotes(input.instrumentIds);
    const lateBlock = derivativeReplayRejection();
    if (lateBlock) return lateBlock;
    return derivativeJson({ quotes, asOf: Date.now() });
  } catch (error) {
    return derivativeReplayRejection() ?? derivativeFailure(error);
  }
}
