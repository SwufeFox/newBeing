import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { closeDatabaseForTests, getCachedCandles } from "@newbeing/storage";
import type { Candle } from "@newbeing/core";
import type { ExchangeAdapter } from "@newbeing/market-data";
import { createCandleCacheAdapter } from "../src/lib/candle-cache-adapter.js";

let directory: string;
const candle = (timestamp: number): Candle => ({ timestamp, open: 100, high: 110, low: 90, close: 100, volume: 1 });
function adapter(fetchOnline: () => Promise<Candle[]>): ExchangeAdapter {
  return { id: "kraken", searchSymbols: async () => [], fetchOHLCV: fetchOnline, fetchOHLCVSince: fetchOnline, fetchSummary: async (symbol) => ({ symbol, last: null, changePct24h: null, high24h: null, low24h: null, quoteVolume24h: null, bid: null, ask: null, timestamp: null }), fetchSummaries: async () => [], fetchOrderBook: async (symbol) => ({ symbol, timestamp: null, bids: [], asks: [] }), fetchRecentTrades: async () => [], close: async () => {} };
}
beforeEach(() => {
  closeDatabaseForTests();
  directory = mkdtempSync(path.join(tmpdir(), "newbeing-cache-"));
  process.env.NEWBEING_DATA_DIR = directory;
  vi.spyOn(Date, "now").mockReturnValue(630_000);
});
afterEach(() => {
  closeDatabaseForTests();
  vi.restoreAllMocks();
  delete process.env.NEWBEING_DATA_DIR;
  rmSync(directory, { recursive: true, force: true });
});

describe("candle cache adapter", () => {
  it("preserves forming candles in live responses but never persists them as final", async () => {
    const bars = [candle(540_000), candle(600_000)];
    const wrapped = createCandleCacheAdapter("kraken", adapter(async () => bars));
    expect(await wrapped.adapter.fetchOHLCV("BTC/USD", "1m", 10)).toEqual(bars);
    expect(wrapped.getLastResult()?.candles).toEqual(bars);
    expect(getCachedCandles("kraken", "BTC/USD", "1m", 0, 10).candles).toEqual([bars[0]]);
    const offline = createCandleCacheAdapter("kraken", adapter(async () => { throw new Error("offline"); }));
    expect(await offline.adapter.fetchOHLCVSince("BTC/USD", "1m", 0, 10)).toEqual([bars[0]]);
    expect(offline.getLastResult()).toMatchObject({ source: "local-cache", cache: { fallback: true } });
  });

  it("restricts research fetches to candles closed through the requested boundary", async () => {
    const bars = [candle(480_000), candle(540_000), candle(600_000)];
    const wrapped = createCandleCacheAdapter("kraken", adapter(async () => bars));
    expect(await wrapped.adapter.fetchOHLCVSinceThrough("BTC/USD", "1m", 0, 10, 590_000)).toEqual([bars[0]]);
    expect(getCachedCandles("kraken", "BTC/USD", "1m", 0, 10).candles).toEqual([bars[0]]);
  });

  it("does not turn an empty offline cache into a successful fetch", async () => {
    const offline = createCandleCacheAdapter("kraken", adapter(async () => { throw new Error("network unavailable"); }));
    await expect(offline.adapter.fetchOHLCV("BTC/USD", "1m")).rejects.toThrow("network unavailable");
  });
});
