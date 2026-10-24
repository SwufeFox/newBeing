import { z } from "zod";
import { getDerivativeCandles, getDerivativeInstrument, getDerivativeQuote } from "@newbeing/market-data/derivatives";
import { derivativeFailure, derivativeIdSchema, derivativeJson, derivativeReplayRejection, derivativeTimeframeSchema } from "@/lib/derivatives-http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const schema = z.object({
  instrumentId: derivativeIdSchema,
  timeframe: derivativeTimeframeSchema.default("1h"),
  limit: z.coerce.number().int().min(1).max(500).default(150),
});
export async function GET(request: Request) {
  const blocked = derivativeReplayRejection();
  if (blocked) return blocked;
  try {
    const input = schema.parse(Object.fromEntries(new URL(request.url).searchParams));
    const instrument = await getDerivativeInstrument(input.instrumentId);
    const afterMetadata = derivativeReplayRejection();
    if (afterMetadata) return afterMetadata;
    const [quote, history] = await Promise.all([
      getDerivativeQuote(instrument.id),
      getDerivativeCandles(instrument.id, input.timeframe, input.limit)
        .then((candles) => ({ candles, candleError: null as string | null }))
        .catch((error: unknown) => ({ candles: [], candleError: error instanceof Error ? error.message : "Candle history unavailable." })),
    ]);
    const lateBlock = derivativeReplayRejection();
    if (lateBlock) return lateBlock;
    return derivativeJson({ instrument, quote, ...history });
  } catch (error) {
    return derivativeReplayRejection() ?? derivativeFailure(error);
  }
}
