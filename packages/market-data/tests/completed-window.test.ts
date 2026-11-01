import { afterEach, describe, expect, it, vi } from "vitest";
import type { Candle } from "@newbeing/core";
import type { ExchangeAdapter } from "../src/types.js";
import { fetchCompletedCandlesRange, fetchLatestCompletedCandles } from "../src/completed-window.js";

const bar = (timestamp: number): Candle => ({ timestamp, open: 100, high: 101, low: 99, close: 100, volume: 1 });
const adapter = (fetchOHLCVSince: ExchangeAdapter["fetchOHLCVSince"]) => ({ fetchOHLCVSince } as ExchangeAdapter);
afterEach(() => vi.restoreAllMocks());

describe("exact latest completed candles", () => {
  it("starts at the requested since, pages short responses, and excludes forming bars", async () => {
    const fetch = vi.fn<ExchangeAdapter["fetchOHLCVSince"]>()
      .mockResolvedValueOnce([bar(420_000), bar(480_000)])
      .mockResolvedValueOnce([bar(480_000), bar(540_000), bar(600_000)]);
    expect(await fetchLatestCompletedCandles(adapter(fetch), "BTC/USDT", "1m", 3, 630_000)).toEqual([bar(420_000), bar(480_000), bar(540_000)]);
    expect(fetch.mock.calls).toEqual([["BTC/USDT", "1m", 420_000, 4], ["BTC/USDT", "1m", 540_000, 2]]);
  });
  it("pins the completion boundary across an asynchronous clock rollover", async () => {
    vi.spyOn(Date, "now").mockReturnValue(599_999);
    const fetch = vi.fn(async () => { vi.mocked(Date.now).mockReturnValue(660_000); return [bar(420_000), bar(480_000), bar(540_000), bar(600_000)]; });
    expect(await fetchLatestCompletedCandles(adapter(fetch), "BTC/USDT", "1m", 2)).toEqual([bar(420_000), bar(480_000)]);
  });
  it("uses the new completed bar exactly at the boundary", async () => {
    expect(await fetchLatestCompletedCandles(adapter(async () => [bar(480_000), bar(540_000), bar(600_000)]), "BTC/USDT", "1m", 2, 600_000)).toEqual([bar(480_000), bar(540_000)]);
  });
  it("rejects conflicting duplicates within a page", async () => {
    await expect(fetchLatestCompletedCandles(adapter(async () => [bar(480_000), { ...bar(480_000), close: 101 }, bar(540_000)]), "BTC/USDT", "1m", 2, 630_000)).rejects.toThrow(/Conflicting/);
  });
  it("rejects conflicting overlap across pages", async () => {
    const fetch = vi.fn<ExchangeAdapter["fetchOHLCVSince"]>().mockResolvedValueOnce([bar(420_000)]).mockResolvedValueOnce([{ ...bar(420_000), volume: 2 }, bar(480_000), bar(540_000)]);
    await expect(fetchLatestCompletedCandles(adapter(fetch), "BTC/USDT", "1m", 3, 630_000)).rejects.toThrow(/Conflicting/);
  });
  it.each([[], [bar(480_000)], [bar(420_000), bar(540_000)], [bar(540_000), bar(600_000)]].map((bars) => ({ bars })))("rejects incomplete or stalled history %#", async ({ bars }) => {
    await expect(fetchLatestCompletedCandles(adapter(async () => bars), "BTC/USDT", "1m", 3, 630_000)).rejects.toThrow(/exactly 3/);
  });
  it("requests multiple pages when N exceeds the venue page ceiling", async () => {
    const fetch = vi.fn<ExchangeAdapter["fetchOHLCVSince"]>(async (_symbol, _timeframe, since, limit) => Array.from({ length: Math.min(300, limit!) }, (_, i) => bar(since + i * 60_000)));
    expect(await fetchLatestCompletedCandles(adapter(fetch), "BTC/USDT", "1m", 1000, 60_000_000)).toHaveLength(1000);
    expect(fetch).toHaveBeenCalledTimes(4);
  });
});

describe("exact historical completed candle ranges", () => {
  it("paginates a half-open range and excludes the current forming bar", async () => {
    const fetch = vi.fn<ExchangeAdapter["fetchOHLCVSince"]>()
      .mockResolvedValueOnce([bar(0), bar(60_000)])
      .mockResolvedValueOnce([bar(60_000), bar(120_000), bar(180_000), bar(240_000)]);
    const result = await fetchCompletedCandlesRange(adapter(fetch), "BTC/USDT", "1m", 0, 240_000, 245_000);
    expect(result).toEqual([bar(0), bar(60_000), bar(120_000), bar(180_000)]);
    expect(fetch.mock.calls).toEqual([["BTC/USDT", "1m", 0, 5], ["BTC/USDT", "1m", 120_000, 3]]);
  });
  it("pins the latest completed boundary before paging", async () => {
    const fetch = vi.fn<ExchangeAdapter["fetchOHLCVSince"]>().mockResolvedValue([bar(0), bar(60_000), bar(120_000)]);
    expect(await fetchCompletedCandlesRange(adapter(fetch), "BTC/USDT", "1m", 0, undefined, 125_000)).toEqual([bar(0), bar(60_000)]);
  });
  it("rejects unaligned, future, oversized and incomplete ranges", async () => {
    const fetch = vi.fn<ExchangeAdapter["fetchOHLCVSince"]>().mockResolvedValue([]);
    const source = adapter(fetch);
    await expect(fetchCompletedCandlesRange(source, "BTC/USDT", "1m", 1, 180_000, 240_000)).rejects.toThrow(/aligned/);
    await expect(fetchCompletedCandlesRange(source, "BTC/USDT", "1m", 0, 240_000, 239_999)).rejects.toThrow(/completed/);
    await expect(fetchCompletedCandlesRange(source, "BTC/USDT", "1m", 0, 300_060_000, 300_060_000)).rejects.toThrow(/exceeds/);
    await expect(fetchCompletedCandlesRange(source, "BTC/USDT", "1m", 0, 180_000, 180_000)).rejects.toThrow(/Expected exactly 3/);
  });
  it("rejects conflicting duplicate candles across pages", async () => {
    const fetch = vi.fn<ExchangeAdapter["fetchOHLCVSince"]>()
      .mockResolvedValueOnce([bar(0), bar(60_000)])
      .mockResolvedValueOnce([bar(60_000), { ...bar(60_000), close: 101 }, bar(120_000)]);
    await expect(fetchCompletedCandlesRange(adapter(fetch), "BTC/USDT", "1m", 0, 180_000, 180_000)).rejects.toThrow(/Conflicting/);
  });
});
