import { NextResponse } from "next/server";
import { SUPPORTED_EXCHANGES, type ExchangeId } from "@newbeing/core";
import { getExchangeAdapter } from "@newbeing/market-data";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(request: Request): Promise<NextResponse> {
  const query = new URL(request.url).searchParams;
  const venue = query.get("venue");
  const symbol = query.get("symbol");
  if (!venue && !symbol) return NextResponse.json({ connectors: SUPPORTED_EXCHANGES.map((id) => getExchangeAdapter(id).getConnectorMetadata()) });
  if (!venue || !SUPPORTED_EXCHANGES.includes(venue as ExchangeId) || !symbol) return NextResponse.json({ error: "Specify a supported venue and BASE/QUOTE symbol." }, { status: 400 });
  try {
    const adapter = getExchangeAdapter(venue as ExchangeId);
    const instrument = await adapter.getInstrument(symbol);
    return NextResponse.json({ connector: adapter.getConnectorMetadata(), instrument });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Instrument metadata unavailable." }, { status: 422 });
  }
}
