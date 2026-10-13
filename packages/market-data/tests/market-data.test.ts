import { describe, expect, it } from "vitest";
import { CcxtSpotAdapter, coalesceRequest, completedBarsThrough, findCandleGaps, getExchangeAdapter, mergeCandles, nextCompletedBarAfter, reconnectDelayMs, removeFormingCandles } from "../src/index.js";
import type { Candle, ExchangeId } from "@newbeing/core";

const candle = (timestamp: number, close: number): Candle => ({ timestamp, open: close, high: close, low: close, close, volume: 1 });

describe("public spot exchange registry", () => {
  it.each(["binance", "coinbaseexchange", "kraken", "okx"] as const)("creates a CCXT adapter for %s", (id) => {
    expect(getExchangeAdapter(id).id).toBe(id);
  });

  it("coalesces concurrent OHLCV reads through the selected CCXT adapter", async () => {
    const adapter = new CcxtSpotAdapter("binance");
    let fetchCalls = 0;
    let resolveRows!: (rows: [number, number, number, number, number, number][]) => void;
    const exchangeStub = {
      loadMarkets: async () => ({}),
      fetchOHLCV: async () => {
        fetchCalls += 1;
        return await new Promise<[number, number, number, number, number, number][]>((resolve) => { resolveRows = resolve; });
      },
    };
    Object.defineProperty(adapter, "exchange", { value: exchangeStub });

    const first = adapter.fetchOHLCV("BTC/USDT", "1m", 100);
    const second = adapter.fetchOHLCV("BTC/USDT", "1m", 100);
    await Promise.resolve();
    expect(fetchCalls).toBe(1);
    resolveRows([[0, 1.5, 1.5, 1.5, 1.5, 10]]);
    const expected = { timestamp: 0, open: 1.5, high: 1.5, low: 1.5, close: 1.5, volume: 10 };
    await expect(Promise.all([first, second])).resolves.toEqual([[expected], [expected]]);
  });


});


describe("market data normalization", () => {
  it("coalesces concurrent identical reads, then allows fresh reads", async () => {
    let calls = 0;
    let resolveRequest!: (value: string) => void;
    const request = (): Promise<string> => {
      calls += 1;
      return new Promise((resolve) => { resolveRequest = resolve; });
    };
    const first = coalesceRequest("venue|BTC/USDT", request);
    const second = coalesceRequest("venue|BTC/USDT", request);
    expect(calls).toBe(1);
    resolveRequest("shared");
    await expect(Promise.all([first, second])).resolves.toEqual(["shared", "shared"]);
    await expect(coalesceRequest("venue|BTC/USDT", async () => { calls += 1; return "fresh"; })).resolves.toBe("fresh");
    expect(calls).toBe(2);
  });

  it("clears a rejected in-flight request so callers can retry", async () => {
    let calls = 0;
    await expect(coalesceRequest("venue|retry", async () => { calls += 1; throw new Error("offline"); })).rejects.toThrow("offline");
    await expect(coalesceRequest("venue|retry", async () => { calls += 1; return "recovered"; })).resolves.toBe("recovered");
    expect(calls).toBe(2);
  });

  it("deduplicates websocket updates and uses the incoming value for the same bucket", () => {
    expect(mergeCandles([candle(0, 1), candle(60_000, 2)], [candle(60_000, 3), candle(120_000, 4)]))
      .toEqual([candle(0, 1), candle(60_000, 3), candle(120_000, 4)]);
  });

  it("detects missing timeframe buckets", () => {
    expect(findCandleGaps([candle(0, 1), candle(180_000, 2)], "1m"))
      .toEqual([{ from: 60_000, to: 120_000 }]);
  });

  it("drops the still-forming bar for reproducible research", () => {
    expect(removeFormingCandles([candle(0, 1), candle(60_000, 2)], "1m", 119_999)).toEqual([candle(0, 1)]);
  });

  it("returns only completed bars at or before the selected replay cutoff", () => {
    expect(completedBarsThrough([candle(0, 1), candle(60_000, 2), candle(120_000, 3)], "1m", 120_000, 500_000))
      .toEqual([candle(0, 1), candle(60_000, 2)]);
  });

  it("releases exactly one completed bar after the replay cursor", () => {
    const next = nextCompletedBarAfter([candle(60_000, 2), candle(120_000, 3), candle(180_000, 4)], "1m", 0, 300_000);
    expect(next).toEqual(candle(60_000, 2));
    expect(nextCompletedBarAfter([candle(60_000, 2)], "1m", 0, 119_999)).toBeNull();
  });

  it("uses bounded exponential reconnect backoff", () => {
    expect([0, 1, 2, 10, 99].map(reconnectDelayMs)).toEqual([500, 1_000, 2_000, 30_000, 30_000]);
  });
});
