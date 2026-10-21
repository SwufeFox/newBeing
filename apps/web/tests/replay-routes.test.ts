import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { DEFAULT_WORKSPACE_STATE, type Candle, type ReplayExecution, type ReplaySession } from "@newbeing/core";
import { closeDatabaseForTests, commandReplay, createConfiguredReplaySession, createReplaySession, getReplayExecution, getReplaySession, saveWorkspaceState } from "@newbeing/storage";

const fixture = vi.hoisted(() => ({ bars: [] as Candle[], fetch: vi.fn() }));
vi.mock("@newbeing/market-data", async () => import("@newbeing/market-data/utils"));
vi.mock("@/lib/market-adapter", () => ({
  getWebMarketAdapter: (exchange: string) => ({ id: exchange, fetchOHLCVSince: fixture.fetch, searchSymbols: vi.fn(), fetchOHLCV: vi.fn(), fetchSummary: vi.fn(), fetchSummaries: vi.fn(), fetchOrderBook: vi.fn(), fetchRecentTrades: vi.fn(), close: vi.fn() }),
  marketDataSourceLabel: () => "Named deterministic route fixture",
}));
import { GET as market } from "../src/app/api/market/route.js";
import { POST as replay } from "../src/app/api/replay/[id]/route.js";

let directory: string;
const bar = (timestamp: number): Candle => ({ timestamp, open: 100, high: 110, low: 90, close: 100, volume: 1 });
const session = (): ReplaySession => ({ id: "route-session-1234", exchange: "kraken", symbol: "BTC/USD", timeframe: "1m", startAt: 120_000, cursor: 60_000, bars: [bar(60_000)], status: "active", createdAt: "2026-01-01T00:00:00Z", updatedAt: "2026-01-01T00:00:00Z" });
function configure() {
  const s = session();
  createConfiguredReplaySession(s, { id: "kraken:spot:XXBTZUSD", venue: "kraken", nativeId: "XXBTZUSD", symbol: s.symbol, base: "BTC", quote: "USD", marketType: "spot" }, { initialCapital: 1000, feeRate: 0.001, slippageRate: 0 });
  saveWorkspaceState({ ...DEFAULT_WORKSPACE_STATE, activeWorkspace: "replay", activeReplayId: s.id, exchange: "kraken" });
  return s;
}
function post(body: Record<string, unknown>) {
  return replay(new Request("http://localhost/api/replay/route-session-1234", { method: "POST", body: JSON.stringify(body), headers: { "Content-Type": "application/json" } }), { params: Promise.resolve({ id: session().id }) });
}
beforeEach(() => {
  closeDatabaseForTests();
  directory = mkdtempSync(path.join(tmpdir(), "newbeing-routes-"));
  process.env.NEWBEING_DATA_DIR = directory;
  fixture.bars = [bar(120_000)];
  fixture.fetch.mockImplementation(async () => fixture.bars);
});
afterEach(() => {
  closeDatabaseForTests();
  delete process.env.NEWBEING_DATA_DIR;
  rmSync(directory, { recursive: true, force: true });
  vi.clearAllMocks();
});

describe("Replay HTTP integration", () => {
  it("binds revealed market bars to the actual session venue", async () => {
    const s = configure();
    const response = await market(new Request("http://localhost/api/market?exchange=kraken&symbol=BTC/USD&timeframe=1m"));
    expect(response.status).toBe(200);
    expect((await response.json()).candles).toEqual(s.bars);
    expect((await market(new Request("http://localhost/api/market?exchange=binance&symbol=BTC/USD&timeframe=1m"))).status).toBe(409);
    expect((await market(new Request("http://localhost/api/market?exchange=kraken&symbol=BTC/USD&kind=summary"))).status).toBe(409);
    expect(fixture.fetch).not.toHaveBeenCalled();
  });

  it("requires a revision, rejects stale mutations, and returns the pending then executed portfolio", async () => {
    configure();
    const requestId = "00000000-0000-4000-8000-000000000001";
    expect((await post({ action: "finish" })).status).toBe(400);
    const response = await post({ action: "order", requestId, side: "buy", quantity: 1, expectedRevision: 0 });
    expect(response.status).toBe(200);
    const queued = await response.json();
    expect(queued.orders[0].status).toBe("submitted");
    expect(queued.portfolio.quoteBalance).toBe(1000);
    expect((await post({ action: "finish", expectedRevision: 0 })).status).toBe(409);
    const step = await post({ action: "step", expectedRevision: 1, expectedCursor: 60_000 });
    expect(step.status).toBe(200);
    const filled = await step.json();
    expect(filled.execution.fills).toHaveLength(1);
    expect(filled.portfolio.quoteBalance).toBeCloseTo(899.9);
    const retry = await post({ action: "step", expectedRevision: 1, expectedCursor: 60_000 });
    expect((await retry.json()).deduplicated).toBe(true);
    expect(getReplayExecution(session().id)?.fills).toHaveLength(1);
  });

  it("refuses silent legacy upgrades and interval gaps without modifying persisted state", async () => {
    const s = session();
    createReplaySession(s);
    expect((await post({ action: "step", expectedRevision: 0, expectedCursor: s.cursor })).status).toBe(422);
    expect(getReplayExecution(s.id)).toBeUndefined();
    expect(getReplaySession(s.id)).toEqual(s);
  });

  it("blocks a missing interval and leaves pending execution untouched", async () => {
    const s = configure();
    commandReplay(s.id, 0, { action: "order", order: { clientOrderId: "pending", type: "market", side: "buy", quantity: 1 } });
    const before: ReplayExecution | undefined = getReplayExecution(s.id);
    fixture.bars = [bar(180_000)];
    expect((await post({ action: "step", expectedRevision: 1, expectedCursor: s.cursor })).status).toBe(422);
    expect(getReplayExecution(s.id)).toEqual(before);
    expect(getReplaySession(s.id)?.cursor).toBe(s.cursor);
  });
});
