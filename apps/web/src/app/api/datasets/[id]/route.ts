import { NextResponse } from "next/server";
import { loadDatasetSnapshot } from "@newbeing/storage";
import { researchReadGuard } from "@/lib/research-route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DATASET_ID = /^sha256:[a-f0-9]{64}$/;

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }): Promise<NextResponse> {
  const guard = researchReadGuard();
  if (guard) return guard;

  const { id } = await context.params;
  if (!DATASET_ID.test(id)) return NextResponse.json({ error: "Invalid dataset id." }, { status: 400 });

  try {
    const snapshot = loadDatasetSnapshot(id);
    return NextResponse.json({
      datasetId: id,
      exchange: snapshot.exchange,
      symbol: snapshot.symbol,
      timeframe: snapshot.timeframe,
      bars: snapshot.candles.length,
    }, { headers: { "Cache-Control": "private, max-age=3600, immutable" } });
  } catch (error) {
    const missing = typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
    const message = missing ? "Dataset snapshot not found." : error instanceof Error ? error.message : "Dataset snapshot could not be read.";
    return NextResponse.json({ error: message }, { status: missing ? 404 : 422, headers: { "Cache-Control": "no-store" } });
  }
}
