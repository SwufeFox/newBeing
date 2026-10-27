import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { advanceReplaySession, closeDatabaseForTests, createConfiguredReplaySession, createReplaySession, getReplayExecution } from "@newbeing/storage";
import { executePendingReplayOrder, executeReplayOrder } from "../src/replay.js";

let directory: string;
beforeEach(() => {
  closeDatabaseForTests();
  directory = mkdtempSync(path.join(tmpdir(), "newbeing-service-"));
  process.env.NEWBEING_DATA_DIR = directory;
});
afterEach(() => {
  closeDatabaseForTests();
  delete process.env.NEWBEING_DATA_DIR;
  rmSync(directory, { recursive: true, force: true });
});
const input = { sessionId: "service-session-1234", clientOrderId: "service-once", symbol: "BTC/USDT", side: "buy" as const, quantity: 1, price: 100 };
function configure() {
  createConfiguredReplaySession({ id: input.sessionId, exchange: "binance", symbol: input.symbol, timeframe: "1m", startAt: 60_000, cursor: 0, bars: [{ timestamp: 0, open: 100, high: 110, low: 90, close: 100, volume: 1 }], status: "active", createdAt: "2026-01-01T00:00:00Z", updatedAt: "2026-01-01T00:00:00Z" }, { id: "binance:spot:BTCUSDT", venue: "binance", nativeId: "BTCUSDT", symbol: input.symbol, base: "BTC", quote: "USDT", marketType: "spot" }, { initialCapital: 1000, feeRate: 0.001, slippageRate: 0 });
}
describe("versioned Replay service contracts", () => {
  it("retains legacy immediate fills and exact retries", () => {
    createReplaySession({ id: input.sessionId, exchange: "binance", symbol: input.symbol, timeframe: "1m", startAt: 60_000, cursor: 0, bars: [{ timestamp: 0, open: 100, high: 110, low: 90, close: 100, volume: 1 }], status: "active", createdAt: "2026-01-01T00:00:00Z", updatedAt: "2026-01-01T00:00:00Z" });
    const result = executeReplayOrder(input);
    expect(result.order.status).toBe("filled");
    expect(result.portfolio.quoteBalance).toBeCloseTo(9899.9);
    expect(executeReplayOrder(input).deduplicated).toBe(true);
  });
  it("prevents legacy callers from silently changing configured execution", () => {
    configure();
    expect(() => executeReplayOrder(input)).toThrow(/executePendingReplayOrder/);
    expect(getReplayExecution(input.sessionId)?.fills).toEqual([]);
  });
  it("submits configured intent without filling at a caller's stale reference price", () => {
    configure();
    const result = executePendingReplayOrder({ ...input, price: 1 });
    expect(result.order.status).toBe("submitted");
    expect(result.portfolio.quoteBalance).toBe(1000);
    advanceReplaySession(input.sessionId, 0, { timestamp: 60_000, open: 120, high: 125, low: 110, close: 120, volume: 1 }, undefined, 1);
    expect(executePendingReplayOrder({ ...input, expectedRevision: 0 }).order.fillPrice).toBe(120);
    expect(() => executePendingReplayOrder({ ...input, symbol: "ETH/USDT" })).toThrow(/instrument mismatch/);
  });
});
