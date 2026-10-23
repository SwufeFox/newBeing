import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { DEFAULT_WORKSPACE_STATE, SPOT_EXECUTION_POLICY, type Candle } from "@newbeing/core";
import { closeDatabaseForTests, getSpotAccount, saveDatasetSnapshot, saveWorkspaceState } from "@newbeing/storage";

const fixture = vi.hoisted(() => ({ fetch: vi.fn(), summary: vi.fn(), connectorUnavailable: false }));
vi.mock("@newbeing/market-data", async () => import("@newbeing/market-data/utils"));
vi.mock("@/lib/market-adapter", () => ({
  getWebMarketAdapter: (exchange: string) => {
    if (fixture.connectorUnavailable) throw new Error("Connector unavailable during frozen playback");
    return { id: exchange, fetchOHLCVSince: fixture.fetch, fetchSummary: fixture.summary, getInstrument: async (symbol: string) => ({ id: `${exchange}:spot:BTCUSDT`, nativeId: "BTCUSDT", venue: exchange, symbol, base: "BTC", quote: "USDT", marketType: "spot", active: true }) };
  },
  marketDataSourceLabel: () => "Route fixture",
}));
import { GET, POST } from "../src/app/api/spot/route.js";
import { POST as startReplay } from "../src/app/api/replay/route.js";
import { POST as replayCommand } from "../src/app/api/replay/[id]/route.js";

