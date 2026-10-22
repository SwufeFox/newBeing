import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { ExchangeAdapter, MarketSummary } from "@newbeing/market-data";
import { cancelSpotIntent, closeDatabaseForTests, getSpotAccount, openSpotAccount } from "@newbeing/storage";
import { executeSharedSpotOrder } from "../src/spot.js";

let directory: string;
beforeEach(() => {
  closeDatabaseForTests();
  directory = mkdtempSync(path.join(tmpdir(), "newbeing-spot-app-"));
  process.env.NEWBEING_DATA_DIR = directory;
  openSpotAccount("binance", "USDT");
});
afterEach(() => {
  closeDatabaseForTests();
  delete process.env.NEWBEING_DATA_DIR;
  vi.restoreAllMocks();
  rmSync(directory, { recursive: true, force: true });
});
const request = { exchange: "binance" as const, symbol: "BTC/USDT", side: "buy" as const, quantity: 1, maximumPrice: 100, clientOrderId: "once" };
const summary = (): MarketSummary => ({ symbol: request.symbol, ask: 100, bid: 99, last: 100, timestamp: Date.now(), changePct24h: null, high24h: null, low24h: null, quoteVolume24h: null });
function adapter(fetchSummary: ExchangeAdapter["fetchSummary"]): ExchangeAdapter {
  return { id: "binance", fetchSummary, searchSymbols: async () => [], fetchOHLCV: async () => [], fetchOHLCVSince: async () => [], fetchSummaries: async () => [], fetchOrderBook: async () => { throw new Error("Unexpected order-book request"); }, fetchRecentTrades: async () => [], close: async () => {}, getInstrument: async () => ({ id: "binance:spot:BTCUSDT", venue: "binance", nativeId: "BTCUSDT", symbol: "BTC/USDT", base: "BTC", quote: "USDT", marketType: "spot", active: true, precision: { amount: null, price: null, mode: null }, limits: { amount: { min: null, max: null }, cost: { min: null, max: null } } }) };
}

describe("shared spot async settlement", () => {
  it("allows only one quote/fill for competing identical requests", async () => {
    const fetch = vi.fn(async () => summary());
    const results = await Promise.all([executeSharedSpotOrder(request, adapter(fetch)), executeSharedSpotOrder(request, adapter(fetch))]);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(results.filter((result) => result.deduplicated)).toHaveLength(1);
    expect(getSpotAccount("binance", "USDT")!.fills).toHaveLength(1);
    expect(getSpotAccount("binance", "USDT")!.balances.USDT).toEqual({ total: 9899.9, reserved: 0 });
  });

  it("rejects competing reservations with different price bounds", async () => {
    const results = await Promise.allSettled([executeSharedSpotOrder(request, adapter(async () => summary())), executeSharedSpotOrder({ ...request, maximumPrice: 101 }, adapter(async () => summary()))]);
    expect(results.map((result) => result.status).sort()).toEqual(["fulfilled", "rejected"]);
    expect(getSpotAccount("binance", "USDT")!.fills).toHaveLength(1);
  });

  it("does not settle a cancelled intent when a quote arrives late", async () => {
    let resolve!: (value: MarketSummary) => void;
    const quote = new Promise<MarketSummary>((done) => { resolve = done; });
    const fetch = vi.fn(() => quote);
    const pending = executeSharedSpotOrder(request, adapter(fetch));
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
    cancelSpotIntent("binance", "USDT", request.clientOrderId);
    resolve(summary());
    expect((await pending).order.status).toBe("cancelled");
    expect(getSpotAccount("binance", "USDT")!.fills).toEqual([]);
    expect(getSpotAccount("binance", "USDT")!.balances.USDT).toEqual({ total: 10000, reserved: 0 });
  });

  it("returns a final precision rejection with released funds instead of an ambiguous reservation", async () => {
    const fetch = vi.fn(async () => ({ ...summary(), ask: 1e-12 }));
    const result = await executeSharedSpotOrder(request, adapter(fetch));
    expect(result.order.status).toBe("rejected");
    expect(result.account.balances.USDT).toEqual({ total: 10000, reserved: 0 });
    closeDatabaseForTests();
    expect((await executeSharedSpotOrder(request, adapter(fetch))).deduplicated).toBe(true);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(getSpotAccount("binance", "USDT")!.fills).toEqual([]);
  });

  it("keeps a cancelled intent final even when its delayed quote fails", async () => {
    let reject!: (error: Error) => void;
    const quote = new Promise<MarketSummary>((_resolve, fail) => { reject = fail; });
    const fetch = vi.fn(() => quote);
    const pending = executeSharedSpotOrder(request, adapter(fetch));
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
    cancelSpotIntent("binance", "USDT", request.clientOrderId);
    reject(new Error("late network failure"));
    expect((await pending).order.status).toBe("cancelled");
    expect(getSpotAccount("binance", "USDT")!.balances.USDT).toEqual({ total: 10000, reserved: 0 });
    expect(getSpotAccount("binance", "USDT")!.fills).toEqual([]);
  });

  it.each(["stale", "future", "missing", "mismatch", "failure"])("retains reservation for %s quotes without automatic retries", async (kind) => {
    const fetch = vi.fn(async () => {
      if (kind === "failure") throw new Error("network failure");
      return { ...summary(), ...(kind === "stale" ? { timestamp: Date.now() - 60000 } : kind === "future" ? { timestamp: Date.now() + 60000 } : kind === "missing" ? { timestamp: null } : { symbol: "ETH/USDT" }) };
    });
    expect((await executeSharedSpotOrder(request, adapter(fetch))).order.status).toBe("unknown");
    closeDatabaseForTests();
    expect((await executeSharedSpotOrder(request, adapter(fetch))).deduplicated).toBe(true);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(getSpotAccount("binance", "USDT")!.balances.USDT!.reserved).toBe(100.1);
    expect(getSpotAccount("binance", "USDT")!.fills).toEqual([]);
  });
});
