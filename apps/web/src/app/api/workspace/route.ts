import { NextResponse } from "next/server";
import { z } from "zod";
import { DEFAULT_WORKSPACE_STATE, EXCHANGE_TIMEFRAMES, type WorkspaceState } from "@newbeing/core";
import { getWorkspaceState, saveWorkspaceState } from "@newbeing/storage";
import { symbolForExchange } from "@/lib/exchanges";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/* "backtest" is still ACCEPTED from clients even though the workspace no longer
   exists: a browser holding a persisted snapshot, or an older MCP caller, would
   otherwise get a 400 on every write and the sync loop would retry forever.
   It is normalised to "research" below, which is where that workspace went. */
const stateSchema = z.object({
  symbol: z.string().regex(/^[A-Z0-9]{2,20}\/[A-Z0-9]{2,20}$/),
  timeframe: z.enum(["1m", "5m", "15m", "30m", "1h", "4h", "1d"]),
  exchange: z.enum(["binance", "coinbaseexchange", "okx", "kraken"]),
  mode: z.literal("paper"),
  activeWorkspace: z.enum(["terminal", "research", "backtest", "replay"]),
  selectedStrategyId: z.string().min(1).max(120),
  activeBacktestId: z.string().max(120).nullable(),
  activeReplayId: z.string().max(120).nullable(),
  visibleRange: z.object({ from: z.number().nullable(), to: z.number().nullable() }),
  layout: z.object({
    watchlistWidth: z.number().min(160).max(360),
    inspectorWidth: z.number().min(240).max(480),
    bottomHeight: z.number().min(150).max(480),
  }),
});

export async function GET(): Promise<NextResponse> {
  try {
    return NextResponse.json(getWorkspaceState(), { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ state: DEFAULT_WORKSPACE_STATE, updatedAt: 0 });
  }
}

export async function PUT(request: Request): Promise<NextResponse> {
  try {
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: "Invalid JSON in request body." }, { status: 400 });
    }
    const parsed = stateSchema.safeParse(body);
    if (!parsed.success) return NextResponse.json({ error: "Invalid workspace state." }, { status: 400 });
    const state: WorkspaceState = {
      ...parsed.data,
      /* Absorb the retired "backtest" workspace. Done here rather than rejected
         so an old snapshot heals on its first write instead of wedging the
         client's sync loop. */
      activeWorkspace: parsed.data.activeWorkspace === "backtest" ? "research" : parsed.data.activeWorkspace,
    };
    /* Re-denominate on the server too. The client sends its own symbol, and a
       stale or hand-written client could otherwise persist a pair the venue
       does not list (BTC/USDT on Kraken), leaving the whole UI quoting a market
       that cannot be fetched. */
    state.symbol = symbolForExchange(state.symbol, state.exchange);
    if (!EXCHANGE_TIMEFRAMES[state.exchange].includes(state.timeframe)) {
      return NextResponse.json({ error: `${state.exchange} does not support ${state.timeframe} candles.` }, { status: 400 });
    }
    /* No venue/workspace gate: every supported venue can serve backtests and
       replays. The only per-venue rule left is that the venue must actually
       publish the requested timeframe (checked above). */
    const updatedAt = saveWorkspaceState(state);
    return NextResponse.json({ state, updatedAt }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Workspace persistence failed.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