let directory: string;
beforeEach(() => {
  closeDatabaseForTests();
  directory = mkdtempSync(path.join(tmpdir(), "newbeing-spot-routes-"));
  process.env.NEWBEING_DATA_DIR = directory;
  fixture.summary.mockImplementation(async (symbol: string) => ({ symbol, ask: 100, bid: 99, last: 100, timestamp: Date.now() }));
});
afterEach(() => {
  closeDatabaseForTests();
  delete process.env.NEWBEING_DATA_DIR;
  fixture.connectorUnavailable = false;
  vi.clearAllMocks();
  rmSync(directory, { recursive: true, force: true });
});
const request = (url: string, body: unknown) => new Request(`http://localhost/api/${url}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

describe("shared spot and frozen Replay HTTP contracts", () => {
  it("never seeds on GET, requires explicit open and deduplicates seed and settlement", async () => {
    const read = () => GET(new Request("http://localhost/api/spot?exchange=binance&quote=USDT"));
    expect((await (await read()).json()).account).toBeNull();
    const order = { action: "order", exchange: "binance", symbol: "BTC/USDT", side: "buy", quantity: 1, maximumPrice: 100, clientOrderId: "spot-http-once" };
    expect((await POST(request("spot", order))).status).toBe(422);
    const open = { action: "open", exchange: "binance", quote: "USDT" };
    expect((await POST(request("spot", open))).status).toBe(200);
    expect((await POST(request("spot", order))).status).toBe(200);
    expect((await POST(request("spot", order))).status).toBe(200);
    await POST(request("spot", open));
    const account = (await (await read()).json()).account;
    expect(account.balances.USDT).toEqual({ total: 9899.9, reserved: 0 });
    expect(account.fills).toHaveLength(1);
    expect(account.ledger.filter((entry: { reason: string }) => entry.reason === "initial-capital")).toHaveLength(1);
    expect(account.policy).toEqual(SPOT_EXECUTION_POLICY);
  });

  it("reports a confirmed rejection before reservation without inventing an order", async () => {
    await POST(request("spot", { action: "open", exchange: "binance", quote: "USDT" }));
    const response = await POST(request("spot", { action: "order", exchange: "binance", symbol: "BTC/USDT", side: "buy", quantity: 1000, maximumPrice: 100, clientOrderId: "spot-http-too-large" }));
    expect(response.status).toBe(422);
    const payload = await response.json();
    expect(payload.intentRecorded).toBe(false);
    expect(payload.order).toBeNull();
    expect(payload.account.balances.USDT).toEqual({ total: 10000, reserved: 0 });
    expect(payload.account.orders).toEqual([]);
  });

  it("retains an unknown order and its reservation when obtaining a quote fails", async () => {
    await POST(request("spot", { action: "open", exchange: "binance", quote: "USDT" }));
    fixture.summary.mockRejectedValueOnce(new Error("Quote connection lost"));
    const response = await POST(request("spot", { action: "order", exchange: "binance", symbol: "BTC/USDT", side: "buy", quantity: 1, maximumPrice: 100, clientOrderId: "spot-http-unknown" }));
    expect(response.status).toBe(202);
    const payload = await response.json();
    expect(payload.order.status).toBe("unknown");
    expect(payload.intentRecorded).not.toBe(false);
    expect(payload.account.balances.USDT).toEqual({ total: 10000, reserved: 100.1 });
    expect(payload.account.fills).toEqual([]);
  });

  it("acknowledges an in-flight retry as pending and fences its late quote after cancellation", async () => {
    await POST(request("spot", { action: "open", exchange: "binance", quote: "USDT" }));
    let resolve!: (value: unknown) => void;
    fixture.summary.mockImplementation(() => new Promise((done) => { resolve = done; }));
    const order = { action: "order", exchange: "binance", symbol: "BTC/USDT", side: "buy", quantity: 1, maximumPrice: 100, clientOrderId: "spot-http-pending" };
    const pending = POST(request("spot", order));
    await vi.waitFor(() => expect(fixture.summary).toHaveBeenCalledTimes(1));
    const retry = await POST(request("spot", order));
    const cancel = await POST(request("spot", { action: "cancel", exchange: "binance", quote: "USDT", clientOrderId: order.clientOrderId }));
    resolve({ symbol: order.symbol, ask: 100, timestamp: Date.now() });
    await pending;
    expect(retry.status).toBe(202);
    expect((await retry.json()).order.status).toBe("submitted");
    expect(cancel.status).toBe(200);
    expect(getSpotAccount("binance", "USDT")!.balances.USDT).toEqual({ total: 10000, reserved: 0 });
    expect(getSpotAccount("binance", "USDT")!.fills).toEqual([]);
    expect(fixture.summary).toHaveBeenCalledTimes(1);
  });

  it("starts from a research snapshot and steps offline without exposing unrevealed bars", async () => {
    const candles: Candle[] = Array.from({ length: 60 }, (_, i) => ({ timestamp: i * 60000, open: 100, high: 101, low: 99, close: 100, volume: 1 }));
    const datasetId = saveDatasetSnapshot({ exchange: "binance", symbol: "BTC/USDT", timeframe: "1m", candles });
    const response = await startReplay(request("replay", { exchange: "binance", symbol: "BTC/USDT", timeframe: "1m", datasetId, endAt: 50 * 60000, limit: 50 }));
    expect(response.status).toBe(201);
    const started = await response.json();
    expect(started.execution.datasetId).toBe(datasetId);
    expect(started.execution.executionPolicy).toEqual(SPOT_EXECUTION_POLICY);
    expect(started.session.bars).toEqual(candles.slice(0, 50));
    expect(started.futureBarsLoaded).toBe(0);
    closeDatabaseForTests();
    fixture.connectorUnavailable = true;
    const step = await replayCommand(request(`replay/${started.session.id}`, { action: "step", expectedRevision: 0, expectedCursor: started.session.cursor }), { params: Promise.resolve({ id: started.session.id }) });
    expect(step.status).toBe(200);
    const stepped = await step.json();
    expect(stepped.session.cursor).toBe(candles[50]!.timestamp);
    expect(stepped.session.bars.at(-1)).toEqual(candles[50]);
    expect(fixture.fetch).not.toHaveBeenCalled();
    expect((await GET(new Request("http://localhost/api/spot?exchange=binance&quote=USDT"))).status).toBe(409);
    expect((await POST(request("spot", { action: "open", exchange: "binance", quote: "USDT" }))).status).toBe(409);
    expect(getSpotAccount("binance", "USDT")).toBeUndefined();
    saveWorkspaceState(DEFAULT_WORKSPACE_STATE);
  });
});
