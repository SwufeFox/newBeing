import { z } from "zod";
import { listDerivativeInstruments } from "@newbeing/market-data/derivatives";
import { derivativeFailure, derivativeJson, derivativeKindSchema, derivativeReplayRejection } from "@/lib/derivatives-http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const schema = z.object({
  kind: derivativeKindSchema,
  query: z.string().max(80).default(""),
});

export async function GET(request: Request) {
  const blocked = derivativeReplayRejection();
  if (blocked) return blocked;
  try {
    const params = new URL(request.url).searchParams;
    const input = schema.parse({ kind: params.get("kind") ?? "perpetual", query: params.get("query") ?? "" });
    const instruments = await listDerivativeInstruments(input.kind, input.query);
    const lateBlock = derivativeReplayRejection();
    if (lateBlock) return lateBlock;
    return derivativeJson({ instruments, source: instruments.some((instrument) => instrument.source === "fixture") ? "fixture" : "public" });
  } catch (error) {
    return derivativeReplayRejection() ?? derivativeFailure(error);
  }
}
