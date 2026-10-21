import { describe, expect, it } from "vitest";
import { canonicalJson, identifyDataset } from "../src/snapshots.js";
const candle = { timestamp: 60_000, open: 100, high: 110, low: 90, close: 105, volume: 1 };
const input = { exchange: "binance" as const, symbol: "BTC/USDT", timeframe: "1m" as const, candles: [candle, { ...candle, timestamp: 120_000 }] };
describe("canonical dataset identity", () => {
  it("defines bytes independent of property insertion order and extra candle properties", () => {
    expect(canonicalJson({ z: 1e-7, a: -0, b: [true, null] })).toBe('{"a":0,"b":[true,null],"z":1e-7}');
    expect(identifyDataset(input)).toEqual(identifyDataset({ ...input, candles: input.candles.map((c) => ({ volume: c.volume, close: c.close, low: c.low, high: c.high, open: c.open, timestamp: c.timestamp, ignored: true })) }));
  });
  it("hashes full OHLCV and venue identity", () => {
    const original = identifyDataset(input);
    expect(original.datasetId).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(identifyDataset({ ...input, exchange: "kraken" }).datasetId).not.toBe(original.datasetId);
    expect(identifyDataset({ ...input, candles: [candle, { ...input.candles[1]!, volume: 2 }] }).datasetId).not.toBe(original.datasetId);
    expect(identifyDataset({ ...input, timeframe: "5m", candles: [{ ...candle, timestamp: 300_000 }, { ...candle, timestamp: 600_000 }] }).datasetId).not.toBe(original.datasetId);
  });
  it("rejects invalid, unordered, duplicate, gapped or off-grid data", () => {
    for (const candles of [[candle, candle], [...input.candles].reverse(), [candle, { ...candle, timestamp: 180_000 }], [candle, { ...candle, timestamp: 120_001 }], [candle, { ...candle, timestamp: 120_000, close: NaN }]]) {
      expect(() => identifyDataset({ ...input, candles })).toThrow();
    }
    expect(() => canonicalJson({ missing: undefined })).toThrow();
  });
});
